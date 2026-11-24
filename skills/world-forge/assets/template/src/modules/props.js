// PROPS: every model is a function. A size table fixes each prop's footprint (so the
// level can be laid out before the art exists); a registry maps name -> builder.
// A builder that throws is replaced by a correctly-sized grey box, never a crash.
// Contract for every builder: return a THREE.Group with
//   userData.size      [w,h,d] metres
//   userData.colliders [{min:[x,y,z], max:[x,y,z], surface:'metal'}] in local space
//   userData.lamps?    [{pos:[x,y,z], color, intensity}]   (optional)
//   userData.update?   (dt) => void                          (optional, animated props)
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { makeRng } from '../core/util.js';
import { worldUV } from './mats.js';

// name: [w, h, d, defaultMaterial, surface]
export const SIZES = {};   // filled by props_world.js

const builders = new Map();
export const register = (name, fn) => builders.set(name, fn);

// ---- geometry helpers ----------------------------------------------------------
// Box with rounded edges: hard 90° edges are the #1 thing that makes procedural props look fake,
// because real edges catch a thin highlight. ~1 cm radius is enough.
export function bevelBox(w, h, d, r = 0.01, seg = 2) {
  if (r <= 0) return new THREE.BoxGeometry(w, h, d);
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) * 0.45)); // all 12 edges rounded
}

// Bake per-vertex tint + a dirt band near the ground + slight random value jitter.
// Vertex colour is free detail: no texture memory, and it breaks up repetition.
export function tint(geo, rgb, { dirt = 0.2, jitter = 0.04, rng = Math.random, worldY = 0 } = {}) {
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const j = 1 + (rng() - 0.5) * 2 * jitter;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + worldY;
    const d = dirt > 0 ? Math.max(0, 1 - y / dirt) : 0; // darker, warmer at the base
    col[i * 3] = rgb[0] * j * (1 - d * 0.45);
    col[i * 3 + 1] = rgb[1] * j * (1 - d * 0.5);
    col[i * 3 + 2] = rgb[2] * j * (1 - d * 0.6);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// A copy of a library material that reads vertex colours (tint, grime, AO). Use it for any merged mesh
// you build yourself (platforms, terrain tint): Material.clone() drops onBeforeCompile and the cache key.
const vcCache = new Map();
export function matVC(ctx, name) {
  if (vcCache.has(name)) return vcCache.get(name);
  const base = ctx.mats.get(name), mat = base.clone(); mat.vertexColors = true;
  mat.onBeforeCompile = base.onBeforeCompile; mat.customProgramCacheKey = base.customProgramCacheKey;
  mat.userData = { ...base.userData }; vcCache.set(name, mat); return mat;
}

// Kit: collect parts by material, then merge to one mesh per material (few draw calls).
export function kit(ctx, seed = 1, { uvOffset = true } = {}) {   // uvOffset false: tile grids line up with world 0 (floors, walls, architecture)
  const parts = new Map(), rng = makeRng(seed); let closed = false;
  return {
    rng,
    add(geo, matName, { pos = [0, 0, 0], rot = [0, 0, 0], color = [1, 1, 1], dirt = 0.2 } = {}) {
      if (closed) { console.error(`[props] kit.add('${matName}') after finish(): this part is lost. Use a new kit.`); return; }
      const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1));
      geo = geo.index ? geo.toNonIndexed() : geo.clone();
      if (!geo.attributes.normal) geo.computeVertexNormals();
      // keep only position + normal: worldUV rebuilds uv, tint adds color. Mixed attribute sets make mergeGeometries return null.
      for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
      geo.morphAttributes = {};
      geo.applyMatrix4(m);
      tint(geo, color, { dirt, rng });
      if (!parts.has(matName)) parts.set(matName, []);
      parts.get(matName).push(geo);
    },
    finish() {
      closed = true; const g = new THREE.Group();
      for (const [name, geos] of parts) {
        const base = ctx.mats.get(name), mat = matVC(ctx, name);
        const joined = mergeGeometries(geos, false);
        if (!joined) { console.error(`[props] merge failed for material "${name}" (${geos.length} parts)`); continue; }
        const merged = worldUV(joined, base.userData.metres || 2, uvOffset ? [seed * 7.3 % 11, 0, seed * 3.1 % 13] : [0, 0, 0]); // offset: no two props share the same texture patch
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = mesh.receiveShadow = true; g.add(mesh);
      }
      return g;
    },
  };
}

// ---- builders live in props_world.js (imported by main.js; importing it from here would be circular) ----

export async function create(ctx) {
  const placed = [];
  function build(name, opts = {}) {
    const size = SIZES[name] || [1, 1, 1];
    let g;
    try {
      const fn = builders.get(name);
      if (!fn) throw new Error(`unknown prop "${name}"`);
      g = fn(ctx, { seed: 1, ...opts });
    } catch (e) {
      console.error(`[props] builder "${name}" threw: ${e.message}`);
      g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color: 0x777777 }));
      m.position.y = size[1] / 2; g.add(m);
      g.userData.size = size; g.userData.colliders = [{ min: [-size[0] / 2, 0, -size[2] / 2], max: [size[0] / 2, size[1], size[2] / 2], surface: SIZES[name]?.[4] || 'default' }];
    }
    g.name = name;
    return g;
  }
  // place(name, x, z, yaw, opts) — adds to scene and records colliders in world space
  function place(name, x, z, yaw = 0, opts = {}) {
    const g = build(name, opts); g.position.set(x, opts.y || 0, z); g.rotation.y = yaw; ctx.scene.add(g); g.updateMatrixWorld(true);
    placed.push(g); return g;
  }
  return {
    build, place, list: () => placed, names: () => [...builders.keys()],
    update(dt) { for (const p of placed) p.userData.update?.(dt); },
  };
}

// ?show=props — every prop in rows at true scale.
// ?show=props                       all props in a row
// ?show=props&prop=bench&az=35&el=15&zoom=1   one prop alone, camera orbiting it (az degrees from +z = the prop's
//                                    front, el degrees up, zoom < 1 = closer). tools/props.mjs shoots 4 views of each.
export async function showcase(ctx) {
  // a neutral rig: prop sheets must be readable even when the world's art.js is a dark interior or a night
  { const k = new THREE.DirectionalLight(0xffffff, 1.0); k.position.set(4, 7, 5); const f = new THREE.HemisphereLight(0xdde4ee, 0x3a3836, 0.35); ctx.scene.add(k, f); }
  const floor = new THREE.Mesh(worldUV(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), 3), ctx.mats.get('concrete')); floor.receiveShadow = true; ctx.scene.add(floor);
  const P = ctx.params;
  if (P.prop) {
    const g = ctx.props.place(P.prop, 0, 0);
    const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    if (box.min.y < -0.01) floor.position.y = box.min.y - 0.01;   // hulls, steps, piles below y=0 would hide under the floor
    // focus=top: tall props (poles, masts, lamps) carry their detail at the top; aim there from a width-based distance
    if (P.focus === 'top') { c.y = box.max.y - Math.min(0.9, sz.y * 0.15); sz.y = Math.min(sz.y, 1.6); }
    const r = Math.max(0.35, sz.length() / 2), dist = r * 2.3 * +(P.zoom || 1) + 0.4, az = THREE.MathUtils.degToRad(+(P.az ?? 35)), el = THREE.MathUtils.degToRad(+(P.el ?? 15));
    const cam = [c.x + Math.sin(az) * Math.cos(el) * dist, Math.max(0.15, c.y + Math.sin(el) * dist), c.z + Math.cos(az) * Math.cos(el) * dist];
    return { cam, target: [c.x, c.y, c.z], names: ctx.props.names() };
  }
  let x = 0;
  for (const n of ctx.props.names()) { const s = SIZES[n] || [1, 1, 1]; ctx.props.place(n, x + s[0] / 2, 0); x += s[0] + 1.2; }
  return { cam: [x / 2 - 2, 2.2, 5], target: [x / 2, 0.8, 0] };
}
