// VOLUMETRIC FOG: a post pass that marches each pixel's view ray through a fog volume up to the scene depth, with the
// SUN'S SHADOW MAP deciding which parts of the fog are lit. One effect gives both the valley fog banks that glow toward
// a low sun and the light shafts that fall through broken roofs and windows (the shafts are the lit fog between the
// shadows). Needs the scene render target's depth texture (render.js adds it when FOG_VOL.on).
//   art.js: export const FOG_VOL = { on: true, density: 0.012, base: 0, height: 18, banks: 1.2, bankScale: 0.018,
//            g: 0.65, sun: 1.0, amb: [r,g,b], maxDist: 260, steps: 28, interior: [] };
//   density: extinction per metre at the fog base; height: metres over which it falls to 1/e; banks: extra density in
//   drifting noise banks; g: forward-scattering (glow toward the sun); interior: boxes [min, max] whose air is still,
//   indoor dust (lower density, no banks, shafts only where the sun gets in).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const FS = /* glsl */`
  #include <packing>
  uniform sampler2D tDiffuse, tDepth, shadowMap; uniform mat4 shadowMatrix, invProj, camWorld; uniform vec3 camPos, sunDir, sunCol, ambCol;
  uniform float density, base, height, banks, bankScale, g, sunK, maxDist, time, hasShadow; uniform int steps;
  uniform vec3 inMin[4], inMax[4]; uniform float inDust;
  varying vec2 vUv;
  float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z); }
  float inside(vec3 p){ for (int i = 0; i < 4; i++) if (all(greaterThan(p, inMin[i])) && all(lessThan(p, inMax[i]))) return 1.0; return 0.0; }
  float dens(vec3 p, float indoor){
    float hz = exp(-max(p.y - base, 0.0) / height);
    vec3 q = p * bankScale + vec3(time * 0.004, 0.0, time * 0.0025);
    float b = n3(q) * 0.65 + n3(q * 2.7 + 7.1) * 0.35;
    float bank = smoothstep(0.5, 0.85, b) * exp(-max(p.y - base, 0.0) / (height * 0.6));
    float d = density * (hz + banks * bank);
    return mix(d, density * inDust, indoor);
  }
  float sunVis(vec3 p){
    if (hasShadow < 0.5) return 1.0;
    vec4 sc = shadowMatrix * vec4(p, 1.0); sc.xyz /= sc.w;
    if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
    return step(sc.z - 0.0015, unpackRGBAToDepth(texture2D(shadowMap, sc.xy)));
  }
  void main(){
    vec4 col = texture2D(tDiffuse, vUv);
    float dz = texture2D(tDepth, vUv).x;
    vec4 ndc = vec4(vUv * 2.0 - 1.0, dz * 2.0 - 1.0, 1.0);
    vec4 vp = invProj * ndc; vp /= vp.w;
    vec3 wp = (camWorld * vec4(vp.xyz, 1.0)).xyz;
    vec3 rd = wp - camPos; float L = length(rd); rd /= L;
    if (dz >= 0.99999) L = maxDist;   // sky
    L = min(L, maxDist);
    float mu = dot(rd, normalize(sunDir)), g2 = g * g;
    float hg = (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * mu, 1.5)) * 4.0 * 3.14159;   // normalised to 1 for isotropic
    float ph = mix(1.0, hg, 0.85);
    float n = float(steps), dt = L / n;
    float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));   // interleaved gradient noise
    vec3 scat = vec3(0.0); float T = 1.0;
    for (int i = 0; i < 64; i++) {
      if (i >= steps) break;
      float t = (float(i) + jit) * dt; vec3 p = camPos + rd * t;
      float indoor = inside(p);
      float d = dens(p, indoor);
      if (d > 1e-5) {
        float vis = sunVis(p);
        vec3 Ls = sunCol * sunK * ph * vis + ambCol * (1.0 - 0.7 * indoor);
        float a = 1.0 - exp(-d * dt);
        scat += T * a * Ls; T *= 1.0 - a;
        if (T < 0.01) break;
      }
    }
    gl_FragColor = vec4(col.rgb * T + scat, 1.0);
  }`;

export class VolumetricFogPass extends Pass {
  constructor(camera, sun, opts) {
    super();
    this.camera = camera; this.sun = sun; this.o = opts;
    const inMin = [], inMax = []; for (let i = 0; i < 4; i++) { const b = (opts.interior || [])[i]; inMin.push(new THREE.Vector3(...(b ? b[0] : [1e6, 1e6, 1e6]))); inMax.push(new THREE.Vector3(...(b ? b[1] : [1e6, 1e6, 1e6]))); }
    this.uniforms = {
      tDiffuse: { value: null }, tDepth: { value: null }, shadowMap: { value: null }, shadowMatrix: { value: new THREE.Matrix4() }, hasShadow: { value: 0 },
      invProj: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, camPos: { value: new THREE.Vector3() },
      sunDir: { value: opts.sunDir }, sunCol: { value: opts.sunCol }, ambCol: { value: new THREE.Color(...opts.amb) },
      density: { value: opts.density }, base: { value: opts.base ?? 0 }, height: { value: opts.height ?? 18 }, banks: { value: opts.banks ?? 1 }, bankScale: { value: opts.bankScale ?? 0.018 },
      g: { value: opts.g ?? 0.65 }, sunK: { value: opts.sun ?? 1 }, maxDist: { value: opts.maxDist ?? 260 }, steps: { value: opts.steps ?? 28 }, time: { value: 0 },
      inMin: { value: inMin }, inMax: { value: inMax }, inDust: { value: opts.inDust ?? 0.25 },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: FS, depthTest: false, depthWrite: false });
    this.fsQuad = new FullScreenQuad(this.material);
  }
  setInterior(list) { list.slice(0, 4).forEach((b, i) => { this.uniforms.inMin.value[i].set(...b[0]); this.uniforms.inMax.value[i].set(...b[1]); }); }
  render(renderer, writeBuffer, readBuffer, dt) {
    const u = this.uniforms, cam = this.camera, sh = this.sun.shadow;
    u.tDiffuse.value = readBuffer.texture; u.tDepth.value = readBuffer.depthTexture;
    u.invProj.value.copy(cam.projectionMatrixInverse); u.camWorld.value.copy(cam.matrixWorld); u.camPos.value.setFromMatrixPosition(cam.matrixWorld);
    if (sh && sh.map) { u.shadowMap.value = sh.map.texture; u.shadowMatrix.value.copy(sh.matrix); u.hasShadow.value = 1; }
    u.time.value += dt || 0;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.fsQuad.render(renderer);
  }
}
