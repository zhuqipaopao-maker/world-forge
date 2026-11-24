// ?show=figure — three procedural figures: a plain person (idle), a walker, and a horror "stalker"
// (tall, thin, long arms, small head, stepped motion). Judge silhouette first, then motion via ?t=.
import * as THREE from 'three';
import { makeFigure } from '../lib/figure.js';
import { worldUV } from './mats.js';

export async function showcase(ctx) {
  const floor = new THREE.Mesh(worldUV(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), 3), ctx.mats.get('dirt')); floor.receiveShadow = true; ctx.scene.add(floor);
  const person = makeFigure(ctx, { height: 1.75, skin: [0.62, 0.48, 0.4], cloth: [0.18, 0.2, 0.26], rags: 5, hairLen: 0.25, eyeGlow: 0 });
  const walker = makeFigure(ctx, { height: 1.8, seed: 5, skin: [0.6, 0.5, 0.42], cloth: [0.3, 0.12, 0.1], hairStrands: 0, eyeGlow: 0 });
  const stalker = makeFigure(ctx, { height: 2.3, thin: 1.5, armLen: 1.45, headSize: 0.8, neck: 1.6, skin: [0.78, 0.78, 0.74], cloth: [0.06, 0.06, 0.06], robe: true, rags: 5, hairLen: 1.1, eyeGlow: 10, seed: 9 });
  person.root.position.set(-2.2, 0, 0); walker.root.position.set(0, 0, 0); stalker.root.position.set(2.4, 0, -0.5); stalker.root.rotation.y = -0.4;
  for (const f of [person, walker, stalker]) ctx.scene.add(f.root);
  const cam = new THREE.Vector3(0, 1.6, 5.5);
  return {
    cam: cam.toArray(), target: [0, 1.1, 0],
    update(dt) {
      person.update(dt, { mode: 'idle', lookAt: cam });
      walker.update(dt, { mode: 'walk', speed: 1.1 });
      stalker.update(dt, { mode: 'stalk', speed: 0.7, lookAt: cam, stepRate: 9 });
    },
  };
}
