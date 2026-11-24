// VEGETATION: procedural trees as real branch geometry + alpha foliage cards, instanced.
//   makeConifer / makeBroadleaf / makeDeadTree  -> { bark: BufferGeometry, leaves: BufferGeometry|null, height }
//   plantForest(ctx, variants, spots)           -> InstancedMeshes (2 draw calls per variant)
// What makes trees read as real (other-worlds.md §1):
//   ragged silhouette with see-through gaps · branches droop toward the tips · foliage normals point out of
//   the crown (not along the cards) · light through leaves (translucency) · dark interior, light tips ·
//   per-instance scale/lean/tint · wind sway that grows with height · snow load on the upper side.
// Budget: hero conifer ~20–30k tris (detail 1), background ~1/3 (detail 0.4). Use detail 0.4 beyond ~25 m.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng } from '../core/util.js';
import { SURFACE } from '../modules/mats.js';

// ---- foliage card textures (canvas, generated once) -----------------------------------------------
const texCache = new Map(), snowMasks = new Map();
export const foliageSnowMask = (kind = 'needles', seed = 1) => { foliageTexture(kind, seed); return snowMasks.get(kind + seed) || null; };
export function foliageTexture(kind = 'needles', seed = 1) {
  const key = kind + seed; if (texCache.has(key)) return texCache.get(key);
  let W = 512, H = 1024; const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), r = makeRng(seed);
  g.clearRect(0, 0, W, H);
  if (kind === 'needles') {
    // Spruce spray ATLAS: two different sprays side by side (u 0..0.5, 0.5..1), seen from above.
    // A spray = a main axis with alternating flat side shoots, every shoot a bottle-brush of short needles.
    // Drawn in three passes per shoot (dark under-layer, needles, light tips) so it reads as a dense mass with
    // depth, not as strokes; the brown twig is almost hidden, as on a real spruce. snowMask (same layout)
    // holds where snow pads lie on the spray: the shader turns those into solid white clumps on upward cards.
    W = 1024; H = 1024; c.width = W; c.height = H;
    const sm = document.createElement('canvas'); sm.width = W / 2; sm.height = H / 2; const sg = sm.getContext('2d');
    sg.fillStyle = '#000'; sg.fillRect(0, 0, W / 2, H / 2);
    const needleRun = (x0, y0, x1, y1, n, len, col, wid, spread = 1) => {
      const a = Math.atan2(y1 - y0, x1 - x0);
      for (let i = 0; i < n; i++) {
        const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        for (const sd of [-1, 1]) {
          const ang = a + sd * (0.55 + r() * 0.6) * spread, L = len * (0.75 + r() * 0.5) * (1 - 0.35 * t);
          g.strokeStyle = col(t); g.lineWidth = wid * (0.8 + r() * 0.4);
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * L, y + Math.sin(ang) * L); g.stroke();
        }
      }
    };
    const green = (k, light) => { const v = (0.75 + r() * 0.5) * k, l = light ? 1.5 : 1; return `rgb(${(26 * v * l) | 0},${(50 * v * l) | 0},${(34 * v * l * 1.05) | 0})`; };
    g.lineCap = 'round';
    for (let half = 0; half < 2; half++) {
      const cx = W * (0.25 + 0.5 * half), top = 30, bot = H - 10, bend = (r() - 0.5) * 60;
      const axisAt = (t) => [cx + bend * t * t, bot - t * (bot - top)];
      const shoots = [];
      for (let k = 0; k < 28; k++) {
        const t = 0.04 + k * 0.034 + (r() - 0.5) * 0.015, [x, y] = axisAt(t), side = k % 2 ? 1 : -1;
        const len = W * 0.21 * (1 - t * 0.62) * (0.8 + r() * 0.35), ang = -Math.PI / 2 + side * (0.75 + r() * 0.35);
        shoots.push([x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len, t]);
      }
      // pass 1: dark under-layer (self-shadow inside the spray)
      g.globalAlpha = 0.9;
      for (const [x, y, x1, y1] of shoots) needleRun(x, y, x + (x1 - x) * 0.8, y + (y1 - y) * 0.8, 22, 18, () => 'rgb(14,26,19)', 5, 0.7);   // under-layer stays inside the spray: no dark outline
      { const [x0, y0] = axisAt(0), [x1, y1] = axisAt(0.85); needleRun(x0, y0, x1, y1, 50, 22, () => 'rgb(14,26,19)', 5, 0.7); }
      g.globalAlpha = 1;
      // twig (mostly hidden)
      g.strokeStyle = 'rgb(58,42,30)'; g.lineWidth = 6; g.beginPath(); { const [x0, y0] = axisAt(0); g.moveTo(x0, y0); for (let t = 0.1; t <= 1.001; t += 0.1) { const [x, y] = axisAt(t); g.lineTo(x, y); } } g.stroke();
      // pass 2: needles, darker toward the axis/base; pass 3: light new-growth tips
      for (const [x, y, x1, y1, t0] of shoots) {
        g.strokeStyle = 'rgb(52,40,28)'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x1, y1); g.stroke();
        needleRun(x, y, x1, y1, 56, 30, (t) => green(0.55 + 0.6 * t - 0.25 * t0, false), 2.6);   // long enough that neighbouring shoots overlap: a mass, not a fern frond
        const tx = x + (x1 - x) * 0.78, ty = y + (y1 - y) * 0.78; needleRun(tx, ty, x1, y1, 12, 16, () => green(1.0, true), 2.2);
      }
      { const [x0, y0] = axisAt(0), [x1, y1] = axisAt(1); needleRun(x0, y0, x1, y1, 120, 26, (t) => green(0.6 + 0.4 * t, false), 2.8); }
      // snow pads on this spray: soft blobs along the axis and the inner part of shoots (half resolution)
      sg.fillStyle = '#fff';
      // snow lies in long pads along the top of each shoot (and the main axis), not in round blobs
      const pad = (x0, y0, x1, y1, w) => { const n = 7; for (let i = 0; i < n; i++) { if (r() < 0.25) continue;
        const t = (i + r() * 0.6) / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, ang = Math.atan2(y1 - y0, x1 - x0), rx = (30 + r() * 30) * (1 - 0.4 * t), ry = w * (0.6 + r() * 0.5) * (1 - 0.5 * t);
        const gr = sg.createRadialGradient(x / 2, y / 2, 0, x / 2, y / 2, rx / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        sg.fillStyle = gr; sg.beginPath(); sg.ellipse(x / 2, y / 2, rx / 2, ry / 2, ang, 0, Math.PI * 2); sg.fill(); } };
      for (const sh of shoots) if (r() < 0.7) pad(sh[0], sh[1], sh[2], sh[3], 26);
      { const [x0, y0] = axisAt(0.05), [x1, y1] = axisAt(0.85); pad(x0, y0, x1, y1, 40); }
    }
    const st = new THREE.CanvasTexture(sm); st.colorSpace = THREE.NoColorSpace; st.generateMipmaps = true; st.minFilter = THREE.LinearMipmapLinearFilter;
    snowMasks.set(key, st);
  } else {
    // broadleaf cluster: overlapping leaves with a midrib
    for (let i = 0; i < 90; i++) {
      const x = W * (0.12 + 0.76 * r()), y = H * (0.06 + 0.88 * r()), a = r() * Math.PI * 2, s = 18 + r() * 22, v = 0.6 + r() * 0.4;
      g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = `rgb(${(48 * v) | 0},${(78 * v) | 0},${(30 * v) | 0})`;
      g.beginPath(); g.ellipse(0, 0, s * 0.42, s, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(30,45,20,0.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -s); g.lineTo(0, s); g.stroke(); g.restore();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  texCache.set(key, t); return t;
}

// ---- geometry helpers ---------------------------------------------------------------------------
// tapered tube along a polyline (trunks, branches); UVs in metres for the bark material
function tube(points, r0, r1, seg = 6, metres = 1) {
  const curve = new THREE.CatmullRomCurve3(points);
  const steps = Math.max(2, points.length * 2), geo = new THREE.TubeGeometry(curve, steps, 1, seg, false);
  const pos = geo.attributes.position, uv = geo.attributes.uv, len = curve.getLength(), v = new THREE.Vector3();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, p = curve.getPointAt(t), rad = r0 + (r1 - r0) * t;
    for (let j = 0; j <= seg; j++) {
      const k = i * (seg + 1) + j; v.set(pos.getX(k), pos.getY(k), pos.getZ(k)).sub(p).normalize();
      pos.setXYZ(k, p.x + v.x * rad, p.y + v.y * rad, p.z + v.z * rad);
      uv.setXY(k, (j / seg) * (2 * Math.PI * Math.max(rad, 0.05)) / metres, (t * len) / metres);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

// one foliage card (crossed pair) from `a` along `dir`, length L, width Wd, bending down toward the tip
function card(a, dir, L, Wd, droop, rng) {
  const geos = [], d = dir.clone().normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  const twist = new THREE.Quaternion().setFromAxisAngle(d, rng.range(-0.4, 0.4));
  for (const rot of [0, Math.PI / 2]) {
    const g = new THREE.PlaneGeometry(Wd, L, 1, 3); g.translate(0, L / 2, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) / L; p.setZ(i, p.getZ(i) - droop * y * y * L); }
    g.rotateY(rot); g.applyQuaternion(twist.clone().multiply(q)); g.translate(a.x, a.y, a.z);
    geos.push(g);
  }
  return geos;
}

// map a card's u onto one of the two sprays in the needle atlas
function atlasHalf(geos, rng) { const h = rng() < 0.5 ? 0 : 0.5; for (const g of geos) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, h + uv.getX(i) * 0.5); } return geos; }

// conifer spray: a FLAT card lying along the branch (faces up: carries the snow pads) + a narrower hanging
// card under it (the curtain of branchlets that real spruce has). The flat card droops, then turns up at the tip.
// u is remapped to one of the two sprays in the atlas.
const _up = new THREE.Vector3(0, 1, 0);
function sprayCards(a, dir, L, Wd, droop, rng, hang = 0.55) {
  const geos = [], f = dir.clone().normalize();
  let rt = new THREE.Vector3().crossVectors(f, _up); if (rt.lengthSq() < 1e-4) rt.set(1, 0, 0); rt.normalize();
  const nrm = new THREE.Vector3().crossVectors(rt, f).normalize();
  const roll = rng.range(-0.35, 0.35); rt.applyAxisAngle(f, roll); nrm.applyAxisAngle(f, roll);
  const half = rng() < 0.5 ? 0 : 0.5, basis = new THREE.Matrix4().makeBasis(rt, f, nrm);
  const mk = (w, len, dz, up, hangDown) => {
    const g = new THREE.PlaneGeometry(w, len, 2, 4); g.translate(0, len / 2, 0);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / len, x = p.getX(i) / w;
      // flat card: sag down along its length, tips turn up, edges curl down (a spray is slightly domed)
      p.setZ(i, -dz * y * y * len + up * Math.max(0, y - 0.7) * len - Math.abs(x) * w * 0.25 - hangDown * y * len);
      uv.setX(i, half + uv.getX(i) * 0.5);
    }
    g.applyMatrix4(basis); g.translate(a.x, a.y, a.z); return g;
  };
  geos.push(mk(Wd, L, droop, 0.25, 0));
  if (hang > 0) { const h = mk(Wd * 0.55, L * 0.8, 0, 0, 0); h.translate(-a.x, -a.y, -a.z);   // hanging curtain: rotate the card to vertical under the branch
    h.applyMatrix4(new THREE.Matrix4().makeRotationAxis(f, Math.PI / 2)); h.translate(a.x - nrm.x * 0.12, a.y - 0.12, a.z - nrm.z * 0.12); geos.push(h); }
  return geos;
}

// foliage normals point out of the crown axis (soft, volumetric lighting instead of flat cards);
// vertex colour darkens the crown interior
function crownNormals(geo, height, up = 0.35, radiusAt = null) {
  const p = geo.attributes.position, n = new Float32Array(p.count * 3), col = new Float32Array(p.count * 3), v = new THREE.Vector3();
  const on = geo.attributes.normal, up2 = new Float32Array(p.count);       // how much the card itself faces up: snow lies there
  for (let i = 0; i < p.count; i++) up2[i] = on ? Math.abs(on.getY(i)) : 0;
  geo.setAttribute('aUp', new THREE.BufferAttribute(up2, 1));
  // broadleaf crowns have no envelope function: measure the real crown (a fixed 1.6 m radius lit every leaf of a 5 m crown as 'outside': flat crowns; run 7)
  let Rm = 0, y0 = 1e9, y1 = -1e9; if (!radiusAt) for (let i = 0; i < p.count; i++) { Rm = Math.max(Rm, Math.hypot(p.getX(i), p.getZ(i))); y0 = Math.min(y0, p.getY(i)); y1 = Math.max(y1, p.getY(i)); }
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), (p.getY(i) - height * 0.55) * 0.6 + up, p.getZ(i)).normalize();
    n[i * 3] = v.x; n[i * 3 + 1] = v.y; n[i * 3 + 2] = v.z;
    // crown AO: inside of the crown (relative to the envelope) and the underside of the lower crown are dark
    const rr = radiusAt ? Math.max(0.3, radiusAt(p.getY(i))) : Math.max(0.8, Rm * 0.8), out = Math.min(1, Math.hypot(p.getX(i), p.getZ(i)) / rr);
    const hv = Math.sin(Math.floor(p.getX(i) * 2.2) * 12.9898 + Math.floor(p.getY(i) * 2.2) * 78.233 + Math.floor(p.getZ(i) * 2.2) * 37.719) * 43758.5453, tv = 0.82 + 0.36 * (hv - Math.floor(hv));   // per-spray value variation
    const k = tv * (radiusAt ? (0.4 + 0.6 * out) * (0.7 + 0.3 * Math.min(1, p.getY(i) / (height * 0.5))) : (0.55 + 0.45 * Math.pow(out, 1.2)) * (0.78 + 0.22 * Math.min(1, (p.getY(i) - y0) / Math.max(0.5, y1 - y0))));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

const keep = (g) => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'aUp'].includes(k)) g.deleteAttribute(k); return g; };

// ---- tree builders ------------------------------------------------------------------------------
// Conifer (spruce/fir): whorls of drooping branches inside a cone envelope.
// detail: 1 = hero tree near the player, 0.4 = background (fewer branches/cards)
export function makeConifer({ height = 12, radius = 2.6, seed = 1, density = 1, bareBottom = 1.6, detail = 1 } = {}) {
  const rng = makeRng(seed * 7919 + 13), bark = [], leaves = [];
  const lean = new THREE.Vector3(rng.range(-0.15, 0.15), 0, rng.range(-0.15, 0.15));
  const trunkPts = []; for (let i = 0; i <= 6; i++) { const t = i / 6; trunkPts.push(new THREE.Vector3(lean.x * t * t * height + rng.range(-0.04, 0.04), t * height, lean.z * t * t * height + rng.range(-0.04, 0.04))); }
  bark.push(tube(trunkPts, 0.032 * height, 0.012, detail > 0.6 ? 8 : 5, 1));
  const axis = (y) => trunkPts[0].clone().lerp(trunkPts[6], y / height);
  for (let y = bareBottom; y < height - 0.3; y += rng.range(0.26, 0.42) / Math.sqrt(density * detail)) {
    const t = (y - bareBottom) / (height - bareBottom), env = radius * Math.pow(1 - t, 0.92) * rng.range(0.75, 1.15);
    const n = Math.round(rng.range(4, 7) * density), a0 = rng() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      if (rng() < 0.12) continue;                                            // gaps: light passes through the crown
      const a = a0 + (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3), L = env * rng.range(0.7, 1.05);
      const o = axis(y), dir = new THREE.Vector3(Math.cos(a), rng.range(-0.25, 0.05) - 0.15 * (1 - t), Math.sin(a)).normalize();
      const mid = o.clone().addScaledVector(dir, L * 0.5).add(new THREE.Vector3(0, -0.08 * L, 0));
      const tip = o.clone().addScaledVector(dir, L).add(new THREE.Vector3(0, -0.22 * L * (0.5 + t), 0));
      if ((detail > 0.6 && t < 0.75) || t < 0.45) bark.push(tube([o, mid, tip], 0.02 + 0.025 * (1 - t), 0.004, 3, 0.6));   // branches: mostly hidden in the crown, so 3-sided
      const cards = Math.max(1, Math.round((L / 0.4) * detail));
      for (let c = 0; c < cards; c++) {
        const s = (c + 0.3) / cards, p = o.clone().lerp(mid, Math.min(1, s * 2)).lerp(tip, Math.max(0, s * 2 - 1));
        const d = tip.clone().sub(o).normalize().add(new THREE.Vector3(rng.range(-0.3, 0.3), rng.range(-0.1, 0.15), rng.range(-0.3, 0.3))).normalize();
        leaves.push(...atlasHalf(card(p, d, rng.range(0.85, 1.2) * Math.min(1, L * 0.8 + 0.35), rng.range(0.6, 0.8), 0.3, rng), rng));
      }
    }
    // fill: flat sprays around the trunk per whorl give the crown its dark mass
    if (detail > 0.3 && t > 0.08) { const o = axis(y), e2 = radius * Math.pow(1 - t, 0.92) * 0.7; for (let f = 0; f < 2; f++) { const a = rng() * Math.PI * 2; leaves.push(...atlasHalf(card(o, new THREE.Vector3(Math.cos(a), -0.2, Math.sin(a)), e2 * 0.8 + 0.3, e2 * 0.9 + 0.3, 0.2, rng), rng)); } }
  }
  for (let k = 0; k < 3; k++) leaves.push(...card(axis(height - 0.9 - k * 0.25), new THREE.Vector3(rng.range(-0.2, 0.2), 1, rng.range(-0.2, 0.2)), 1.1, 0.45, 0.05, rng).map((g) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5); return g; })); // leader
  const radiusAt = (y) => radius * Math.pow(Math.max(0, 1 - (y - bareBottom) / (height - bareBottom)), 0.92);
  return { bark: mergeGeometries(bark.map(keep)), leaves: crownNormals(mergeGeometries(leaves.map(keep)), height, 0.35, radiusAt), height, kind: 'needles' };
}

// Broadleaf: trunk that forks recursively; leaf clusters on the last two levels.
export function makeBroadleaf({ height = 9, seed = 1, depth = 4, leafy = 1, trunk = 0.38, leafFrom = 1, spread = 0.9, lite = false, cells = 0, leafScale = 1, leafCount = 1 } = {}) {   // cells N: each leaf card shows one random cell of an N x N photo atlas   // lite: fewer tube sides, no bark on the hidden twigs (~1/4 the bark triangles)   // trunk 0.25 + leafFrom 2: a bushy crown down low (secondary growth), defaults: a tall park tree
  const rng = makeRng(seed * 104729 + 7), bark = [], leaves = [];
  function branch(p, dir, len, r, level) {
    const end = p.clone().addScaledVector(dir, len), mid = p.clone().lerp(end, 0.5).add(new THREE.Vector3(rng.range(-0.1, 0.1), rng.range(-0.05, 0.1), rng.range(-0.1, 0.1)).multiplyScalar(len));
    if (!lite || level < depth) bark.push(tube([p, mid, end], r, r * 0.65, lite ? (level === 0 ? 6 : level < 3 ? 4 : 3) : level < 2 ? 8 : 5, 1));
    if (level >= depth - leafFrom && rng() < leafy) for (let k = 0; k < Math.round((level >= depth ? 5 : 2) * (lite ? 2 : 1) * leafCount); k++) {
      const d = dir.clone().add(new THREE.Vector3(rng.range(-0.9, 0.9), rng.range(-0.3, 0.6), rng.range(-0.9, 0.9))).normalize();
      const at = p.clone().lerp(end, rng.range(lite ? 0 : 0.3, 1)); if (lite) at.add(new THREE.Vector3(rng.range(-0.7, 0.7), rng.range(-0.5, 0.4), rng.range(-0.7, 0.7)).multiplyScalar(len * 0.6));   // lite trees: leaves scattered loosely along the twigs, not packed into pads (read as 'bonsai')
      const cg = card(at, d, rng.range(1.2, 1.7) * (lite ? 0.7 : 1) * leafScale, rng.range(1.0, 1.4) * (lite ? 0.7 : 1) * leafScale, 0.15, rng);   // leafScale < 1 + leafCount > 1: leaves at a believable size (run 7)
      if (cells) { const ix = Math.floor(rng() * cells), iy = Math.floor(rng() * cells), e = 0.015; for (const g of cg) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (ix + e + uv.getX(i) * (1 - 2 * e)) / cells, (iy + e + uv.getY(i) * (1 - 2 * e)) / cells); } }
      leaves.push(...cg);
    }
    if (level >= depth) return;
    const kids = level === 0 ? 3 : rng.int(2, 3);
    for (let k = 0; k < kids; k++) {
      const a = rng() * Math.PI * 2, d = dir.clone().multiplyScalar(1.2).add(new THREE.Vector3(Math.cos(a), rng.range(0.1, 0.5), Math.sin(a)).multiplyScalar(spread)).normalize();
      branch(end, d, len * rng.range(0.62, 0.8), r * 0.62, level + 1);
    }
  }
  branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(rng.range(-0.08, 0.08), 1, rng.range(-0.08, 0.08)).normalize(), height * trunk, 0.03 * height, 0);
  return { bark: mergeGeometries(bark.map(keep)), leaves: leaves.length ? crownNormals(mergeGeometries(leaves.map(keep)), height, 0.5) : null, height, kind: 'leaves' };
}

// Snag: a dead spruce: straight, slightly leaning trunk, broken top, whorls of short dead stubs angled down.
// (makeDeadTree is a dead BROADLEAF; in a conifer forest use this one.)
export function makeSnag({ height = 9, seed = 1, radius = 0.16 } = {}) {
  const rng = makeRng(seed * 4241 + 3), bark = [];
  const lx = rng.range(-0.04, 0.04), lz = rng.range(-0.04, 0.04), pts = [];
  for (let i = 0; i <= 5; i++) { const t = i / 5; pts.push(new THREE.Vector3(lx * t * height + rng.range(-0.02, 0.02), t * height, lz * t * height + rng.range(-0.02, 0.02))); }
  bark.push(tube(pts, radius, radius * 0.25, 7, 1));
  const top = pts[5], spl = new THREE.Vector3(rng.range(-0.3, 0.3), rng.range(0.4, 0.9), rng.range(-0.3, 0.3));   // broken top: a short split-off spike
  bark.push(tube([top.clone().add(new THREE.Vector3(0, -0.4, 0)), top.clone().add(spl)], radius * 0.22, 0.004, 4, 0.5));
  for (let y = 1.2; y < height - 0.6; y += rng.range(0.35, 0.6)) {
    const t = y / height, n = rng.int(2, 4), a0 = rng() * 6.28;
    for (let k = 0; k < n; k++) {
      if (rng() < 0.3) continue;
      const a = a0 + (k / n) * 6.28 + rng.range(-0.4, 0.4), L = rng.range(0.15, 0.7) * (1 - 0.5 * t) * (rng() < 0.15 ? 2.2 : 1);
      const o = new THREE.Vector3(lx * y, y, lz * y), d = new THREE.Vector3(Math.cos(a), rng.range(-0.55, -0.15), Math.sin(a)).normalize();
      bark.push(tube([o, o.clone().addScaledVector(d, L)], radius * 0.18 * (1 - 0.6 * t) + 0.01, 0.004, 3, 0.4));
    }
  }
  return { bark: mergeGeometries(bark.map(keep)), leaves: null, height, kind: 'snag' };
}

export function makeDeadTree(opts = {}) { const t = makeBroadleaf({ depth: 3, leafy: 0, ...opts }); t.leaves = null; return t; }

// ---- materials ---------------------------------------------------------------------------------
// Wind: sway grows with height^2 above the instance base; fast flutter on foliage. Phase from world position.
function windPatch(m, flutter, extra, inner) {
  m.onBeforeCompile = (s, r) => {
    inner?.(s, r);
    s.uniforms.uTime = SURFACE.time;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; varying vec3 vWN; varying vec3 vWPosF;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 base = vec3(0.0);
          #ifdef USE_INSTANCING
            base = instanceMatrix[3].xyz;
          #endif
          float hgt = max(transformed.y, 0.0), ph = dot(base + modelMatrix[3].xyz, vec3(0.13, 0.0, 0.17));
          float sway = (sin(uTime * 0.9 + ph) * 0.6 + sin(uTime * 2.1 + ph * 1.7) * 0.25) * 0.0025 * hgt * hgt;
          float fl = ${flutter.toFixed(2)} * 0.02 * sin(uTime * 7.0 + dot(transformed, vec3(3.1, 1.7, 2.3))) * smoothstep(1.0, 3.0, hgt);
          transformed.x += sway + fl; transformed.z += sway * 0.6 - fl * 0.5;
        }`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        { vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp; vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
          #else
            vWN = normalize(mat3(modelMatrix) * objectNormal);
          #endif
          vWPosF = (modelMatrix * wp).xyz; }`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWN; varying vec3 vWPosF;');
    extra?.(s);
  };
}

// Rim light colour for every foliage material (set it from your time-of-day code).
export const FOLIAGE_RIM = { value: new THREE.Color(0.25, 0.3, 0.4) };
// Strength of the light through backlit leaves (0.3 was the old fixed value; 1.0-1.5 for a low sun behind the trees).
export const FOLIAGE_TRANSLUCENCY = { value: 0.3 };
// Foliage: alpha-tested cards with alpha-to-coverage, translucency toward the sun, snow on the upper side, wind.
export function foliageMaterial(kind = 'needles', { color = [1, 1, 1], snow = true, atlas = null } = {}) {   // atlas: a photo texture (RGBA) to use instead of the drawn one; pair it with makeBroadleaf({ cells })
  const snowMap = kind === 'needles' ? foliageSnowMask(kind) : null;
  const m = new THREE.MeshStandardMaterial({ map: atlas || foliageTexture(kind), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, metalness: 0, vertexColors: true, color: new THREE.Color(...color) });
  m.alphaToCoverage = true;
  windPatch(m, 1.0, (s) => {
    s.uniforms.uSnow = SURFACE.snow; s.uniforms.uSunDir = SURFACE.sunDir; s.uniforms.uRim = FOLIAGE_RIM; s.uniforms.FOLIAGE_TRANS = FOLIAGE_TRANSLUCENCY; s.uniforms.uSnowMap = { value: snowMap };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aUp; varying float vUp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvUp = aUp;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSnow; uniform vec3 uSunDir; uniform float FOLIAGE_TRANS; uniform vec3 uRim; uniform sampler2D uSnowMap; varying float vUp; float wfSnowF;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        wfSnowF = 0.0;
        ${snow && snowMap ? `{ // snow pads: solid white clumps from the mask, only on cards that face up and on the upper side of the crown
          float up = smoothstep(0.3, 0.75, vUp) * smoothstep(-0.2, 0.4, vWN.y + 0.3);
          float m = texture2D(uSnowMap, vMapUv).r, nl = dot(sampledDiffuseColor.rgb, vec3(0.3, 0.6, 0.1));
          // snow caught in the needles: the mask is broken up by the needle pattern so a pad has a ragged, organic
          // edge; only the pad's core may overhang the needles; the pad is shaded by the needles under it.
          // Far away the pads blur into the mips: widen them with the mip level so a distant crown still reads snow-laden.
          vec2 tsz0 = vec2(textureSize(map, 0)); vec2 dx0 = dFdx(vMapUv * tsz0), dy0 = dFdy(vMapUv * tsz0);
          float lod0 = max(0.0, 0.5 * log2(max(dot(dx0, dx0), dot(dy0, dy0))));
          float mk = m * up * (0.6 + 0.8 * uSnow) * (0.75 + 0.5 * smoothstep(0.02, 0.12, nl) * sampledDiffuseColor.a) * (1.0 + 0.3 * lod0);
          wfSnowF = smoothstep(0.42, 0.62, mk) * step(0.01, uSnow);
          diffuseColor.a = max(diffuseColor.a, smoothstep(0.75, 0.95, mk) * step(0.01, uSnow));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.95) * (0.62 + 0.38 * smoothstep(0.42, 0.9, mk)), wfSnowF);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.25 + vec3(0.04, 0.045, 0.05), uSnow * up * 0.35 * (1.0 - wfSnowF)); }` :
          snow ? 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.88, 0.93), uSnow * clamp(smoothstep(0.55, 0.9, vUp) * 0.8 + smoothstep(0.4, 0.8, vWN.y) * 0.5, 0.0, 0.9));' : ''}`)
      .replace('#include <alphatest_fragment>', `diffuseColor.a *= smoothstep(0.45, 1.3, length(cameraPosition - vWPosF));   // sprays brushing the camera fade out instead of filling the screen as flat cut-outs
        { // thin needles lose alpha in small mips and the tree goes bald at distance: scale alpha back up by mip level,
          // then sharpen around the cutoff so alpha-to-coverage gives a crisp, anti-aliased edge (Golus' trick)
          vec2 tsz = vec2(textureSize(map, 0)); vec2 dx = dFdx(vMapUv * tsz), dy = dFdy(vMapUv * tsz);
          float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
          diffuseColor.a *= 1.0 + lod * 0.28;
          diffuseColor.a = clamp((diffuseColor.a - alphaTest) / max(fwidth(diffuseColor.a), 1e-4) + 0.5, 0.0, 1.0); }
        #include <alphatest_fragment>`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.95), wfSnowF * 0.85);   // pads are not darkened by crown AO much`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec3 V = normalize(cameraPosition - vWPosF); float tr = pow(max(dot(-V, uSunDir), 0.0), 4.0);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.15, 1.05, 0.5) * (tr * FOLIAGE_TRANS + 0.12 * pow(max(dot(-V, uSunDir), 0.0), 1.5));   // backlit leaves glow (light through the leaf): a backlit crown is not a black blob
          // crown rim: edges of the crown catch the key/sky light, so masses keep a light outline and mid-tones
          float rim = pow(1.0 - abs(dot(normalize(vWN), V)), 2.5);
          totalEmissiveRadiance += diffuseColor.rgb * 0.5 * uRim * rim * (1.0 - wfSnowF * 0.7) * (0.45 + 0.55 * max(dot(normalize(vWN), uSunDir), 0.0)); }`);   // light through leaves + rim
  });
  m.customProgramCacheKey = () => 'wf-foliage2-' + kind + (snow ? 's' : '');
  return m;
}
// Bark: the shared surface material (macro variation, wetness, snow) plus wind sway.
export function barkMaterial(ctx) {
  const src = ctx.mats.get('bark'), b = src.clone();
  b.userData = { ...src.userData };
  windPatch(b, 0.35, null, src.onBeforeCompile);
  b.customProgramCacheKey = () => 'wf-bark-wind';
  return b;
}

// ---- planting -----------------------------------------------------------------------------------
// variants: [{ tree, barkMat, leafMat }]; spots: [{ x, z, y?, s?, yaw?, variant? }]
// spots: {x, z, y?, s?, yaw?, variant?}. Height: s.y, else groundHeight(x, z) (option), else ctx.level.groundHeight, else 0.
// Performance (measured on a 150-tree level: trees were ~60% of the frame):
//  - chunk: instances are split into square cells of this size (metres), one InstancedMesh per cell and part,
//    so the cells behind the camera are frustum-culled (one big InstancedMesh is always drawn whole).
//  - variant.shadowTree: a low-detail version of the same tree (same seed, detail 0.3) that casts the shadow
//    instead of the full crown; the shadow pass then draws ~1/4 of the foliage triangles.
const _hiddenMat = new THREE.ShaderMaterial({ vertexShader: 'void main(){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }', fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); discard; }', colorWrite: false, depthWrite: false });   // shadow-only proxies: never rasterised in the main pass
export function plantForest(ctx, variants, spots, { castShadow = true, groundHeight = null, chunk = 24 } = {}) {
  const gh = groundHeight || ctx.level?.groundHeight;
  const rng = makeRng(911), groups = variants.map(() => []);
  for (const s of spots) groups[s.variant ?? rng.int(0, variants.length - 1)].push(s);
  const out = [], q = new THREE.Quaternion(), e = new THREE.Euler();
  variants.forEach((v, vi) => {
    const list = groups[vi]; if (!list.length) return;
    // one transform per tree, shared by bark and foliage (separate random draws per part would give each part
    // a different yaw/lean: trunks then stick out of the crowns as bare spikes)
    const r2 = makeRng(vi * 31 + 7), rc = makeRng(vi * 31 + 8);
    const mats = list.map((s) => {
      const sc = s.s ?? r2.range(0.75, 1.25);
      e.set(r2.range(-0.04, 0.04), s.yaw ?? r2() * Math.PI * 2, r2.range(-0.04, 0.04)); q.setFromEuler(e);
      return new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y ?? (gh ? gh(s.x, s.z) : 0), s.z), q, new THREE.Vector3(sc, sc * r2.range(0.9, 1.1), sc));
    });
    const cols = list.map((s) => { const k = rc.range(0.85, 1.15), L = s.light || [1, 1, 1]; return new THREE.Color(k * rc.range(0.92, 1.08) * L[0], k * L[1], k * rc.range(0.85, 1.05) * L[2]); });   // s.light: baked light per tree (lib/lightbake.js baker.at), for scenes lit by a bake
    const cells = new Map();
    list.forEach((s, i) => { const key = chunk > 0 ? Math.floor(s.x / chunk) + ',' + Math.floor(s.z / chunk) : '0'; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(i); });
    const proxy = castShadow && v.shadowTree?.leaves && v.leafMat;
    let depthMat = null;
    if (proxy) depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: v.leafMat.map, alphaTest: 0.45, side: THREE.DoubleSide });
    const parts = [[v.tree.bark, v.barkMat, castShadow && !proxy], [v.tree.leaves, v.leafMat, castShadow && !proxy]].filter((p) => p[0] && p[1]);
    if (proxy) parts.push([v.shadowTree.leaves, _hiddenMat, true, depthMat], [v.shadowTree.bark, _hiddenMat, true, null]);
    for (const idx of cells.values()) for (const [geo, mat, cast, depth] of parts) {
      const im = new THREE.InstancedMesh(geo, mat, idx.length); im.castShadow = cast; im.receiveShadow = mat !== _hiddenMat;
      if (depth) { im.customDepthMaterial = depth; im.userData.noAO = true; }
      idx.forEach((i, j) => { im.setMatrixAt(j, mats[i]); if (mat === v.leafMat) im.setColorAt(j, cols[i]); else if (mat === v.barkMat && list[i].light) im.setColorAt(j, new THREE.Color(...list[i].light)); });
      im.computeBoundingSphere();
      ctx.scene.add(im); out.push(im);
    }
  });
  return out;
}
