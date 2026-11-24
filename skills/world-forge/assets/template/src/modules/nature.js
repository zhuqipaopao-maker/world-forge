// NATURE showcase: ?show=trees (add &snow=1 for winter). Lines up the tree variants at true scale
// in front of a planted forest, so silhouette, foliage lighting and density can be judged.
import * as THREE from 'three';
import { makeConifer, makeBroadleaf, makeDeadTree, foliageMaterial, barkMaterial, plantForest } from '../lib/vegetation.js';
import { worldUV, SURFACE } from './mats.js';
import { makeRng } from '../core/util.js';
import { makeTerrain, hills } from '../lib/terrain.js';
import { makeTOD } from '../lib/tod.js';

export async function showcase(ctx) {
  SURFACE.snow.value = +(ctx.params.snow || 0);
  const terrain = makeTerrain(ctx, { size: 200, res: 160, height: hills(3, { amp: 3 }), flatten: [{ x: 0, z: 6, r: 10, y: 0 }],
    paths: [{ pts: [[-30, 14], [0, 8], [25, -30]], width: 2.5 }], material: ctx.params.snow ? 'snow' : 'dirt' });
  ctx.level.groundHeight = terrain.heightAt;
  const bark = barkMaterial(ctx), needles = foliageMaterial('needles'), leaves = foliageMaterial('leaves');
  const variants = [
    { tree: makeConifer({ height: 11, radius: 2.4, seed: 1 }), barkMat: bark, leafMat: needles },
    { tree: makeConifer({ height: 14, radius: 2.8, seed: 2 }), barkMat: bark, leafMat: needles },
    { tree: makeConifer({ height: 7, radius: 1.8, seed: 3, density: 0.8 }), barkMat: bark, leafMat: needles },
    { tree: makeBroadleaf({ height: 9, seed: 4 }), barkMat: bark, leafMat: leaves },
    { tree: makeDeadTree({ height: 8, seed: 5 }), barkMat: bark, leafMat: null },
  ];
  // the line-up
  plantForest(ctx, variants, variants.map((v, i) => ({ x: (i - 2) * 6, z: 0, s: 1, yaw: 0.3 * i, variant: i })));
  // a forest behind
  const rng = makeRng(5), spots = [];
  for (let i = 0; i < 160; i++) { const x = rng.range(-60, 60), z = rng.range(-70, -12); spots.push({ x, z, variant: rng() < 0.75 ? rng.int(0, 2) : rng.int(3, 4) }); }
  // background trees use low-detail variants (same seeds => same silhouettes, ~1/3 the triangles)
  const far = [
    { tree: makeConifer({ height: 11, radius: 2.4, seed: 1, detail: 0.4 }), barkMat: bark, leafMat: needles },
    { tree: makeConifer({ height: 14, radius: 2.8, seed: 2, detail: 0.4 }), barkMat: bark, leafMat: needles },
    { tree: makeConifer({ height: 7, radius: 1.8, seed: 3, density: 0.8, detail: 0.4 }), barkMat: bark, leafMat: needles },
    variants[3], variants[4]];
  plantForest(ctx, far, spots);
  const tris = variants.map((v) => ((v.tree.bark.attributes.position.count + (v.tree.leaves?.attributes.position.count || 0)) / 3) | 0);
  console.log('[nature] tree variants tris: ' + tris.join(', '));
  if (ctx.params.snow && ctx.fx) { ctx.fx.rain.visible = false; ctx.fx.snow.visible = true; }
  if (ctx.params.night) {   // quick night preview: dim sun/sky, one warm lamp lighting the snow
    ctx.render.sun.intensity *= 0.04; ctx.render.hemi.intensity *= 0.25; ctx.scene.environmentIntensity = 0.12;
    const lampPos = new THREE.Vector3(-3, 4.2, 8);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.2, 8), ctx.mats.get('painted_metal')); pole.position.set(-3, 2.1, 8); pole.castShadow = true; ctx.scene.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.7, 0.4).multiplyScalar(30) })); bulb.position.copy(lampPos); ctx.scene.add(bulb);
    const l = ctx.render.lights.acquire(); l.position.copy(lampPos); l.color.setRGB(1, 0.7, 0.4); l.intensity = 40; l.distance = 14;
    ctx.scene.add(ctx.fx.lampCone(lampPos, new THREE.Vector3(0, -1, 0), { length: 4.2, radius: 2.0 }));
    ctx.fx.setLamps([{ pos: lampPos, color: [1, 0.7, 0.4], range: 5 }]);
  }
  if (ctx.params.tod !== undefined) {   // ?tod=0..1: test of lib/tod.js (day -> moonlit night)
    makeTOD(ctx, [{ at: 0 }, { at: 1, zenith: [0.006, 0.011, 0.03], horizon: [0.16, 0.15, 0.22], away: [0.03, 0.045, 0.085], sun: [0.62, 0.74, 1], sunI: 1.5, sunDir: [-0.62, 0.5, 0.6],
      hemiSky: [0.16, 0.22, 0.42], hemiI: 0.17, env: 0.14, exposure: 0.9, stars: 1, moon: 1, rim: [0.2, 0.26, 0.4] }]).set(+ctx.params.tod);
  }
  return { cam: [0, 2.2, 17], target: [0, 4.5, 0] };
}
