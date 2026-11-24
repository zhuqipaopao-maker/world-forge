// GRASS + WEEDS: tufts of blades on crossed cards, instanced, each tuft its own size, lean and colour (pass `light`
// per spot for a baked scene). The edge where paving meets ground is where a place shows its age: weeds in the
// joints, rank grass along the verge, a few tall dry stalks.
//   import { makeGrass } from '../lib/grass.js';
//   makeGrass(ctx, spots)   // spots: [{ x, y, z, s, light: [r,g,b], dry: 0..1 }]
import * as THREE from 'three';

function bladeTex(seed = 1) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
  let q = seed * 9301 + 49297; const r = () => ((q = (q * 16807) % 2147483647) - 1) / 2147483646;
  g.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 55; i++) {
    const x0 = 40 + r() * 176, h = 40 + Math.pow(r(), 0.6) * 210, lean = (r() - 0.5) * 110 * (h / 250), w = 2 + r() * 4, dry = r() < 0.3;   // blades of very different heights: a tuft has a ragged top, not a flat edge
    const gr = g.createLinearGradient(0, 256, 0, 256 - h); gr.addColorStop(0, dry ? '#4a4128' : '#1f2e14'); gr.addColorStop(1, dry ? '#8f8452' : (r() < 0.5 ? '#5d7a35' : '#476a2a'));
    g.fillStyle = gr; g.beginPath(); g.moveTo(x0 - w, 256); g.quadraticCurveTo(x0 + lean * 0.3, 256 - h * 0.6, x0 + lean, 256 - h); g.quadraticCurveTo(x0 + lean * 0.3 + w * 0.4, 256 - h * 0.6, x0 + w, 256); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// shrubs: leafy clumps (bramble, young broadleaf scrub, ferns) on the same crossed cards
function leafTex(seed = 5) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
  let q = seed * 7 + 3; const r = () => ((q = (q * 16807) % 2147483647) - 1) / 2147483646;
  g.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) { const a = r() * 6.283, rr = Math.sqrt(r()), x = 128 + Math.cos(a) * rr * 110, y = 150 - Math.sin(a) * rr * 105 * (Math.sin(a) > 0 ? 1 : 0.85) + 6, l = 55 + r() * 80 + (150 - y) * 0.25, s = 3 + r() * 6;   // a dense dome of small leaves, no visible stems
    g.fillStyle = `rgb(${l * 0.55 | 0},${l | 0},${l * 0.38 | 0})`; g.save(); g.translate(x, y); g.rotate(r() * 6.3); g.beginPath(); g.ellipse(0, 0, s, s * 0.45, 0, 0, 7); g.fill(); g.restore(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
// BLADES (kind 'blades'): a tuft of real curved blades (tapered strips, 3 segments), vertex-coloured dark at the root
// to light at the tip: no card edges anywhere. A critic read the crossed cards as 'blocky alpha cards' twice.
function bladeTuft(n = 16, seed = 1) {
  let q = seed * 9301 + 7; const r = () => ((q = (q * 16807) % 2147483647) - 1) / 2147483646;
  const P = [], C = [], N = [], I = [];
  for (let b = 0; b < n; b++) {
    const kind = r(), stalk = kind < 0.035, broad = !stalk && kind < 0.17, rust = r() < 0.12;   // mixed species: grass, a few seeding stalks (芒/狗尾草), broad weeds (艾/车前), some rust-red dead blades
    const a = r() * 6.283, rad = r() * 0.12, h = stalk ? 0.75 + r() * 0.45 : broad ? 0.1 + r() * 0.16 : 0.18 + Math.pow(r(), 0.8) * 0.5, w = stalk ? 0.006 : broad ? 0.022 + r() * 0.014 : 0.006 + r() * 0.008, lean = stalk ? 0.05 + r() * 0.15 : broad ? 0.8 + r() * 0.6 : 0.15 + r() * 0.5, dir = r() * 6.283, dry = stalk || (!broad && r() < 0.3);
    const bx = Math.cos(a) * rad, bz = Math.sin(a) * rad, base = P.length / 3, sx = -Math.sin(dir), sz = Math.cos(dir);
    for (let k = 0; k <= 3; k++) { const t = k / 3, y = h * t, off = lean * h * t * t, ww = w * (1 - t * 0.85);
      for (const sd of [-1, 1]) { P.push(bx + Math.cos(dir) * off + sx * ww * sd, y, bz + Math.sin(dir) * off + sz * ww * sd); N.push(Math.cos(dir) * 0.3, 0.9, Math.sin(dir) * 0.3);
        const g = broad ? [0.08 + 0.12 * t, 0.15 + 0.2 * t, 0.06 + 0.06 * t] : dry ? (rust ? [0.42 + 0.3 * t, 0.22 + 0.15 * t, 0.12 + 0.06 * t] : [0.42 + 0.35 * t, 0.38 + 0.3 * t, 0.2 + 0.12 * t]) : [0.1 + 0.25 * t, 0.16 + 0.34 * t, 0.06 + 0.12 * t]; C.push(...g); } }
    if (stalk) { const tx = bx + Math.cos(dir) * lean * h, tz = bz + Math.sin(dir) * lean * h;   // the seed head: a plume of three crossed thin quads
      for (let k = 0; k < 3; k++) { const d2 = k * 1.05 + dir, cx = Math.cos(d2) * 0.005, cz = Math.sin(d2) * 0.005, i0 = P.length / 3;
        const tipx = tx + 0.012 * Math.cos(dir), tipz = tz + 0.012 * Math.sin(dir); P.push(tx - cx, h - 0.01, tz - cz, tx + cx, h - 0.01, tz + cz, tipx - cx * 0.15, h + 0.07, tipz - cz * 0.15, tipx + cx * 0.15, h + 0.07, tipz + cz * 0.15);   // a spindle that tapers to a point
        for (let j = 0; j < 4; j++) { N.push(0, 1, 0); C.push(0.5, 0.42, 0.3); } I.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2); } }
    for (let k = 0; k < 3; k++) { const i = base + k * 2; I.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I); return g;
}
// BUSH (kind 'bush'): ~26 small leaf cards scattered through a squashed ellipsoid at random angles: a ragged clump of
// foliage, not 4 crossed cards (which read as 'flat-shaded spheres')
function bushGeo(seed = 3, cells = 0) {
  let q = seed * 4271 + 11; const r = () => ((q = (q * 16807) % 2147483647) - 1) / 2147483646; const parts = [];
  for (let i = 0; i < 26; i++) { const g = new THREE.PlaneGeometry(0.42, 0.42); const u = r() * 6.283, v = Math.acos(2 * r() - 1), rr = Math.cbrt(r()) * 0.4;
    if (cells) { const ix = Math.floor(r() * cells), iy = Math.floor(r() * cells), uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, (ix + 0.015 + uv.getX(k) * 0.97) / cells, (iy + 0.015 + uv.getY(k) * 0.97) / cells); }
    g.rotateX((r() - 0.5) * 3); g.rotateY(r() * 6.283); g.translate(Math.sin(v) * Math.cos(u) * rr, 0.32 + Math.cos(v) * rr * 0.65, Math.sin(v) * Math.sin(u) * rr); parts.push(g); }
  const m = mergeQuads(parts); const Nn = m.attributes.normal, Pp = m.attributes.position;
  for (let i = 0; i < Nn.count; i++) { const x = Pp.getX(i), y = Pp.getY(i) - 0.32, z = Pp.getZ(i), l = Math.hypot(x, y, z) || 1; Nn.setXYZ(i, x / l * 0.6, y / l * 0.6 + 0.6, z / l * 0.6); }   // normals point out of the clump: a rounded mass with a lit top
  return m;
}
export function makeGrass(ctx, spots, { width = 0.42, height = 0.5, kind = 'grass', atlas = null, cells = 3 } = {}) {   // bush + atlas: leaf cards show cells of a photo atlas (RGBA)
  const quads = [];
  if (kind === 'blades') return makeBladeField(ctx, spots);
  const nq = kind === 'shrub' ? 4 : 3; for (let k = 0; k < nq; k++) { const q = new THREE.PlaneGeometry(width, height, 1, 2); q.translate(0, height / 2, 0); q.rotateY(k * Math.PI / nq); quads.push(q); }
  const merged = kind === 'bush' ? bushGeo(5, atlas ? cells : 0) : mergeQuads(quads);
  // normals point up-ish (a tuft is lit like the ground under it, not like a flat card)
  const N = merged.attributes.normal; if (kind !== 'bush') for (let i = 0; i < N.count; i++) { if (kind === 'shrub') N.setXYZ(i, 0, 1, 0); else N.setXYZ(i, N.getX(i) * 0.6, 0.6, N.getZ(i) * 0.6); }   // shrubs: one shade per clump (two-tone cards read as cardboard)
  const mat = new THREE.MeshStandardMaterial({ map: atlas && kind === 'bush' ? atlas : kind === 'shrub' || kind === 'bush' ? leafTex(5) : bladeTex(3), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9, metalness: 0, envMapIntensity: 0.15, color: new THREE.Color(0.85, 0.85, 0.7) });
  mat.alphaToCoverage = true;
  const time = { value: 0 };
  const sunDir = ctx.mats?.surface?.sunDir || { value: new THREE.Vector3(0, 1, 0) }, sunCol = { value: new THREE.Color(1, 0.7, 0.45) };
  mat.onBeforeCompile = (s) => { s.uniforms.uT = time; s.uniforms.uSunDir = sunDir; s.uniforms.uSunCol = sunCol;
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uSunDir, uSunCol;').replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { vec3 V = normalize(vViewPosition); vec3 Sv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz); float tr = pow(max(dot(-V, Sv), 0.0), 3.0); totalEmissiveRadiance += diffuseColor.rgb * uSunCol * (0.08 + 1.4 * tr); }`);   // blades glow when the low sun is behind them
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uT;').replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0); float k = position.y * position.y; transformed.x += sin(uT * 1.7 + ip.x * 0.7 + ip.z * 0.4) * 0.05 * k; transformed.z += cos(uT * 1.3 + ip.x * 0.3) * 0.03 * k; }`); };
  const im = new THREE.InstancedMesh(merged, mat, spots.length); im.receiveShadow = true; im.castShadow = false; im.userData.veg = true;
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  spots.forEach((s, i) => {
    const sc = s.s ?? 1; e.set((Math.random() - 0.5) * 0.15, Math.random() * Math.PI, (Math.random() - 0.5) * 0.15); q4.setFromEuler(e);
    m4.compose(new THREE.Vector3(s.x, s.y ?? 0, s.z), q4, new THREE.Vector3(sc * (0.8 + Math.random() * 0.4), sc * (0.7 + Math.random() * 0.6), sc)); im.setMatrixAt(i, m4);
    const L = s.light || [1, 1, 1], d = s.dry ?? 0; c.setRGB(L[0] * (1 + d * 0.4), L[1] * (1 + d * 0.15), L[2] * (1 - d * 0.2)); im.setColorAt(i, c);
  });
  im.computeBoundingSphere(); ctx.scene.add(im);
  return { mesh: im, update(dt) { time.value += dt; } };
}
function mergeQuads(list) {
  const P = [], Nn = [], U = [], I = []; let base = 0;
  for (const g of list) { const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, idx = g.index;
    for (let i = 0; i < p.count; i++) { P.push(p.getX(i), p.getY(i), p.getZ(i)); Nn.push(n.getX(i), n.getY(i), n.getZ(i)); U.push(uv.getX(i), uv.getY(i)); }
    for (let i = 0; i < idx.count; i++) I.push(idx.getX(i) + base); base += p.count; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); return g;
}

function makeBladeField(ctx, spots) {
  const geos = [bladeTuft(26, 1), bladeTuft(36, 2), bladeTuft(18, 3)];
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85, metalness: 0, envMapIntensity: 0.25 });
  const time = { value: 0 }, sunDir = ctx.mats?.surface?.sunDir || { value: new THREE.Vector3(0, 1, 0) }, sunCol = { value: new THREE.Color(1, 0.7, 0.45) };
  mat.onBeforeCompile = (s) => { s.uniforms.uT = time; s.uniforms.uSunDir = sunDir; s.uniforms.uSunCol = sunCol;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uT;').replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0); float k = position.y * position.y * 2.0; transformed.x += sin(uT * 1.7 + ip.x * 0.7 + ip.z * 0.4) * 0.04 * k; transformed.z += cos(uT * 1.3 + ip.x * 0.3) * 0.03 * k; }`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uSunDir, uSunCol;').replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { vec3 V = normalize(vViewPosition); vec3 Sv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz); float tr = pow(max(dot(-V, Sv), 0.0), 3.0); totalEmissiveRadiance += diffuseColor.rgb * uSunCol * (0.06 + 1.6 * tr); }`); };
  const out = [], m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  const CH = 50, cells = new Map(); spots.forEach((s, i) => { const k = (i % 3) + ':' + Math.floor(s.x / CH) + ',' + Math.floor(s.z / CH); (cells.get(k) || cells.set(k, []).get(k)).push(s); });
  for (const [key, list] of cells) { const gi = +key.split(':')[0], geo = geos[gi];
    const im = new THREE.InstancedMesh(geo, mat, list.length); im.receiveShadow = true; im.castShadow = false; im.userData.veg = true;
    list.forEach((s, i) => { const sc = (s.s ?? 1); e.set((Math.random() - 0.5) * 0.2, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.2); q4.setFromEuler(e);
      m4.compose(new THREE.Vector3(s.x, s.y ?? 0, s.z), q4, new THREE.Vector3(sc, sc * (0.7 + Math.random() * 0.6), sc)); im.setMatrixAt(i, m4);
      const d = s.dry ?? 0, L = s.light || [1, 1, 1]; c.setRGB(L[0] * (1 + d * 0.5), L[1] * (1 + d * 0.25), L[2] * (1 - d * 0.1)); im.setColorAt(i, c); });
    im.computeBoundingSphere(); im.userData.c = new THREE.Vector3(); im.userData.c.copy(im.boundingSphere.center); ctx.scene.add(im); out.push(im); }
  const R2 = 55 * 55;
  return { meshes: out, update(dt) { time.value += dt; const cp = ctx.camera.position; for (const m of out) { const c = m.userData.c, dx = c.x - cp.x, dz = c.z - cp.z; m.visible = dx * dx + dz * dz < R2 + 2500; } } };
}
