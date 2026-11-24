// GLOSS FLOOR: a planar mirror laid over a polished floor (granite, terrazzo, wet concrete, a lacquered stage).
// The floor keeps its own PBR material; this is a thin additive layer on top that adds what the environment map
// cannot: a sharp-to-blurry reflection of the real scene (columns, light strips, people) that lines up with them.
//   const gloss = makeGlossFloor(ctx, { x0, x1, z0, z1, y: 0.002, strength: 0.9, tile: 0.6 });
//   gloss.hideInMirror.push(someObject); every frame: gloss.update(dt)
// Gotcha (also in water.js): the Reflector's mirror plane is the MESH's local XY: rotate the mesh, never the geometry.
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

const VS = /* glsl */`
  uniform mat4 textureMatrix; varying vec4 vRefl; varying vec3 vW;
  #include <fog_pars_vertex>
  void main(){ vRefl = textureMatrix * vec4(position, 1.0); vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
    vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const FS = /* glsl */`
  uniform sampler2D tDiffuse, grimeMap; uniform float strength, blur, tile, scuffK, hasGrime, time; uniform vec2 texel; uniform vec4 grimeRect; varying vec4 vRefl; varying vec3 vW;
  #include <fog_pars_fragment>
  float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hh(i), hh(i+vec2(1,0)), f.x), mix(hh(i+vec2(0,1)), hh(i+vec2(1,1)), f.x), f.y); }
  void main(){
    vec3 V = normalize(cameraPosition - vW); float cosv = abs(V.y);
    float F = 0.06 + 0.94 * pow(1.0 - cosv, 5.0);   // polished + waxed stone
    // where the floor is worn the reflection blurs and dims: scuffed walking zones, the grout lines between tiles
    float scuff = smoothstep(0.35, 0.8, vn(vW.xz * 0.35) * 0.6 + vn(vW.xz * 1.7) * 0.4);
    vec2 g = fract(vW.xz / tile); float jd = min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y)) * tile;
    float joint = smoothstep(0.002, 0.006, jd);
    vec2 uv = vRefl.xy / vRefl.w;
    uv += (vec2(vn(vW.xz * 2.5), vn(vW.xz * 2.5 + 7.3)) - 0.5) * 0.0018;          // stone is never optically flat (a slow, small wobble; more turns light strips into zigzags)
    vec4 gm = hasGrime > 0.5 ? texture2D(grimeMap, (vW.xz - grimeRect.xy) / grimeRect.zw) : vec4(0.0);
    float grime = max(gm.r, gm.g * 0.9), wet = gm.b;   // the contact-shadow darkening (green) also kills the reflection: else the mirror washes AO out   // red: dirt and gum do not mirror; blue: wet (mopped) patches mirror sharper and stronger
    // each tile was polished differently: its own blur and strength
    vec2 tid = floor(vW.xz / tile); float tr = hh(tid), tr2 = hh(tid + 17.3);
    float dist = length(cameraPosition - vW);
    float r = blur * (0.6 + 1.6 * scuff * scuffK) * (0.7 + 0.8 * tr) * (1.0 - 0.6 * wet);
    // anisotropic: a light on polished stone smears into a streak toward the viewer (screen-vertical), more with distance
    float stretch = 1.5 + min(dist, 25.0) * 0.22;
    // rain rings on standing water (blue mask): each cell one drop, an expanding ring that bends the reflection
    vec2 ripple = vec2(0.0);
    if (wet > 0.05) { vec2 q = vW.xz / 0.33, ci = floor(q);
      for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) { vec2 cc = ci + vec2(dx, dy); float r1 = hh(cc), r2 = hh(cc + 4.1);
        vec2 dd = q - (cc + 0.2 + 0.6 * vec2(r1, r2)); float age = fract(time * (0.9 + 0.6 * r1) + r2), L = length(dd) * 0.33 + 1e-4, band = L - age * 0.2;
        ripple += dd / L * sin(band * 150.0) * exp(-band * band * 2500.0) * (1.0 - age); }
      ripple *= 0.0013 * wet / (1.0 + dist * 0.15); }
    vec3 c = vec3(0.0); float wsum = 0.0;
    // jittered taps: with a wide blur, fixed taps print ghost copies of each light (rings / moire); a per-pixel offset turns them into fine grain
    // mip-filtered blur: the mirror target has mipmaps, so a wide blur is a few taps at a coarser level (no ghost copies,
    // no per-pixel noise: jittered taps read as "sparkly noise" to a critic). Taps run along screen-vertical (the streak).
    float lod = clamp(log2(max(r, 1.0)), 0.0, 5.0), sp = exp2(lod);
    for (int j = -4; j <= 4; j++) { float o = float(j) * 0.5; float w = exp(-o * o * 0.25);
      c += textureLod(tDiffuse, uv + ripple + vec2(0.0, o * texel.y * sp * stretch), lod).rgb * w; wsum += w; }
    c /= wsum;
    float k = strength * F * joint * (1.0 - 0.55 * scuff * scuffK) * (1.0 - 0.85 * grime) * (0.65 + 0.6 * tr2) * (1.0 + 1.2 * wet);
    gl_FragColor = vec4(c * k, 1.0);
    #include <fog_fragment>
  }`;

export function makeGlossFloor(ctx, { x0, x1, z0, z1, y = 0.002, strength = 1, blur = 1.5, tile = 0.6, scuff = 1, scale: sc, every = 1 }) {   // every: re-render the mirror every n-th frame (big outdoor scenes)
  const q = ctx.quality, scale = sc ?? (q.name === 'ultra' ? 0.5 : q.name === 'high' ? 0.4 : 0.3);
  const w = Math.round(innerWidth * Math.min(devicePixelRatio, 2) * scale), h = Math.round(innerHeight * Math.min(devicePixelRatio, 2) * scale);
  const refl = new Reflector(new THREE.PlaneGeometry(x1 - x0, z1 - z0), { textureWidth: w, textureHeight: h, clipBias: 0.002, multisample: 0 });
  { const t = refl.getRenderTarget().texture; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; }   // for the mip-filtered blur
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    tDiffuse: { value: null }, textureMatrix: { value: null }, strength: { value: strength }, blur: { value: blur }, tile: { value: tile }, scuffK: { value: scuff },
    texel: { value: new THREE.Vector2(1 / w, 1 / h) }, time: { value: 0 }, grimeMap: { value: null }, hasGrime: { value: 0 }, grimeRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  }]);
  uniforms.tDiffuse.value = refl.material.uniforms.tDiffuse.value;
  uniforms.textureMatrix.value = refl.material.uniforms.textureMatrix.value;
  uniforms.fogTOD = THREE.UniformsLib.fog.fogTOD;
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader: ctx.params.gsimple ? 'void main(){ gl_FragColor = vec4(0.0); }' : FS, fog: !ctx.params.gsimple, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  mat.polygonOffset = true; mat.polygonOffsetFactor = -2;
  refl.material.dispose(); refl.material = mat;
  refl.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); refl.rotation.x = -Math.PI / 2;
  refl.userData.noAO = true; refl.renderOrder = 1;
  const hideInMirror = [];
  const orig = refl.onBeforeRender;
  refl.onBeforeRender = function (r, s, c) {
    if (c.userData.isMirror) return;
    if (every > 1 && (++refl.userData.n || (refl.userData.n = 1)) % every !== 0 && !ctx.params.shot) return;
    const vis = hideInMirror.map((o) => o.visible); hideInMirror.forEach((o) => (o.visible = false));
    orig.call(this, r, s, c);
    hideInMirror.forEach((o, i) => (o.visible = vis[i]));
  };
  ctx.scene.add(refl);
  addEventListener('resize', () => { const W = Math.round(innerWidth * Math.min(devicePixelRatio, 2) * scale), H = Math.round(innerHeight * Math.min(devicePixelRatio, 2) * scale); refl.getRenderTarget().setSize(W, H); uniforms.texel.value.set(1 / W, 1 / H); });
  // setGrime(tex, [x0, z0, width, depth]): a floor-space texture whose RED channel removes the reflection (dirt, gum, mats)
  const setGrime = (tex, r) => { uniforms.grimeMap.value = tex; uniforms.hasGrime.value = 1; uniforms.grimeRect.value.set(...r); };
  return { mesh: refl, uniforms, hideInMirror, setGrime, update(dt = 0.016) { uniforms.time.value += dt; } };
}
