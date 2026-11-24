// HAZE: light scattered by rain mist around bright lights (a canopy, a shop window, a street lamp). Height fog has one
// colour; real wet air glows around every light and that glow is what sells "night + rain" in a photo.
// An additive box drawn with its BACK faces: per pixel the ray from the camera is clipped to the box, then 10 samples
// integrate a density = sum over sources of colour * exp(-distance to the source's box / radius) * (below the source).
// Objects between the camera and the box's back face hide the glow behind them (depth test); glow in front of an object
// inside the volume is lost (cheap, no depth texture). Keep it subtle: strength ~0.02-0.06.
//   import { makeHaze } from '../lib/haze.js';
//   const haze = makeHaze(ctx, [{ min: [x0, y0, z0], max: [x1, y1, z1], radius: 3, color: [r, g, b] }, ...], { strength: 0.04 });
//   every frame: haze.update(dt)
import * as THREE from 'three';

export function makeHaze(ctx, sources, { strength = 0.04, pad = 3, noise = 0.5, exclude = null } = {}) {   // exclude: [min, max] of an interior with no mist
  const N = Math.min(6, sources.length), bmin = new THREE.Vector3(1e9, 1e9, 1e9), bmax = new THREE.Vector3(-1e9, -1e9, -1e9);
  const smin = [], smax = [], scol = [];
  for (let i = 0; i < 6; i++) { const s = sources[i]; if (!s) { smin.push(new THREE.Vector4(1e6, 1e6, 1e6, 1)); smax.push(new THREE.Vector3(1e6, 1e6, 1e6)); scol.push(new THREE.Color(0, 0, 0)); continue; }
    smin.push(new THREE.Vector4(...s.min, s.radius ?? 3)); smax.push(new THREE.Vector3(...s.max)); scol.push(new THREE.Color(...s.color));
    const r = (s.radius ?? 3) * pad; bmin.min(new THREE.Vector3(s.min[0] - r, 0, s.min[2] - r)); bmax.max(new THREE.Vector3(s.max[0] + r, s.max[1] + r * 0.3, s.max[2] + r)); }
  bmin.y = Math.max(bmin.y, -0.5);
  const size = bmax.clone().sub(bmin), ctr = bmin.clone().add(bmax).multiplyScalar(0.5);
  const U = { uMin: { value: bmin }, uMax: { value: bmax }, sMin: { value: smin }, sMax: { value: smax }, sCol: { value: scol }, uK: { value: strength }, uT: { value: 0 }, uNoise: { value: noise }, exMin: { value: new THREE.Vector3(...(exclude ? exclude[0] : [1e6, 1e6, 1e6])) }, exMax: { value: new THREE.Vector3(...(exclude ? exclude[1] : [1e6, 1e6, 1e6])) } };
  const mat = new THREE.ShaderMaterial({ uniforms: U, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uMin, uMax; uniform vec4 sMin[6]; uniform vec3 sMax[6]; uniform vec3 sCol[6]; uniform float uK, uT, uNoise; uniform vec3 exMin, exMax; varying vec3 vW;
      float hh(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(hh(i), hh(i+vec3(1,0,0)), f.x), mix(hh(i+vec3(0,1,0)), hh(i+vec3(1,1,0)), f.x), f.y), mix(mix(hh(i+vec3(0,0,1)), hh(i+vec3(1,0,1)), f.x), mix(hh(i+vec3(0,1,1)), hh(i+vec3(1,1,1)), f.x), f.y), f.z); }
      vec3 dens(vec3 p, vec3 rd){ vec3 c = vec3(0.0);
        for (int i = 0; i < ${N}; i++) { vec3 q = max(max(sMin[i].xyz - p, p - sMax[i]), 0.0); float below = smoothstep(sMax[i].y + 0.5, sMin[i].y - 0.5, p.y) * 0.75 + 0.25;
          vec3 toS = clamp(p, sMin[i].xyz, sMax[i]) - p; toS.y = (sMin[i].y + sMax[i].y) * 0.5 - p.y; float ph = 0.25 + 1.5 * pow(max(dot(rd, normalize(toS + vec3(0.0, 1e-3, 0.0))), 0.0), 3.0);   // forward scattering: the mist glows most when you look toward the light
          c += sCol[i] * exp(-length(q) / sMin[i].w) * below * ph; }
        return c; }
      void main(){
        vec3 ro = cameraPosition, rd = normalize(vW - ro);
        vec3 t0 = (uMin - ro) / rd, t1 = (uMax - ro) / rd, tn = min(t0, t1); float tin = max(max(max(tn.x, tn.y), tn.z), 0.0), tout = length(vW - ro);
        float L = tout - tin; if (L <= 0.0) discard;
        vec3 acc = vec3(0.0); float dt = L / 10.0, j = hh(vec3(gl_FragCoord.xy, uT)) * dt;
        for (int k = 0; k < 10; k++) { vec3 p = ro + rd * (tin + j + dt * float(k)); if (all(greaterThan(p, exMin)) && all(lessThan(p, exMax))) continue; float n = 1.0 - uNoise + uNoise * vn(p * vec3(0.6, 0.25, 0.6) + vec3(0.0, uT * 1.5, 0.0)); acc += dens(p, rd) * n; }
        gl_FragColor = vec4(acc * dt * uK, 1.0);
      }` });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat); mesh.position.copy(ctr); mesh.frustumCulled = false; mesh.renderOrder = 9; mesh.userData.noAO = true;
  ctx.scene.add(mesh);
  return { mesh, uniforms: U, update(dt) { U.uT.value += dt; } };
}
