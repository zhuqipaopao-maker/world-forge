// RAIN-WORLD SCENERY: puddle films, ink-wash hill layers, weeping willow, rain streaks, eave drips (from the water-town test run).
import * as THREE from 'three';
import { SKY } from '../art.js';
import { barkMaterial } from './vegetation.js';
import { worldUV } from '../modules/mats.js';

const rnd = (s) => { let x = s >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); };

// ---- puddles: glossy dark films over the stones, alpha from warped blobs; rain rings in the normal ------------
function puddleAlpha(seed) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), r = rnd(seed);
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9; i++) {
    const x = 128 + (r() - 0.5) * 110, y = 128 + (r() - 0.5) * 70, rad = 30 + r() * 55;
    const gr = g.createRadialGradient(x, y, rad * 0.35, x, y, rad); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rad, rad * (0.5 + r() * 0.4), r() * 3, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c); return t;
}
export function makePuddles(ctx, spots, { color = [0.045, 0.05, 0.052], opacity = 0.85 } = {}) {   // indoors on polished stone: color ~0.1, opacity ~0.55 (a film, not a black pool)
  const tex = [puddleAlpha(3), puddleAlpha(7), puddleAlpha(11)];
  const time = { value: 0 };
  const mats = tex.map((t) => {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(...color), roughness: 0.06, opacity, metalness: 0, alphaMap: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, envMapIntensity: 1.0 });
    m.onBeforeCompile = (s) => {   // rain rings: perturb the normal with expanding rings in random cells
      s.uniforms.uT = time;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPW;').replace('#include <project_vertex>', '#include <project_vertex>\nvPW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vPW; uniform float uT;
        float ph(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        vec2 ringN(vec2 p, float cell, float t){ vec2 q = p / cell, i = floor(q); vec2 n = vec2(0.0);
          for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) { vec2 c = i + vec2(dx, dy); float r1 = ph(c), r2 = ph(c + 4.1);
            vec2 d = q - (c + 0.2 + 0.6 * vec2(r1, r2)); float age = fract(t * (0.9 + 0.6 * r1) + r2), L = length(d) * cell + 1e-4, band = L - age * 0.22;
            n += d / L * sin(band * 140.0) * exp(-band * band * 3000.0) * (1.0 - age); }
          return n; }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          { vec2 rn = ringN(vPW.xz, 0.35, uT * 1.2) + ringN(vPW.xz + 0.17, 0.5, uT * 0.9); normal = normalize(normal + (viewMatrix * vec4(rn.x * 0.35, 0.0, rn.y * 0.35, 0.0)).xyz); }`);
    };
    return m;
  });
  const r = rnd(91);
  for (const s of spots) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.d).rotateX(-Math.PI / 2), mats[Math.floor(r() * 3)]);
    m.position.set(s.x, 0.012, s.z); m.rotation.y = s.yaw ?? r() * 3; m.receiveShadow = true; m.renderOrder = 1; m.userData.noAO = true; ctx.scene.add(m);
  }
  return { update(dt) { time.value += dt; } };
}

// ---- hills: two ink-wash layers of ridges beyond both ends of the canal, unlit, coloured toward the sky ----------
export function makeHills(ctx) {
  const r = rnd(5);
  for (const [dist, hmax, k] of [[170, 20, 0.7], [260, 34, 0.85]]) for (const side of [-1, 1]) {
    const n = 90, pos = [], idx = [];
    const ph = [r() * 6, r() * 6, r() * 6];
    for (let i = 0; i <= n; i++) {
      const t = i / n, z = (t - 0.5) * dist * 2.2;
      const h = hmax * (0.35 + 0.4 * Math.pow(Math.abs(Math.sin(t * 3.1 + ph[0])), 1.5) + 0.2 * Math.sin(t * 11 + ph[1]) + 0.08 * Math.sin(t * 37 + ph[2]));
      const x = side * (dist + 10 * Math.sin(t * 5 + ph[1]));
      pos.push(x, -40, z, x, Math.max(4, h), z);
      if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const col = SKY.horizonAway.clone().lerp(SKY.horizon, side > 0 ? 0.6 : 0.1).multiplyScalar(k + (1 - k) * 0.35);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, fog: false }));
    m.renderOrder = -0.5; ctx.scene.add(m);
  }
}

// ---- weeping willow: bent trunk, arching branch tubes, ~90 hanging strands of small leaves that sway ----------
let strandTex = null;
function willowTex() {
  if (strandTex) return strandTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 512; const g = c.getContext('2d'), r = rnd(17);
  g.clearRect(0, 0, 64, 512);
  for (let s = 0; s < 3; s++) {
    const x0 = 14 + s * 18 + (r() - 0.5) * 6;
    g.strokeStyle = 'rgba(70,80,40,1)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x0, 0); g.bezierCurveTo(x0 + 4, 170, x0 - 4, 340, x0 + (r() - 0.5) * 6, 500 - s * 40); g.stroke();
    for (let y = 4; y < 500 - s * 40; y += 7 + r() * 5) {
      const side = r() < 0.5 ? -1 : 1, len = 10 + r() * 9, l = 150 + r() * 70;
      g.fillStyle = `rgb(${(l * 0.62) | 0},${l | 0},${(l * 0.34) | 0})`;
      g.save(); g.translate(x0 + Math.sin(y * 0.02) * 3, y); g.rotate(side * (0.35 + r() * 0.3)); g.beginPath(); g.ellipse(side * len * 0.5, len * 0.15, len * 0.55, 2.2, 0.5 * side, 0, 7); g.fill(); g.restore();
    }
  }
  strandTex = new THREE.CanvasTexture(c); strandTex.colorSpace = THREE.SRGBColorSpace; return strandTex;
}
export function makeWillow(ctx, { x, z, lean = [0, -1], seed = 1, height = 6.5, groundY = 0 }) {
  const r = rnd(seed), g = new THREE.Group();
  const L = new THREE.Vector2(...lean).normalize();
  // trunk: a bent tube from the ground, leaning over the water
  const tp = [0, 0.3, 0.55, 0.8, 1].map((t) => new THREE.Vector3(L.x * t * t * 1.3, t * height * 0.45, L.y * t * t * 1.3));
  const trunk = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tp), 16, 0.27, 9, false);
  const barkM = barkMaterial(ctx);
  const top = tp[tp.length - 1];
  const branches = [], tips = [];
  for (let b = 0; b < 11; b++) {
    const a = (b / 11) * Math.PI * 2 + r() * 0.6, rad = 2.0 + r() * 1.8;
    const dir = new THREE.Vector3(Math.cos(a) + L.x * 0.8, 0, Math.sin(a) + L.y * 0.8).normalize();
    const p0 = top.clone().add(new THREE.Vector3(0, -0.4 - r() * 0.8, 0));
    const p1 = p0.clone().addScaledVector(dir, rad * 0.4).add(new THREE.Vector3(0, 1.6 + r() * 1.0, 0));
    const p2 = p0.clone().addScaledVector(dir, rad).add(new THREE.Vector3(0, 0.9 + r() * 0.6, 0));
    const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
    branches.push(new THREE.TubeGeometry(curve, 10, 0.075 - b * 0.003, 6, false));
    for (let i = 0; i < 12; i++) { const t = 0.2 + 0.8 * (i / 11); tips.push(curve.getPoint(t).add(new THREE.Vector3((r() - 0.5) * 0.4, 0, (r() - 0.5) * 0.4))); }
  }
  for (const geo of [trunk, ...branches]) { worldUV(geo, 1); const m = new THREE.Mesh(geo, barkM); m.castShadow = true; g.add(m); }
  // strands: crossed vertical cards hanging from the tips, length grows toward the outside
  const sp = [], su = [], sh = [];
  for (const tip of tips) {
    const len = Math.min(tip.y - 0.4 - groundY, 2.2 + r() * 2.6), w = 0.32;
    for (const rot of [0, Math.PI / 2]) {
      const a = rot + r() * 0.6, cx = Math.cos(a) * w / 2, cz = Math.sin(a) * w / 2;
      const base = sp.length / 3;
      const seg = 6;
      for (let j = 0; j <= seg; j++) { const t = j / seg, y = tip.y - t * len; sp.push(tip.x - cx, y, tip.z - cz, tip.x + cx, y, tip.z + cz); su.push(0, 1 - t, 1, 1 - t); sh.push(t, t); }
      for (let j = 0; j < seg; j++) { const a0 = base + j * 2; idxS.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3); }
    }
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2)); sg.setAttribute('hang', new THREE.Float32BufferAttribute(sh, 1)); sg.setIndex(idxS.splice(0)); sg.computeVertexNormals();
  const time = { value: 0 };
  const sm = new THREE.MeshStandardMaterial({ map: willowTex(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, color: new THREE.Color(0.62, 0.68, 0.52) });
  sm.onBeforeCompile = (s) => {
    s.uniforms.uT = time;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float hang; uniform float uT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float sw = hang * hang; vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
        transformed.x += sw * (0.22 * sin(uT * 1.3 + wp0.z * 0.7 + wp0.y) + 0.06 * sin(uT * 3.7 + wp0.x * 2.0));
        transformed.z += sw * (0.12 * sin(uT * 1.1 + wp0.x * 0.6) + 0.05 * cos(uT * 4.1 + wp0.y * 3.0));`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n objectNormal = normalize(vec3(0.0, 0.6, 0.0) + normalize(position - vec3(0.0, position.y, 0.0) + 1e-4));');
  };
  const strands = new THREE.Mesh(sg, sm); strands.castShadow = true; strands.receiveShadow = true; g.add(strands);
  g.position.set(x, groundY, z); ctx.scene.add(g);
  return { group: g, update(dt) { time.value += dt; } };
}
const idxS = [];

// ---- rain streaks (fx.js makeRain had the same shader without DoubleSide: every streak was back-face culled) ----------------------
export function makeRainStreaks(ctx, count) {
  const P = new Float32Array(count * 12), S = new Float32Array(count * 12), I = new Uint32Array(count * 6), r = rnd(4242);
  const corner = [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0];
  for (let i = 0; i < count; i++) { const a = r(), b = r(), c = r(); for (let v = 0; v < 4; v++) { P.set(corner.slice(v * 3, v * 3 + 3), i * 12 + v * 3); S.set([a, b, c], i * 12 + v * 3); } I.set([0, 1, 2, 0, 2, 3].map((k) => k + i * 4), i * 6); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('aSeed', new THREE.BufferAttribute(S, 3)); geo.setIndex(new THREE.BufferAttribute(I, 1));
  const U = { uT: { value: 0 }, uCam: { value: new THREE.Vector3() }, uK: { value: 1 } };
  const mat = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,   // the quad faces away from the camera (side = cross(fall, toCam) is screen-left): without DoubleSide every streak is back-face culled
    vertexShader: `attribute vec3 aSeed; uniform float uT; uniform vec3 uCam; varying float vA; varying float vX; varying float vY;
      void main(){
        vec3 B = vec3(22.0, 12.0, 22.0);
        vec3 p = aSeed * B; p.y -= uT * (8.0 + 2.5 * aSeed.x); p.x += uT * 0.6;
        p = mod(p - uCam + 0.5 * B, B) - 0.5 * B + uCam;
        vec3 fallD = normalize(vec3(0.07, -1.0, 0.02));
        vec3 toC = uCam - p; float d = length(toC);
        vec3 sideD = normalize(cross(fallD, toC / max(d, 1e-3)));
        float w = 0.008 * max(1.0, d * 0.09);
        vec3 wp = p + sideD * position.x * w - fallD * position.y * 0.75;
        vX = position.x * 2.0; vY = position.y;
        vA = smoothstep(0.6, 2.0, d) * (1.0 - smoothstep(8.0, 11.0, d));
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: `uniform float uK; varying float vA; varying float vX; varying float vY;
      void main(){ float a = (1.0 - abs(vX)) * vY * vA * uK; gl_FragColor = vec4(vec3(0.75, 0.8, 0.86) * a * 0.55, 1.0); }` });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 10; m.userData.noAO = true;
  ctx.scene.add(m);
  return { mesh: m, update(dt, inside) { U.uT.value += dt; U.uCam.value.copy(ctx.camera.position); U.uK.value += ((inside ? 0 : 1) - U.uK.value) * Math.min(1, dt * 4); } };
}

// ---- eave drips: water falling from the tile ends in lines, one drop stream per cover-tile row ------------------
// eaves: [{a: Vector3, b: Vector3}] world segments; drops fall to groundY (0, or the canal for quay-side eaves)
export function makeEaveDrips(ctx, eaves, { spacing = 0.235, groundAt = () => 0 } = {}) {
  const P = [], S = [], I = [];
  let n = 0; const r = rnd(99);
  for (const e of eaves) {
    const len = e.a.distanceTo(e.b), k = Math.max(1, Math.floor(len / spacing));
    for (let i = 0; i <= k; i++) {
      if (r() < 0.25) continue;
      const p = e.a.clone().lerp(e.b, i / k), h = Math.max(0.5, p.y - groundAt(p.x, p.z));
      for (let v = 0; v < 4; v++) { P.push(v === 1 || v === 2 ? 0.5 : -0.5, v >= 2 ? 1 : 0, 0); S.push(p.x, p.y, p.z, h, r(), 0.6 + r() * 1.6); }
      const b = n * 4; I.push(b, b + 1, b + 2, b, b + 2, b + 3); n++;
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  const SA = new Float32Array(S); const ib = new THREE.InterleavedBuffer(SA, 6);
  geo.setAttribute('aSrc', new THREE.InterleavedBufferAttribute(ib, 3, 0)); geo.setAttribute('aDrop', new THREE.InterleavedBufferAttribute(ib, 3, 3)); geo.setIndex(I);
  const U = { uT: { value: 0 } };
  const mat = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `attribute vec3 aSrc; attribute vec3 aDrop; uniform float uT; varying float vA; varying float vX; varying float vY;
      void main(){
        float h = aDrop.x, T = sqrt(2.0 * h / 9.8);
        float cyc = uT * aDrop.z / max(T, 0.3) + aDrop.y * 7.0, ph = fract(cyc);
        float t = ph * max(T, 0.3) * 1.6;                          // a pause at the eave while the next drop gathers
        float fallN = min(t, T), y = aSrc.y - 0.5 * 9.8 * fallN * fallN, v = 9.8 * fallN;
        vec3 p = vec3(aSrc.x, y, aSrc.z);
        vec3 toC = cameraPosition - p; float d = length(toC);
        vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), toC / max(d, 1e-3)));
        float L = 0.03 + v * 0.018, w = 0.006 * max(1.0, d * 0.1);
        vec3 wp = p + side * position.x * w + vec3(0.0, 1.0, 0.0) * position.y * L;
        vX = position.x * 2.0; vY = position.y;
        vA = step(t, T) * smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(14.0, 22.0, d));
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: `varying float vA; varying float vX; varying float vY;
      void main(){ float a = (1.0 - abs(vX)) * (0.4 + 0.6 * vY) * vA; if (a <= 0.001) discard; gl_FragColor = vec4(vec3(0.8, 0.84, 0.9) * a * 0.9, 1.0); }` });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 10; m.userData.noAO = true; ctx.scene.add(m);
  return { mesh: m, count: n, update(dt) { U.uT.value += dt; } };
}
