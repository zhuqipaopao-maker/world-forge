// WATER: a canal, river, pond or harbour basin, and (street: true) puddles on paving. A planar mirror (three's Reflector: mirrored camera into a half-float target) read by our own
// shader: rain rings (3 layers of random cells), slow drift ripples, Fresnel between a deep jade body colour and the
// reflection, darkening against the quay walls, the template's height fog on top.
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { SKY } from '../art.js';

const VS = /* glsl */`
  uniform mat4 textureMatrix; varying vec4 vRefl; varying vec3 vW;
  #include <fog_pars_vertex>
  void main(){
    vRefl = textureMatrix * vec4(position, 1.0);
    vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const FS = /* glsl */`
  uniform sampler2D tDiffuse; uniform float time, rain; uniform vec3 deep, shallow, skyCol; uniform vec4 bounds;
  varying vec4 vRefl; varying vec3 vW;
  #include <fog_pars_fragment>
  float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hh(i), hh(i+vec2(1,0)), f.x), mix(hh(i+vec2(0,1)), hh(i+vec2(1,1)), f.x), f.y); }
  // rain rings: each cell holds one drop with its own phase; ring = thin sine band that widens and fades
  float rings(vec2 p, float cell, float t, float seed){
    vec2 q = p / cell, i = floor(q); float s = 0.0;
    for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) {
      vec2 c = i + vec2(dx, dy); float r1 = hh(c + seed), r2 = hh(c + seed + 3.7);
      vec2 ctr = c + 0.2 + 0.6 * vec2(r1, r2);
      float age = fract(t * (0.9 + 0.5 * r1) + r2);
      float d = length(q - ctr) * cell; float R = age * 0.34;
      float band = d - R; float k = exp(-band * band * 2200.0);
      s += sin(band * 120.0) * k * (1.0 - age) * (1.0 - age);
    }
    return s;
  }
  float hgt(vec2 p){
    float t = time;
    float w = (vn(p * vec2(1.3, 2.6) + vec2(t * 0.25, 0.0)) + vn(p * vec2(3.1, 1.7) - vec2(t * 0.17, t * 0.05)) * 0.5) * 0.012;
    float r = rain > 0.01 ? rings(p, 0.55, t * 1.1, 1.0) + rings(p + 0.31, 0.8, t * 0.8, 7.0) + rings(p - 0.17, 0.43, t * 1.3, 13.0) : 0.0;   // 81 ring evaluations per pixel x3 (normals): skip them when it is not raining
    return w + r * 0.006 * rain;
  }
  void main(){
    vec2 p = vW.xz; float e = 0.02;
    float h0 = hgt(p), hx = hgt(p + vec2(e, 0.0)), hz = hgt(p + vec2(0.0, e));
    vec3 N = normalize(vec3(-(hx - h0) / e, 1.0, -(hz - h0) / e));
    vec3 V = normalize(cameraPosition - vW); float dist = length(cameraPosition - vW);
    float fade = 1.0 / (1.0 + dist * 0.05);
    vec2 ruv = vRefl.xy / vRefl.w + N.xz * 0.06 * fade;
    vec3 refl = texture2D(tDiffuse, ruv).rgb * 0.6 + texture2D(tDiffuse, ruv + vec2(0.0, 0.004)).rgb * 0.2 + texture2D(tDiffuse, ruv - vec2(0.0, 0.004)).rgb * 0.2;
    float cosv = max(dot(N, V), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);
    #ifdef STREET
      // puddles in the low spots of the flagstones: soaked halo -> standing water, one signed field
      float n = vn(p * 0.45) * 0.55 + vn(p * 1.6 + 3.1) * 0.3 + vn(p * 5.0 + 7.7) * 0.15;
      float pud = smoothstep(0.6, 0.64, n), soak = smoothstep(0.4, 0.6, n);
      if (soak < 0.01) discard;
      #ifdef HOLE0
      if (vW.z > HOLE0 && vW.z < HOLE1) discard;   // one mirror for both banks: the canal between them is cut out
      #endif
      vec3 wet = refl * mix(0.25, 0.9, F) * mix(0.35, 1.0, pud) + vec3(0.012, 0.014, 0.015);
      gl_FragColor = vec4(wet, max(pud * 0.92, soak * 0.42));
      #include <fog_fragment>
      return;
    #endif
    F = mix(F, 1.0, bounds.z > 0.0 ? bounds.z : 0.35);   // bounds.z: how much the reflection carries (0.35 overcast canal; lower for a river at dawn)
    // quay contact: water darkens and goes greener against the walls (shade + algae)
    float edge = min(vW.z - bounds.x, bounds.y - vW.z);
    float wall = 1.0 - smoothstep(0.0, 0.9, edge);  // (street: unused)
    vec3 body = mix(deep, shallow, 0.35 + 0.3 * vn(p * 0.4));
    body *= 1.0 - 0.4 * wall;
    vec3 col = mix(body, refl * mix(1.0, 0.75, wall), F);
    col += skyCol * 0.25 * pow(max(dot(reflect(-V, N), normalize(vec3(0.6, 0.5, -0.3))), 0.0), 60.0);
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }`;

export function makeCanal(ctx, { x0, x1, z0, z1, y, street = false, scale: sc, msaa = true, hole = null }) {
  const q = ctx.quality, scale = sc ?? (q.name === 'high' || q.name === 'ultra' ? 0.5 : 0.33);
  const w = Math.round(innerWidth * Math.min(devicePixelRatio, 2) * scale), h = Math.round(innerHeight * Math.min(devicePixelRatio, 2) * scale);
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0);   // Reflector: the mirror plane is the mesh's local XY (normal +z), so rotate the MESH, not the geometry
  const refl = new Reflector(geo, { textureWidth: w, textureHeight: h, clipBias: 0.003, multisample: q.msaa && msaa ? 4 : 0 });
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    tDiffuse: { value: null }, textureMatrix: { value: null }, time: { value: 0 }, rain: { value: 1 },
    deep: { value: new THREE.Color(0.01, 0.018, 0.016) }, shallow: { value: new THREE.Color(0.03, 0.05, 0.04) }, skyCol: { value: SKY.horizon.clone() },
    bounds: { value: new THREE.Vector4(z0, z1, 0, 0) },
  }]);
  uniforms.tDiffuse.value = refl.material.uniforms.tDiffuse.value;
  uniforms.textureMatrix.value = refl.material.uniforms.textureMatrix.value;
  uniforms.fogTOD = THREE.UniformsLib.fog.fogTOD;     // shared with the sky (render.js installHeightFog)
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader: ctx.params.wsimple ? '#include <fog_pars_fragment>\nvoid main(){ gl_FragColor = vec4(0.02, 0.03, 0.03, 1.0); }' : FS, fog: true, defines: street ? { STREET: 1, ...(hole ? { HOLE0: hole[0].toFixed(3), HOLE1: hole[1].toFixed(3) } : {}) } : {}, transparent: street, depthWrite: !street });
  if (street) { mat.polygonOffset = true; mat.polygonOffsetFactor = -2; }
  refl.material.dispose(); refl.material = mat;
  refl.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); refl.rotation.x = -Math.PI / 2;
  refl.userData.noAO = true; refl.receiveShadow = false;
  // hide camera-wrapped weather and other water-only things from the mirror pass
  const hideInMirror = [];
  const orig = refl.onBeforeRender;
  refl.onBeforeRender = function (r, s, c) {
    if (c.userData.isMirror) return;
    const vis = hideInMirror.map((o) => o.visible); hideInMirror.forEach((o) => (o.visible = false));
    orig.call(this, r, s, c);
    hideInMirror.forEach((o, i) => (o.visible = vis[i]));
  };
  if (street) refl.renderOrder = 1;
  ctx.scene.add(refl);
  return { mesh: refl, uniforms, hideInMirror, update(dt) { uniforms.time.value += dt; } };
}
// generic name; makeCanal is kept for worlds written against it
export const makeWater = makeCanal;
