// LEVEL: the layout is DATA (a table of placements), not code scattered through modules.
// That makes it easy to read, to screenshot from fixed cameras, and to rebalance.
// It also owns: player start, objectives, interior boxes (no rain inside), surface queries,
// and the cinematicPath used by #bench and by the intro camera.
import * as THREE from 'three';
import { WORLD } from '../art.js';
import { worldUV } from './mats.js';

// [prop, x, z, yawDegrees, opts]
const LAYOUT = [
  ['crate', -4, -3, 10],
  ['crate', -2.6, -3.2, -5],
  ['crate', -3.3, -3.1, 0, { y: 1.0 }],
  ['barrier', 3, -6, 90],
  ['barrier', 3, -8.2, 90],
  ['barrier', 6, 2, 0],
];

export async function create(ctx) {
  const asphalt = ctx.mats.get('asphalt');
  const floor = new THREE.Mesh(worldUV(new THREE.PlaneGeometry(WORLD.max.x - WORLD.min.x + 40, WORLD.max.z - WORLD.min.z + 40).rotateX(-Math.PI / 2), asphalt.userData.metres || 4), asphalt);
  floor.receiveShadow = true; floor.name = 'ground'; ctx.scene.add(floor);

  const colliders = [];
  for (const [name, x, z, yaw = 0, opts = {}] of LAYOUT) {
    const g = ctx.props.place(name, x, z, THREE.MathUtils.degToRad(yaw), opts);
    for (const c of g.userData.colliders || []) {
      const box = new THREE.Box3(new THREE.Vector3(...c.min), new THREE.Vector3(...c.max)).applyMatrix4(g.matrixWorld);
      box.surface = c.surface; colliders.push(box);
    }
  }

  return {
    colliders,
    playerStart: { pos: [0, 0, 8], yaw: 0 },
    objectives: [],                  // e.g. [{id:'relay1', pos:[x,y,z], label:'Cut relay A'}]
    interiorBoxes: [],               // Box3[] — rain / wind / reverb switch off inside
    // Camera path for #bench and the intro: shows the best views of the level.
    cinematicPath: [
      { pos: [-14, 2.2, 12], look: [0, 1, 0] },
      { pos: [0, 1.7, 10], look: [-3, 1, -3] },
      { pos: [10, 3, 4], look: [0, 1, -4] },
      { pos: [8, 1.7, -12], look: [-2, 1, 0] },
    ],
    // Named camera views for screenshots: tools/shot.mjs can loop over these.
    views: {
      start: { cam: [0, 1.68, 8], target: [0, 1.4, 0] },
      overview: { cam: [-18, 14, 18], target: [0, 0, 0] },
      cover: { cam: [-1, 1.2, 1], target: [-4, 0.8, -3] },
    },
    groundHeight(x, z) { return 0; },  // replace for terrain: player and props read the ground from here
    surfaceAt(x, z) { for (const b of colliders) if (x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z) return b.surface; return 'asphalt'; },
    update() {},
  };
}

// ?show=level — the level alone with no player, from the overview camera.
export async function showcase(ctx) {
  ctx.level = await create(ctx);
  const v = ctx.level.views.overview; return { cam: v.cam, target: v.target };
}
