// ARCHITECTURE KIT: walls, floors, ceilings, stairs as merged per-material meshes with tile-aligned UVs (world 0 = a tile
// edge, so tile grids line up with edges and with lib/gloss.js's joint mask) and BAKED LIGHT in vertex colours.
//   import { archKit } from '../lib/arch.js';
//   import { makeBaker } from '../lib/lightbake.js';
//   const baker = makeBaker({ lights, occluders, ref, ambient, bounce });             // see lightbake.js
//   const A = archKit(ctx, baker, { dirtBase: 0 });
//   A.box(64, 3.4, 0.1, 'enamel_wall', [0, 1.7, 9.6], { seg: [256, 12, 1] });       // seg: vertices for the light pools
//   A.add(new THREE.PlaneGeometry(64, 8.5, 256, 34).rotateX(-Math.PI / 2), 'granite_floor', { pos: [0, 0, 0] });
//   A.box(0.28, 0.14, 0.62, 'concrete', [x, y, z], { litFlat: true });             // hundreds of small parts: one sample each
//   A.add(metalGeo, 'stainless', { lit: false });                                    // metals show light by reflection, not by colour
//   const meshes = A.finish(parentGroup);   // after finish(), add() logs an error: start a new kit for late parts
// Everything is lit by the bake unless lit: false. Without a baker, vertex colours are just tint + dirt.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { worldUV } from '../modules/mats.js';
import { matVC, bevelBox } from '../modules/props.js';

export function archKit(ctx, baker = null, { dirtBase = 0 } = {}) {
  const parts = new Map(), pv = new THREE.Vector3(), nv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0); let closed = false;
  const tint = (geo, c, dirt, lit, flat) => {
    const p = geo.attributes.position, n = geo.attributes.normal, col = new Float32Array(p.count * 3);
    let fl = null; if (flat && baker) { geo.computeBoundingBox(); geo.boundingBox.getCenter(pv); pv.y = geo.boundingBox.max.y; fl = baker.at(pv, up); }
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); const d = dirt ? 1 - dirt * Math.max(0, 1 - Math.max(0, y - dirtBase) / 0.6) * 0.5 : 1;
      let e = [1, 1, 1]; if (fl) e = fl; else if (lit && baker) e = baker.at(pv.fromBufferAttribute(p, i), nv.fromBufferAttribute(n, i));
      col.set([c[0] * d * e[0], c[1] * d * e[1], c[2] * d * e[2]], i * 3); }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  };
  return {
    add(geo, mat, { pos = [0, 0, 0], rot = [0, 0, 0], color = [1, 1, 1], dirt = 0, lit = true, litFlat = false } = {}) {
      if (closed) { console.error(`[arch] add('${mat}') after finish(): lost. Use a new archKit.`); return; }
      geo = geo.clone(); for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
      geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1)));
      if (!geo.attributes.normal) geo.computeVertexNormals();
      tint(geo, color, dirt, lit, litFlat);   // bake on the indexed geometry: each shared vertex once
      geo = geo.index ? geo.toNonIndexed() : geo;
      (parts.get(mat) || parts.set(mat, []).get(mat)).push(geo);
    },
    box(w, h, d, mat, pos, o = {}) { this.add(o.r ? bevelBox(w, h, d, o.r) : new THREE.BoxGeometry(w, h, d, ...(o.seg || [1, 1, 1])), mat, { ...o, pos }); },
    finish(parent, { shadow = true } = {}) {
      closed = true; const out = [];
      for (const [name, geos] of parts) {
        const base = ctx.mats.get(name), merged = mergeGeometries(geos, false);
        if (!merged) { console.error('[arch] merge failed: ' + name); continue; }
        const m = new THREE.Mesh(worldUV(merged, base.userData.metres || 2), matVC(ctx, name)); m.name = 'arch:' + name;
        m.castShadow = shadow; m.receiveShadow = true; m.userData.baked = new Float32Array(merged.attributes.color.array); parent.add(m); out.push(m);
      }
      return out;
    },
  };
}
