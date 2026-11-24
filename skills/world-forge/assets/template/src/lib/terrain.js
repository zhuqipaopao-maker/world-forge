// TERRAIN: heightfield ground that matches gameplay exactly.
//   const t = makeTerrain(ctx, { size: 160, res: 200, height: hills(7, { amp: 2.5 }), flatten: [{ x: 0, z: 0, r: 12, y: 0 }], material: 'snow' });
//   level.groundHeight = t.heightAt   // player, props and trees read the ground from the same function
// Rules (other-worlds.md §2): flatten under buildings and paths, raise berms at the edges to close the
// play area, sink paths slightly so they read and guide the player.
import * as THREE from 'three';
import { makeRng } from '../core/util.js';
import { worldUV } from '../modules/mats.js';
import { matVC } from '../modules/props.js';

// smooth 2D gradient noise for terrain shaping (CPU)
export function noise2(seed = 1) {
  const r = makeRng(seed), P = new Uint16Array(512), G = [];
  for (let i = 0; i < 256; i++) { P[i] = i; const a = r() * Math.PI * 2; G.push([Math.cos(a), Math.sin(a)]); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [P[i], P[j]] = [P[j], P[i]]; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const f = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const g = (ix, iy, dx, dy) => { const v = G[P[P[ix] + iy]]; return v[0] * dx + v[1] * dy; };
    const u = f(xf), v = f(yf), a = g(X, Y, xf, yf), b = g(X + 1, Y, xf - 1, yf), c = g(X, Y + 1, xf, yf - 1), d = g(X + 1, Y + 1, xf - 1, yf - 1);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;   // ~[-0.7, 0.7]
  };
}
// rolling hills: fbm with a few octaves; amp in metres, scale = 1 / feature size
export function hills(seed = 1, { amp = 2, scale = 0.025, oct = 4 } = {}) {
  const n = noise2(seed);
  return (x, z) => { let s = 0, a = 1, f = scale, norm = 0; for (let i = 0; i < oct; i++) { s += a * n(x * f, z * f); norm += a; a *= 0.5; f *= 2.03; } return (s / norm) * amp * 1.4; };
}

export function makeTerrain(ctx, { size = 160, res = 200, height = () => 0, flatten = [], paths = [], berm = null, material = 'dirt', centre = [0, 0], tint = null } = {}) {
  // tint: (x, z, h, normalY) => [r, g, b] vertex colour: tree wells, trodden paths, soot, contact rings (free detail, no textures)
  // final height = base noise, pulled to flat zones, lowered along paths, raised near the edge (berm)
  const H = (x, z) => {
    let h = height(x, z);
    for (const f of flatten) { const d = Math.hypot(x - f.x, z - f.z), k = 1 - THREE.MathUtils.smoothstep(d, f.r, f.r + (f.falloff ?? 6)); h = h * (1 - k) + (f.y ?? 0) * k; }
    for (const p of paths) {   // p: { pts: [[x,z],...], width, depth }
      let best = 1e9; for (let i = 0; i < p.pts.length - 1; i++) { const [ax, az] = p.pts[i], [bx, bz] = p.pts[i + 1], dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz))); best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t)); }
      h -= (p.depth ?? 0.08) * (1 - THREE.MathUtils.smoothstep(best, (p.width ?? 2) * 0.5, (p.width ?? 2) * 0.5 + 1.5));
    }
    if (berm) { const d = Math.max(Math.abs(x - centre[0]) - berm.at, Math.abs(z - centre[1]) - berm.at, 0); h += berm.height * THREE.MathUtils.smoothstep(d, 0, berm.width ?? 12); }
    return h;
  };
  const geo = new THREE.PlaneGeometry(size, size, res, res).rotateX(-Math.PI / 2); geo.translate(centre[0], 0, centre[1]);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, H(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  if (tint) { const col = new Float32Array(pos.count * 3), nrm = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) { const c = tint(pos.getX(i), pos.getZ(i), pos.getY(i), nrm.getY(i)); col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
  const mat = typeof material === 'string' ? (tint ? matVC(ctx, material) : ctx.mats.get(material)) : material;
  worldUV(geo, mat.userData?.metres || 3);
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; mesh.name = 'terrain';
  ctx.scene.add(mesh);
  // heightAt: bilinear on the same grid the mesh uses, so feet and props sit exactly on the drawn surface
  const step = size / res, x0 = centre[0] - size / 2, z0 = centre[1] - size / 2;
  const at = (ix, iz) => pos.getY(Math.min(res, Math.max(0, iz)) * (res + 1) + Math.min(res, Math.max(0, ix)));
  const heightAt = (x, z) => { const fx = (x - x0) / step, fz = (z - z0) / step, ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    return (at(ix, iz) * (1 - tx) + at(ix + 1, iz) * tx) * (1 - tz) + (at(ix, iz + 1) * (1 - tx) + at(ix + 1, iz + 1) * tx) * tz; };
  return { mesh, heightAt, H };
}
