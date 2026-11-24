// EXAMPLE (from night-metro): copy to photo.js, put your CC0 JPGs in src/assets/cc0/ and fix the imports. The template does not ship textures.
// PHOTO MATERIALS: CC0 photo-scanned texture sets (ambientCG, Poly Haven) as an alternative to the GPU-baked recipes,
// for the surfaces a camera looks at most (floors, walls). Code still decides the layout: e.g. the floor is composed at
// load from a granite photo into 0.6 m tiles (each tile its own crop and tint, dark grout, polished roughness), so tile
// joints stay aligned with world 0 and with lib/gloss.js. Only use CC0 sources; keep the LICENSE note next to the files.
//   in mats.js MATERIALS: granite_floor: { photo: 'granite_tiles', metres: 2.4, ... }   (other keys work as usual: paint, wet...)
//   the build inlines the JPGs (esbuild loader '.jpg': 'dataurl'): keep them 512-1024 px (~1.4 MB for five sets here).
import * as THREE from 'three';
import granC from '../assets/cc0/Granite002B_Color.jpg';
import granN from '../assets/cc0/Granite002B_NormalGL.jpg';
import granR from '../assets/cc0/Granite002B_Roughness.jpg';
import tileC from '../assets/cc0/Tiles107_Color.jpg';
import tileN from '../assets/cc0/Tiles107_NormalGL.jpg';
import tileR from '../assets/cc0/Tiles107_Roughness.jpg';
import concC from '../assets/cc0/Concrete030_Color.jpg';
import concN from '../assets/cc0/Concrete030_NormalGL.jpg';
import concR from '../assets/cc0/Concrete030_Roughness.jpg';
import gravC from '../assets/cc0/Gravel022_Color.jpg';
import gravN from '../assets/cc0/Gravel022_NormalGL.jpg';
import gravR from '../assets/cc0/Gravel022_Roughness.jpg';
import metC from '../assets/cc0/Metal009_Color.jpg';
import metN from '../assets/cc0/Metal009_NormalGL.jpg';
import metR from '../assets/cc0/Metal009_Roughness.jpg';
import metM from '../assets/cc0/Metal009_Metalness.jpg';

const img = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
const canvas = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
function tex(c, srgb, aniso) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; }
// ORM in one texture (three: R = ao, G = roughness, B = metalness), roughness remapped to [r0, r1]
function orm(rough, metal, size, r0 = 0, r1 = 1, ao = 1) {
  const [c, g] = canvas(size); g.drawImage(rough, 0, 0, size, size); const R = g.getImageData(0, 0, size, size);
  let M = null; if (metal) { g.drawImage(metal, 0, 0, size, size); M = g.getImageData(0, 0, size, size); }
  for (let i = 0; i < R.data.length; i += 4) { const r = R.data[i] / 255; R.data[i + 1] = 255 * (r0 + (r1 - r0) * r); R.data[i] = 255 * ao; R.data[i + 2] = M ? M.data[i] : 0; R.data[i + 3] = 255; }
  g.putImageData(R, 0, 0); return c;
}
function plain(C, N, R, M, size, r0, r1, aniso, { contrast = 1, sat = 1 } = {}) {   // contrast/sat < 1 calm a busy scan (stains, blotches) toward its mean
  const [cc, gc] = canvas(size); gc.drawImage(C, 0, 0, size, size);
  if (contrast !== 1 || sat !== 1) { const D = gc.getImageData(0, 0, size, size), d = D.data; let m = 0; for (let i = 0; i < d.length; i += 4) m += d[i] + d[i + 1] + d[i + 2]; m /= d.length * 0.75;
    for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; for (let k = 0; k < 3; k++) d[i + k] = m + ((l + (d[i + k] - l) * sat) - m) * contrast; } gc.putImageData(D, 0, 0); }
  const [cn, gn] = canvas(size); gn.drawImage(N, 0, 0, size, size);
  return { map: tex(cc, true, aniso), normalMap: tex(cn, false, aniso), ormMap: tex(orm(R, M, size, r0, r1), false, aniso) };
}
// the platform floor: 4 x 4 tiles of 0.6 m per 2.4 m texture, each a different crop and tint of the granite photo
function graniteTiles(C, N, R, aniso) {
  const S = 2048, T = S / 4, gr = Math.max(2, Math.round(T * 0.004 / 0.6));
  let q = 9; const rnd = () => ((q = (q * 16807) % 2147483647) - 1) / 2147483646;
  const [cc, gc] = canvas(S), [cn, gn] = canvas(S), [cr, gr2] = canvas(S);
  const crops = []; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) crops.push([i, j, rnd() * (C.width * 0.4), rnd() * (C.height * 0.4), 0.9 + rnd() * 0.18, rnd() < 0.07]);
  const W = C.width * 0.6;   // a tile is ~60% of the photo's width (the photo covers ~1 m)
  for (const [i, j, sx, sy, k, patchT] of crops) {
    gc.filter = `brightness(${(patchT ? 1.12 : k).toFixed(3)})${patchT ? ' saturate(0.7)' : ''}`; gc.drawImage(C, sx, sy, W, W, i * T, j * T, T, T); gc.filter = 'none';
    gn.drawImage(N, sx * N.width / C.width, sy * N.height / C.height, W * N.width / C.width, W * N.height / C.height, i * T, j * T, T, T);
    gr2.drawImage(R, sx * R.width / C.width, sy * R.height / C.height, W * R.width / C.width, W * R.height / C.height, i * T, j * T, T, T);
  }
  // grout: dark, rough, a soft worn arris either side
  for (let k = 0; k <= 4; k++) for (const g of [gc, gr2]) { const p = k * T;
    g.fillStyle = g === gc ? 'rgba(18,18,18,1)' : 'rgb(230,230,230)'; g.fillRect(p - gr, 0, 2 * gr, S); g.fillRect(0, p - gr, S, 2 * gr);
    if (g === gc) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(p - 3 * gr, 0, 6 * gr, S); g.fillRect(0, p - 3 * gr, S, 6 * gr); } }
  // polished granite: remap the scan's roughness into the low range (but keep the grout rough)
  const Rd = gr2.getImageData(0, 0, S, S);
  for (let i = 0; i < Rd.data.length; i += 4) { const r = Rd.data[i] / 255, grout = r > 0.88; Rd.data[i + 1] = 255 * (grout ? 0.85 : 0.14 + 0.3 * r); Rd.data[i] = 255 * (grout ? 0.5 : 1); Rd.data[i + 2] = 0; Rd.data[i + 3] = 255; }
  gr2.putImageData(Rd, 0, 0);
  return { map: tex(cc, true, aniso), normalMap: tex(cn, false, aniso), ormMap: tex(cr, false, aniso) };
}

export async function loadPhotoSets(renderer) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const [gC, gN, gR, tC, tN, tR, cC, cN, cR, vC, vN, vR, mC, mN, mR, mM] = await Promise.all([granC, granN, granR, tileC, tileN, tileR, concC, concN, concR, gravC, gravN, gravR, metC, metN, metR, metM].map(img));
  return {
    granite_tiles: graniteTiles(gC, gN, gR, aniso),
    tiles107: plain(tC, tN, tR, null, 1024, 0.08, 0.45, aniso),        // glazed: glossy faces, rough grout
    concrete030: plain(cC, cN, cR, null, 512, 0.6, 1.0, aniso),
    gravel022: plain(vC, vN, vR, null, 512, 0.7, 1.0, aniso),
    metal009: plain(mC, mN, mR, mM, 512, 0.15, 0.5, aniso),
  };
}
