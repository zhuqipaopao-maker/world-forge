// WORLD PROPS: one builder per prop. Register them here, not in props.js:
// main.js imports this file; props.js importing it would be a circular import.
// Contract: see the top of props.js. Add each prop's footprint to SIZES first.
import * as THREE from 'three';
import { register, kit, bevelBox, SIZES } from './props.js';

SIZES.crate = [1.2, 1.0, 1.2, 'painted_metal', 'metal'];
SIZES.barrier = [2.0, 0.9, 0.6, 'concrete', 'concrete'];

// examples: replace with your world's props
register('crate', (ctx, o) => {
  const [w, h, d] = SIZES.crate, k = kit(ctx, o.seed);
  k.add(bevelBox(w, h, d, 0.015), 'painted_metal', { pos: [0, h / 2, 0], color: [1, 1, 1] });
  for (const s of [-1, 1]) k.add(bevelBox(w + 0.02, 0.06, 0.06, 0.008), 'painted_metal', { pos: [0, h * 0.5 + s * h * 0.38, d / 2], color: [0.7, 0.7, 0.7] }); // trims
  const g = k.finish(); g.userData.size = [w, h, d];
  g.userData.colliders = [{ min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2], surface: 'metal' }];
  return g;
});
register('barrier', (ctx, o) => {
  const [w, h, d] = SIZES.barrier, k = kit(ctx, o.seed);
  const s = new THREE.Shape(); s.moveTo(-d / 2, 0); s.lineTo(d / 2, 0); s.lineTo(d * 0.18, h * 0.35); s.lineTo(d * 0.12, h); s.lineTo(-d * 0.12, h); s.lineTo(-d * 0.18, h * 0.35); s.closePath();
  const e = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 }); e.rotateY(Math.PI / 2); e.translate(-w / 2, 0, 0);
  k.add(e, 'concrete', { color: [1, 1, 1], dirt: 0.3 });
  const g = k.finish(); g.userData.size = [w, h, d];
  g.userData.colliders = [{ min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2], surface: 'concrete' }];
  return g;
});

