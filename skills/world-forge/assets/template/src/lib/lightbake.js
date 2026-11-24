// LIGHT BAKE: a lightmap made in code, once, at load. For interiors lit by many fixtures (stations, corridors, offices,
// hospitals, car parks) real-time lights cannot carry the look: each rect/area light costs every lit pixel of every pass,
// and point lights have no soft shadows. Real rooms read as real because of LIGHT POOLS under each fixture, DARK CORNERS,
// soft SHADOWS under furniture and HOT SPOTS on the ceiling around each lamp. This computes those per vertex (or per texel)
// on the CPU, with occlusion, and writes them into vertex colours; a uniform carrier light (hemisphere + environment)
// then shows them. A few weak real-time lights can stay for specular glints and normal-map relief.
//
//   import { makeBaker, bakeMesh } from '../lib/lightbake.js';
//   const baker = makeBaker({
//     lights: [{ a: [x0,y,z], b: [x1,y,z], dir: [0,-1,0], power: 1, color: [1,1,1], side: 0.12 },   // line fixture (tube)
//              { p: [x,y,z], dir: null, power: 0.5, color: [1,.6,.3] }],                           // point (bare bulb)
//     occluders: [{ min: [..], max: [..] }, { cyl: [x, z, r, y0, y1] }],                              // boxes, upright cylinders
//     ref: 1, ambient: 0.16, ao: { rays: 10, dist: 1.4 },
//   });
//   bakeMesh(mesh, baker)             // multiplies the mesh's vertex colours (world space; call after placing it)
//   baker.at(p, n) -> [r, g, b]       // irradiance factor at a point with normal n (1 = the reference level)
// Cost: ~1-3 s for ~40k vertices x 60 fixtures x 40 occluders. Subdivide big faces (0.2-0.3 m) so pools have vertices.
import * as THREE from 'three';

export function makeBaker({ lights, occluders = [], ref = 1, ambient = 0.16, bounce = 0, ao = { rays: 10, dist: 1.4 }, maxDist = 12, step = 0.3, cell = 0.12 }) {
  // emitters: lines sampled every `step` metres; each sample carries power / n
  const E = [];
  for (const l of lights) {
    const col = l.color || [1, 1, 1], dir = l.dir ? new THREE.Vector3(...l.dir).normalize() : null, side = l.side ?? 0.12, lobe = l.lobe ?? 1;   // lobe > 1: a tighter downlight (distinct pools)
    if (l.a) { const a = new THREE.Vector3(...l.a), b = new THREE.Vector3(...l.b), n = Math.max(1, Math.round(a.distanceTo(b) / (l.step ?? step)));
      for (let i = 0; i < n; i++) E.push({ p: a.clone().lerp(b, (i + 0.5) / n), w: l.power / n * (a.distanceTo(b)), col, dir, side, lobe }); }
    else E.push({ p: new THREE.Vector3(...l.p), w: l.power, col, dir, side, lobe });
  }
  const boxes = occluders.filter((o) => o.min).map((o) => ({ min: new THREE.Vector3(...o.min), max: new THREE.Vector3(...o.max) }));
  E.sort((a, b) => a.p.x - b.p.x);   // so a query can skip emitters far away in x quickly
  const cyls = occluders.filter((o) => o.cyl).map((o) => o.cyl);
  // segment p -> q blocked? (slab test for boxes, 2D circle test for upright cylinders)
  const blocked = (p, q) => {
    const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
    const lx = Math.min(p.x, q.x), hx = Math.max(p.x, q.x), ly = Math.min(p.y, q.y), hy = Math.max(p.y, q.y), lz = Math.min(p.z, q.z), hz = Math.max(p.z, q.z);
    for (const b of boxes) {
      if (b.max.x < lx || b.min.x > hx || b.max.y < ly || b.min.y > hy || b.max.z < lz || b.min.z > hz) continue;   // bounding boxes do not even touch
      if (p.x > b.min.x - 0.03 && p.x < b.max.x + 0.03 && p.y > b.min.y - 0.03 && p.y < b.max.y + 0.03 && p.z > b.min.z - 0.03 && p.z < b.max.z + 0.03) continue;   // the point is ON this occluder (a prop's own surface): it cannot shadow itself
      let t0 = 0.001, t1 = 0.999, ok = true;
      for (const [o, d, lo, hi] of [[p.x, dx, b.min.x, b.max.x], [p.y, dy, b.min.y, b.max.y], [p.z, dz, b.min.z, b.max.z]]) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { ok = false; break; } continue; }
        let ta = (lo - o) / d, tb = (hi - o) / d; if (ta > tb) { const t = ta; ta = tb; tb = t; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) { ok = false; break; }
      }
      if (ok) return true;
    }
    for (const [cx, cz, r, y0, y1] of cyls) {
      if (cx + r < lx || cx - r > hx || cz + r < lz || cz - r > hz || y1 < ly || y0 > hy) continue;
      const fx = p.x - cx, fz = p.z - cz, A = dx * dx + dz * dz; if (A < 1e-9) continue;
      const B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - r * r, D = B * B - 4 * A * C; if (D < 0) continue;
      const s = Math.sqrt(D); for (const t of [(-B - s) / (2 * A), (-B + s) / (2 * A)]) if (t > 0.001 && t < 0.999) { const y = p.y + dy * t; if (y > y0 && y < y1) return true; }
    }
    return false;
  };
  // fixed cosine-weighted hemisphere directions (around +y; rotated to the normal per query)
  const H = []; for (let i = 0; i < ao.rays; i++) { const u = (i + 0.5) / ao.rays, phi = i * 2.39996; const r = Math.sqrt(u); H.push(new THREE.Vector3(r * Math.cos(phi), Math.sqrt(1 - u), r * Math.sin(phi))); }
  const cache = new Map(), qn = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), L = new THREE.Vector3(), q = new THREE.Vector3(), o = new THREE.Vector3();
  const api = {
    count: E.length,
    // irradiance factor at p with normal n (both THREE.Vector3, world space)
    // cached per 12 cm cell and dominant normal axis: shared and nearby vertices (props have ~600k) cost one query
    at(p, n) {
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z), oct = ax > ay && ax > az ? (n.x > 0 ? 0 : 1) : ay > az ? (n.y > 0 ? 2 : 3) : (n.z > 0 ? 4 : 5);
      const key = Math.round(p.x / cell) * 73856093 ^ Math.round(p.y / cell) * 19349663 ^ Math.round(p.z / cell) * 83492791 ^ oct * 2654435761;
      const hit = cache.get(key); if (hit) return hit;
      const res = api.raw(p, n); cache.set(key, res); return res;
    },
    raw(p, n) {
      o.copy(p).addScaledVector(n, 0.02);
      let r = 0, g = 0, b = 0;
      let i0 = 0, i1 = E.length; { let lo = 0, hi = E.length; while (lo < hi) { const m = (lo + hi) >> 1; if (E[m].p.x < o.x - maxDist) lo = m + 1; else hi = m; } i0 = lo; }
      for (let ei = i0; ei < i1; ei++) {
        const e = E[ei]; if (e.p.x > o.x + maxDist) break;
        L.subVectors(e.p, o); const d2 = L.lengthSq(); if (d2 > maxDist * maxDist) continue;
        const d = Math.sqrt(d2); L.divideScalar(d);
        const cr = n.dot(L); if (cr <= 0) continue;
        const ce = e.dir ? Math.pow(Math.max(0, -e.dir.dot(L)), e.lobe) * (1 - e.side) + e.side : 1;    // fixtures throw mostly down, a little sideways
        if (ce <= 0) continue;
        if (blocked(o, e.p)) continue;
        const k = e.w * cr * ce / (d2 + 0.25);
        r += k * e.col[0]; g += k * e.col[1]; b += k * e.col[2];
      }
      // ambient occlusion: the bounce light is uniform, but corners and the space under things get less of it
      qn.setFromUnitVectors(up, n); let open = 0;
      for (const h of H) { q.copy(h).applyQuaternion(qn).multiplyScalar(ao.dist).add(o); if (!blocked(o, q)) open++; }
      const a = (ambient + bounce * Math.max(0, -n.y)) * (0.25 + 0.75 * open / H.length);   // bounce: light coming back up off a lit floor (ceilings, undersides)
      return [r / ref + a, g / ref + a, b / ref + a];
    },
  };
  return api;
}

// Multiply a mesh's vertex colours by the baked light (creates the colour attribute if missing). World space.
export function bakeMesh(mesh, baker, { gain = 1, keep = true } = {}) {
  const g = mesh.geometry, P = g.attributes.position, N = g.attributes.normal; if (!N) g.computeVertexNormals();
  let C = g.attributes.color; if (!C) { C = new THREE.BufferAttribute(new Float32Array(P.count * 3).fill(1), 3); g.setAttribute('color', C); }
  mesh.updateMatrixWorld(true); const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld), p = new THREE.Vector3(), n = new THREE.Vector3();
  const base = keep ? new Float32Array(C.array) : null;
  for (let i = 0; i < P.count; i++) {
    p.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld); n.fromBufferAttribute(g.attributes.normal, i).applyMatrix3(nm).normalize();
    const e = baker.at(p, n); C.setXYZ(i, C.getX(i) * e[0] * gain, C.getY(i) * e[1] * gain, C.getZ(i) * e[2] * gain);
  }
  C.needsUpdate = true; if (keep) mesh.userData.bakedFrom = base;
  mesh.userData.baked = new Float32Array(C.array);   // for later dimming (a section goes dark) without re-baking
  return mesh;
}
