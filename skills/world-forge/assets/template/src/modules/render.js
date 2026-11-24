// RENDER: HDR pipeline on EffectComposer.
//   HalfFloat MSAA scene target -> GTAO (quality.ao) -> bloom (HDR threshold) -> FINAL pass:
//   exposure, 75% ACES + 25% AgX tone map, split-tone grade, lift/gain, S-curve, saturation,
//   vignette, sRGB encode, film grain, dither.  (Saltline's recipe, see render-and-materials.md §1.3)
// Also: procedural sky dome + PMREM environment from it, height fog that glows toward the sun and
// matches the sky's horizon colours (so far objects melt into the sky), fitted sun shadow updated
// every other frame, a fixed pool of point lights (never add/remove lights at runtime), adaptive
// resolution, self-test with forward fallback.  Next rungs: references/upgrade-path.md.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SUN, SKY, AMBIENT, GRADE, PLAYER, WORLD } from '../art.js';
import * as ART from '../art.js';
import { VolumetricFogPass } from '../lib/volfog.js';

const LIGHT_POOL = 8;        // fixed point lights; lower to 4 for a world with few lamps (each costs shader time on every lit pixel)

const FOLLOW_SHADOW = !!ART.SHADOW_FOLLOW; // true for worlds larger than ~100 m (snaps to texels to avoid shimmer)

// ---- height fog, installed into three's shader chunks (affects every built-in material) -------------
// density(h) = fogDensity * exp(-(h - base) / height); integrated analytically along the view ray.
// Colour = the sky's horizon colour in that direction (toward-sun warm, away cool) + a sun glow lobe.
// scene.fog.color multiplies it (keep white unless you want a tint); scene.fog.density is the knob.
// The colours are uniforms that hold the SKY/SUN objects by reference: change SKY.horizon etc. in place
// (lib/tod.js does that) and fog, sky dome and env follow. fogTOD[4] = (glow, height, base).
const FOG_P = new THREE.Vector3();
const syncFogParams = () => FOG_P.set(SKY.fogGlow ?? 1.2, SKY.fogHeight ?? 10, SKY.fogBase ?? 0);
// fog-free box (an interior seen through glass, or entered): the part of each view ray inside it gets no fog.
// FOG_CLEAR[0].set(...min); FOG_CLEAR[1].set(...max) from the level.
export const FOG_CLEAR = [new THREE.Vector3(1e6, 1e6, 1e6), new THREE.Vector3(1e6 + 1, 1e6 + 1, 1e6 + 1)];
function installHeightFog() {
  syncFogParams();
  const fogTOD = { value: [SKY.horizon, SKY.horizonAway, SUN.color, SUN.dir, FOG_P, FOG_CLEAR[0], FOG_CLEAR[1]] };   // arrays are shallow-copied per material: the elements stay shared
  THREE.UniformsLib.fog.fogTOD = fogTOD;
  for (const k in THREE.ShaderLib) { const u = THREE.ShaderLib[k].uniforms; if (u && u.fogDensity) u.fogTOD = fogTOD; }
  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG\n varying float vFogDepth; varying vec3 vFogWorld;\n#endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG\n vFogDepth = -mvPosition.z; vFogWorld = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;\n#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG\n uniform vec3 fogColor; uniform float fogDensity; uniform vec3 fogTOD[7]; varying float vFogDepth; varying vec3 vFogWorld;\n#endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  {
    vec3 fv = vFogWorld - cameraPosition; float fd = max(length(fv), 1e-3); vec3 fdir = fv / fd;
    float fb = 1.0 / max(fogTOD[4].y, 0.1), fk = fdir.y * fb;
    float fh0 = max(cameraPosition.y - fogTOD[4].z, -40.0);
    { vec3 ta = (fogTOD[5] - cameraPosition) / (fdir + 1e-6), tb = (fogTOD[6] - cameraPosition) / (fdir + 1e-6), tmn = min(ta, tb), tmx = max(ta, tb);
      float tin = max(max(max(tmn.x, tmn.y), tmn.z), 0.0), tout = min(min(min(tmx.x, tmx.y), tmx.z), fd); fd -= max(tout - tin, 0.0); }   // FOG_CLEAR: no fog inside the box
    fd = max(fd - ${(SKY.fogStart ?? 0).toFixed(2)}, 0.0);   // SKY.fogStart: a clear zone near the camera keeps foreground contrast
    float fod = fogDensity * exp(-fh0 * fb) * (abs(fk) > 1e-5 ? (1.0 - exp(-fd * fk)) / fk : fd);
    float fogFactor = 1.0 - exp(-max(fod, 0.0));
    vec3 fsun = normalize(fogTOD[3]);
    float fts = dot(normalize(fdir.xz + 1e-5), normalize(fsun.xz + 1e-5)) * 0.5 + 0.5;
    vec3 fc = mix(fogTOD[1], fogTOD[0], fts * fts) * fogColor;
    fc += fogTOD[2] * fogColor * pow(max(dot(fdir, fsun), 0.0), 10.0) * fogTOD[4].x;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, fogFactor);
  }
  #endif`;
}

// ---- final pass: tone map + grade + encode -------------------------------------------------------
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 }, exposure: { value: GRADE.exposure },
    lift: { value: GRADE.lift.clone() }, gain: { value: GRADE.gain.clone() }, contrast: { value: GRADE.contrast }, saturation: { value: GRADE.saturation },
    split: { value: GRADE.split ?? 1 }, vignette: { value: GRADE.vignette }, grain: { value: GRADE.grain }, agx: { value: GRADE.agx ?? 0.25 },
    ca: { value: GRADE.ca ?? 0 }, distort: { value: GRADE.distort ?? 0 }, sharpen: { value: GRADE.sharpen ?? 0 }, texel: { value: new THREE.Vector2(1 / 1600, 1 / 900) },   // sharpen: local contrast (a phone camera's processing)   // lens: chromatic aberration toward the edges, slight barrel distortion (photo cues)
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, exposure, contrast, saturation, split, vignette, grain, agx, ca, distort, sharpen; uniform vec2 texel; uniform vec3 lift, gain;
    varying vec2 vUv;
    vec3 rrt(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 aces(vec3 c){
      c = mat3(0.59719,0.07600,0.02840, 0.35458,0.90834,0.13383, 0.04823,0.01566,0.83777) * c; c = rrt(c);
      c = mat3(1.60475,-0.10208,-0.00327, -0.53108,1.10813,-0.07276, -0.07367,-0.00605,1.07602) * c; return clamp(c, 0.0, 1.0); }
    vec3 agxC(vec3 x){ vec3 x2 = x*x, x4 = x2*x2; return 15.5*x4*x2 - 40.14*x4*x + 31.96*x4 - 6.868*x2*x + 0.4298*x2 + 0.1191*x - 0.00232; }
    vec3 agxTM(vec3 v){
      v = mat3(0.842479,0.042328,0.042376, 0.078434,0.878469,0.078434, 0.079224,0.079166,0.879143) * v;
      v = clamp(log2(max(v, 1e-10)), -12.47393, 4.026069); v = (v + 12.47393) / 16.5;
      v = agxC(v);
      v = mat3(1.196879,-0.052897,-0.052972, -0.098021,1.151903,-0.098043, -0.099030,-0.098961,1.151074) * v;
      return pow(max(v, 0.0), vec3(2.2)); }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
    void main(){
      vec2 d0 = vUv - 0.5, uvd = 0.5 + d0 * (1.0 - distort * dot(d0, d0));
      vec3 hdr = max(vec3(texture2D(tDiffuse, uvd + d0 * ca).r, texture2D(tDiffuse, uvd).g, texture2D(tDiffuse, uvd - d0 * ca).b), 0.0) * exposure;
      if (sharpen > 0.0) { vec3 bl = (texture2D(tDiffuse, uvd + vec2(texel.x, 0.0)).rgb + texture2D(tDiffuse, uvd - vec2(texel.x, 0.0)).rgb + texture2D(tDiffuse, uvd + vec2(0.0, texel.y)).rgb + texture2D(tDiffuse, uvd - vec2(0.0, texel.y)).rgb) * 0.25 * exposure;
        hdr = max(hdr + (hdr - bl) * sharpen / (1.0 + dot(bl, vec3(0.33))), 0.0); }   // unsharp mask, softened in highlights
      vec3 c = mix(aces(hdr * 1.3), agxTM(hdr), agx);             // ACES punch, AgX highlight roll-off
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 tint = mix(vec3(0.80, 1.01, 1.13), vec3(1.07, 1.0, 0.90), smoothstep(0.03, 0.55, l));  // teal shadows, warm highlights
      c *= mix(vec3(1.0), tint, split);
      c = c * gain + lift * (1.0 - c);
      c = mix(c, c * c * (3.0 - 2.0 * c), clamp((contrast - 1.0) * 4.0, 0.0, 1.0) * 0.22);  // gentle S-curve
      l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l), c, saturation);
      vec2 d = vUv - 0.5; c *= 1.0 - vignette * smoothstep(0.2, 0.9, dot(d, d) * 2.0);
      c = toSRGB(clamp(c, 0.0, 1.0));
      float g = hash(vUv * 1280.0 + fract(time * 7.13) * 91.0) - 0.5;
      c += g * grain * mix(0.35, 1.0, smoothstep(0.0, 0.25, l)) * mix(1.0, 0.3, smoothstep(0.6, 1.0, l)); // grain strongest in mid-darks
      c += (hash(vUv * 977.0 + 0.5) - 0.5) / 255.0;                 // dither: no banding in sky gradients
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// ---- sky dome ---------------------------------------------------------------------------------
function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { zenith: { value: SKY.zenith }, horizon: { value: SKY.horizon }, away: { value: SKY.horizonAway }, sunDir: { value: SUN.dir }, sunColor: { value: SUN.color }, envMode: { value: 0 }, disc: { value: 1 }, stars: { value: 0 }, moon: { value: 0 }, clouds: { value: SKY.clouds ?? 0 }, cloudT: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 zenith, horizon, away, sunDir, sunColor; uniform float envMode, disc, stars, moon, clouds, cloudT; varying vec3 vDir;
      float ch(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float cn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(ch(i), ch(i+vec2(1,0)), f.x), mix(ch(i+vec2(0,1)), ch(i+vec2(1,1)), f.x), f.y); }
      float cfbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * cn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
      float cdens(vec2 p){ float b = cfbm(p * 0.9 + vec2(cloudT * 0.01, 0.0)); float w = cfbm(p * 3.1 - vec2(cloudT * 0.02, 0.0)); return smoothstep(1.0 - clouds, 1.0 - clouds + 0.28, b * 0.75 + w * 0.35); }
      float sh(vec3 p){ p = fract(p * 0.3183 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main(){
        vec3 d = normalize(vDir); float h = max(d.y, 0.0);
        float toward = dot(normalize(vec3(d.x,0.0,d.z) + 1e-5), normalize(vec3(sunDir.x,0.0,sunDir.z))) * 0.5 + 0.5;
        vec3 hor = mix(away, horizon, toward * toward);            // same formula as the height fog
        vec3 c = mix(hor, zenith, pow(h, 0.45));
        float s = max(dot(d, sunDir), 0.0);
        c += sunColor * (pow(s, 8.0) * 0.15 + pow(s, 64.0) * 0.5 + pow(s, 600.0) * 2.0);   // stacked glow lobes
        if (envMode < 0.5) c += sunColor * mix(pow(s, 3000.0) * 60.0, smoothstep(0.99985, 0.99992, s) * 14.0, moon) * disc;   // HDR sun disc, or a hard moon disc (not in env)
        if (envMode < 0.5 && stars > 0.0 && d.y > 0.02) { vec3 sc = floor(d * 420.0); float st = step(0.9975, sh(sc)), tw = 0.6 + 0.4 * sin(sh(sc + 3.0) * 60.0);
          vec3 fp = fract(d * 420.0) - 0.5; c += vec3(0.85, 0.9, 1.0) * st * tw * smoothstep(0.32, 0.0, length(fp)) * 2.2 * stars * smoothstep(0.02, 0.3, d.y); }
        // CLOUD LAYER (SKY.clouds): a deck of broken cloud on a plane; lit from the side and below by a low sun:
        // undersides glow warm near the sun, silver edges against it, cool grey-blue away from it, thinning into haze
        if (clouds > 0.0 && d.y > 0.004) {
          vec2 cp = d.xz / (d.y + 0.035) * 0.9;
          float den = cdens(cp);
          if (den > 0.001) {
            vec2 sxz = normalize(sunDir.xz + 1e-5);
            float thick = cdens(cp + sxz * 0.12), shade = 1.0 - 0.75 * thick;             // light reaching the cloud from the sun side
            float fw = pow(s, 6.0), side = toward;
            vec3 under = mix(away * 0.55 + zenith * 0.4, horizon * 0.55, side * side);    // the cloud's own colour from the sky around it
            vec3 lit = sunColor * (0.35 + 2.2 * fw) * shade * (0.4 + 0.6 * side);         // sun-lit, strongest near the sun
            vec3 cc = under * (0.55 + 0.25 * shade) + lit * 0.55;
            cc += sunColor * pow(s, 18.0) * (1.0 - den) * 3.0;                              // silver lining: thin edges glow against the sun
            float haze = smoothstep(0.0, 0.18, d.y);                                       // far clouds sink into the horizon haze
            c = mix(c, cc, den * haze * 0.95);
          }
        }
        if (d.y < 0.0) c = mix(hor, hor * 0.35, min(-d.y * 4.0, 1.0));
        if (envMode > 0.5) c = min(c, vec3(6.0));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), mat);
  m.frustumCulled = false; m.renderOrder = -1;
  return m;
}

// Fixed pool of point lights for flashes, explosions, torches. Adding/removing lights recompiles every shader.
function makeLightPool(scene, n = 6) {
  const pool = [];
  for (let i = 0; i < n; i++) { const l = new THREE.PointLight(0xffffff, 0, 10, 2); l.userData = { ttl: 0, max: 0, peak: 0, held: false }; scene.add(l); pool.push(l); }
  return {
    // one-shot pulse: pulse(pos, colorHex, intensity, seconds, distance)
    pulse(pos, color, intensity, ttl = 0.08, distance = 10) {
      const l = pool.find((p) => !p.userData.held && p.userData.ttl <= 0) || pool.filter((p) => !p.userData.held).sort((a, b) => a.userData.ttl - b.userData.ttl)[0];
      if (!l) return null; l.position.copy(pos); l.color.set(color); l.distance = distance; Object.assign(l.userData, { ttl, max: ttl, peak: intensity }); l.intensity = intensity; return l;
    },
    // persistent light (lamp, torch): acquire() then set position/intensity yourself; release(l) when done
    acquire() { const l = pool.find((p) => !p.userData.held && p.userData.ttl <= 0); if (l) l.userData.held = true; return l || null; },
    release(l) { if (l) { l.userData.held = false; l.intensity = 0; } },
    pool,
    update(dt) { for (const l of pool) if (!l.userData.held && l.userData.ttl > 0) { l.userData.ttl -= dt; l.intensity = Math.max(0, l.userData.ttl / l.userData.max) * l.userData.peak; } },
  };
}

export async function create(ctx) {
  const q = ctx.quality;
  installHeightFog();
  const app = document.getElementById('app');
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping; // the final pass tone-maps (forward fallback switches to ACES)
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;      // refreshed every other frame in frame()
  renderer.info.autoReset = false;            // count every pass of a frame, reset once per frame
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xffffff, SKY.fogDensity); // colour/shape come from installHeightFog
  scene.background = SKY.horizonAway.clone();
  const camera = new THREE.PerspectiveCamera(PLAYER.fov, 1, 0.05, 900);
  camera.position.set(0, PLAYER.eye, 6);
  scene.add(camera);
  const sky = makeSky(); scene.add(sky);

  // Environment lighting from our own sky (upgrade-path §1): without it, glossy and metal surfaces look dead.
  // refreshEnv() re-captures it after the sky colours change (time of day); it costs a few ms, so throttle it.
  const pmrem = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(), envSky = makeSky(); envSky.material.uniforms.envMode.value = 1; envScene.add(envSky);
  let envRT = null;
  function refreshEnv() {
    try { const old = envRT; envRT = pmrem.fromScene(envScene, 0, 0.1, 1000); scene.environment = envRT.texture; if (old) old.dispose(); }
    catch (e) { console.error('[render] environment capture failed: ' + e.message); }
  }
  refreshEnv(); scene.environmentIntensity = AMBIENT.env ?? 1;
  // Interiors, underground, caves: the sky is the wrong environment (glossy floors would reflect a sky that is not
  // there). captureEnv(pos) renders the built scene into a cube from pos and uses that as the environment instead.
  // Call it once after the level is built (and again after big light changes); ~20-60 ms.
  function captureEnv(pos, { size = 256, near = 0.1, far = 300, hide = [] } = {}) {
    try {
      const crt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
      const cc = new THREE.CubeCamera(near, far, crt); cc.position.copy(pos);
      const was = scene.environment, vis = hide.map((o) => o.visible); hide.forEach((o) => (o.visible = false)); sky.visible = false;
      scene.environment = null; cc.update(renderer, scene); scene.environment = was;
      hide.forEach((o, i) => (o.visible = vis[i])); sky.visible = true;
      const old = envRT; envRT = pmrem.fromCubemap(crt.texture); scene.environment = envRT.texture; if (old) old.dispose(); crt.dispose();
    } catch (e) { console.error('[render] captureEnv failed: ' + e.message); }
  }

  // Key light: one sun, shadow box fitted once to the play area (stable, no swimming).
  const sun = new THREE.DirectionalLight(SUN.color, SUN.intensity);
  const ext = ART.SHADOW_FOLLOW ? ART.SHADOW_FOLLOW / 2 : Math.max(WORLD.max.x - WORLD.min.x, WORLD.max.z - WORLD.min.z) * 0.6;   // SHADOW_FOLLOW: a shadow box of that size that follows the camera (big worlds)
  const centre = WORLD.min.clone().add(WORLD.max).multiplyScalar(0.5); centre.y = 0;
  sun.target.position.copy(centre); sun.position.copy(centre).addScaledVector(SUN.dir, 120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(q.shadow, q.shadow);
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 260 });
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(AMBIENT.sky, AMBIENT.ground, AMBIENT.intensity);
  scene.add(hemi);
  const lights = makeLightPool(scene, LIGHT_POOL);

  // Post chain. If anything fails on this GPU, fall back to plain forward rendering with ACES.
  let composer = null, final = null, bloom = null, gtao = null, volfog = null;
  try {
    const FV = ART.FOG_VOL && ART.FOG_VOL.on && !ctx.params.novol;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: q.msaa });
    if (FV) { rt.depthTexture = new THREE.DepthTexture(1, 1); rt.depthTexture.type = THREE.UnsignedIntType; }   // the volumetric fog pass reads scene depth
    composer = new EffectComposer(renderer, rt);
    if (FV && composer.renderTarget2.depthTexture === rt.depthTexture) { composer.renderTarget2.depthTexture = new THREE.DepthTexture(1, 1); composer.renderTarget2.depthTexture.type = THREE.UnsignedIntType; }
    if (FV && composer.renderTarget2.depthTexture) { composer.renderTarget2.depthTexture.dispose(); composer.renderTarget2.depthTexture = new THREE.DepthTexture(1, 1); composer.renderTarget2.depthTexture.type = THREE.UnsignedIntType; }
    composer.addPass(new RenderPass(scene, camera));
    if (FV) { volfog = new VolumetricFogPass(camera, sun, { ...ART.FOG_VOL, sunDir: SUN.dir, sunCol: SUN.color, steps: Math.round((ART.FOG_VOL.steps || 28) * (q.name === 'low' ? 0.5 : q.name === 'test' ? 0.4 : 1)) }); composer.addPass(volfog); }
    // sanitize: ONE NaN/Inf pixel (a hot specular overflowing half float, a normalize(0) in some shader) is spread by
    // the bloom blur into a big black rectangle. Zero it here, and clamp so bloom never sees absurd values.
    composer.addPass(new ShaderPass({ uniforms: { tDiffuse: { value: null } }, vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); bvec3 bad = bvec3(c.r != c.r || c.r > 6e4, c.g != c.g || c.g > 6e4, c.b != c.b || c.b > 6e4); if (any(bad)) c.rgb = vec3(0.0); gl_FragColor = vec4(min(c.rgb, vec3(2000.0)), 1.0); }` }));
    if (q.ao) {
      gtao = new GTAOPass(scene, camera, 1, 1);
      gtao.blendIntensity = GRADE.ao ?? 0.85;
      // The AO pre-pass draws the scene with an override material: shader-driven geometry (rain, particles,
      // anything transparent) would show up as its raw base mesh. Hide those during the pre-pass.
      const ov = gtao.overrideVisibility.bind(gtao);
      gtao.overrideVisibility = function () { ov(); this.scene.traverse((o) => { if (o.material && (o.material.transparent || o.userData.noAO)) o.visible = false; }); };
      gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: q.name === 'ultra' ? 16 : 12 });
      composer.addPass(gtao);
    }
    if (q.bloom) { bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), GRADE.bloomStrength, GRADE.bloomRadius, GRADE.bloomThreshold); composer.addPass(bloom); }
    final = new ShaderPass(FinalShader); composer.addPass(final);
  } catch (e) { console.error('[render] post chain failed, using forward fallback: ' + e.message); composer = null; }
  const forward = () => { composer = null; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = GRADE.exposure * 0.8; };

  // Adaptive resolution: slow frames drop render scale in steps (logged, never silent).
  let scale = q.scale, slow = 0, frameN = 0;
  function resize() {
    const w = app.clientWidth || innerWidth, h = app.clientHeight || innerHeight;
    // pixel budget: a Retina laptop at dpr 2 renders 4x the pixels of a 1080p screen. Cap the internal
    // resolution per tier (the post chain + MSAA cost scales with pixels); the upscale is barely visible.
    let dpr = Math.min(devicePixelRatio, 2) * scale; const px = w * h * dpr * dpr, budget = q.pixels || 2.3e6;
    if (px > budget) dpr *= Math.sqrt(budget / px);
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (composer) { composer.setPixelRatio(dpr); composer.setSize(w, h); if (final) final.uniforms.texel.value.set(1 / (w * dpr), 1 / (h * dpr)); }
  }
  addEventListener('resize', resize); resize();

  // Self test: render one frame now so shader errors surface at boot, not mid-game.
  renderer.shadowMap.needsUpdate = true;
  try { (composer || renderer).render(scene, camera); } catch (e) { console.error('[render] self test failed: ' + e.message); forward(); }

  return {
    renderer, scene, camera, sun, hemi, sky, lights, passes: { gtao, bloom, final, volfog },
    refreshEnv, captureEnv, syncFogParams,
    setExposure(v) { if (final) final.uniforms.exposure.value = v; else renderer.toneMappingExposure = v * 0.8; },
    updateShadows() { renderer.shadowMap.needsUpdate = true; },
    resize,
    async onLevelReady() { renderer.shadowMap.needsUpdate = true; try { await renderer.compileAsync(scene, camera); } catch {} },
    frame(dt) {
      frameN++;
      if (final) final.uniforms.time.value += dt;
      lights.update(dt);
      if (FOLLOW_SHADOW) { const c = camera.position, t = (2 * ext) / q.shadow; sun.target.position.set(Math.round(c.x / t) * t, 0, Math.round(c.z / t) * t); }
      sun.position.copy(sun.target.position).addScaledVector(SUN.dir, 120);   // follows SUN.dir (time of day moves it in place)
      if ((frameN & 1) === 0 || ctx.params.shot || q.name === 'ultra') renderer.shadowMap.needsUpdate = true; // half-rate shadows
      if (!ctx.params.dt && !ctx.params.shot && !ctx.params.bench && !ctx.params.clip && dt > 0.04 && scale > 0.5) { if (++slow > 90) { scale = Math.max(0.5, scale - 0.1); slow = 0; resize(); console.log('[render] slow frames: render scale -> ' + scale.toFixed(2)); } }
      else slow = Math.max(0, slow - 1);
      renderer.info.reset();
      try { if (composer) composer.render(dt); else renderer.render(scene, camera); }
      catch (e) { console.error('[render] post chain threw, forward fallback: ' + e.message); forward(); }
    },
    stats() { const i = renderer.info.render; return { calls: i.calls, tris: i.triangles, scale: +scale.toFixed(2), tex: renderer.info.memory.textures, geo: renderer.info.memory.geometries, programs: renderer.info.programs?.length }; },
  };
}
