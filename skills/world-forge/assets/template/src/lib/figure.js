// FIGURE: procedural humanoid / creature with a bone hierarchy, code-driven animation, hanging cloth and hair.
//   const f = makeFigure(ctx, { height: 2.1, thin: 1.3, armLen: 1.25, ... });  scene.add(f.root);
//   f.update(dt, { mode: 'idle'|'walk'|'stalk'|'reach', speed: 1.2, lookAt: Vector3, stepRate: 0|8 })
// Design rules (other-worlds.md §6): silhouette first (proportions do most of the work), show little and
// briefly, eyes as tiny HDR emissives, motion from springs/sines, stepRate > 0 updates the pose only N
// times per second — the uncanny "stop-motion" look for horror.
import * as THREE from 'three';
import { makeRng, damp } from '../core/util.js';

function limb(len, r0, r1, seg = 14, mat) {
  // tapered capsule hanging down from the joint (local -Y)
  const pts = [];
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * r0, Math.cos(a) * r0)); }
  for (let i = 1; i <= 6; i++) { const t = i / 6; pts.push(new THREE.Vector2(r0 + (r1 - r0) * t, -len * t)); }
  for (let i = 1; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r1, -len - Math.sin(a) * r1)); }
  const g = new THREE.LatheGeometry(pts.reverse().map((p) => new THREE.Vector2(Math.max(p.x, 0.0001), p.y)), seg);
  const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m;
}

// verlet strip hanging from an anchor bone: cloth rags, hair strands
function strip(parent, offset, { len = 0.9, width = 0.12, segs = 8, mat }) {
  const geo = new THREE.PlaneGeometry(width, len, 1, segs); const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.castShadow = true;
  const pts = [], prev = [];
  return {
    mesh, inited: false,
    update(dt) {
      parent.updateWorldMatrix(true, false);
      const anchor = offset.clone().applyMatrix4(parent.matrixWorld), side = new THREE.Vector3(1, 0, 0).transformDirection(parent.matrixWorld).multiplyScalar(width / 2);
      const segL = len / segs;
      if (!this.inited) { for (let i = 0; i <= segs; i++) { const p = anchor.clone().add(new THREE.Vector3(0, -segL * i, 0)); pts.push(p); prev.push(p.clone()); } this.inited = true; }
      const h = Math.min(dt, 1 / 30);
      for (let i = 1; i <= segs; i++) { const p = pts[i], v = p.clone().sub(prev[i]).multiplyScalar(0.9); prev[i].copy(p); p.add(v).add(new THREE.Vector3(0, -9.8 * h * h, 0)); }
      pts[0].copy(anchor);
      for (let it = 0; it < 8; it++) for (let i = 1; i <= segs; i++) { const a = pts[i - 1], b = pts[i], d = b.clone().sub(a), l = d.length() || 1e-6; b.copy(a).addScaledVector(d, segL / l); }
      const pos = geo.attributes.position;
      for (let i = 0; i <= segs; i++) { const p = pts[i], k = 1 - (i / segs) * 0.5; pos.setXYZ(i * 2, p.x - side.x * k, p.y - side.y * k, p.z - side.z * k); pos.setXYZ(i * 2 + 1, p.x + side.x * k, p.y + side.y * k, p.z + side.z * k); }
      pos.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
    },
  };
}

export function makeFigure(ctx, o = {}) {
  const H = o.height ?? 1.8, thin = o.thin ?? 1, armK = o.armLen ?? 1, headK = o.headSize ?? 1, rng = makeRng(o.seed ?? 3);
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(...(o.skin ?? [0.72, 0.68, 0.62])), roughness: 0.55, metalness: 0 });
  // cheap subsurface: wrap lighting + reddish thin-edge glow
  skin.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
    { float rim = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0); reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.5, 0.15, 0.1) * rim * 0.35; }`); };
  const clothMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(...(o.cloth ?? [0.12, 0.11, 0.1])), roughness: 0.95, side: THREE.DoubleSide });
  // dressed: true = a clothed person (sleeves, trousers, shoes) instead of bare skin limbs; daytime people read as
  // mannequins mostly because of bare grey-pink limbs. trousers/shoes take colours, sleeves use the cloth colour.
  const sleeveMat = o.dressed ? clothMat : skin, legMat = o.dressed ? new THREE.MeshStandardMaterial({ color: new THREE.Color(...(o.trousers ?? [0.06, 0.06, 0.07])), roughness: 0.9 }) : skin;
  const shoeMat = o.dressed ? new THREE.MeshStandardMaterial({ color: new THREE.Color(...(o.shoes ?? [0.03, 0.025, 0.02])), roughness: 0.7 }) : skin;
  const hairMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(...(o.hair ?? [0.02, 0.02, 0.025])), roughness: 0.6, side: THREE.DoubleSide });
  const leg = H * 0.48, torso = H * 0.3, neckL = H * 0.05 * (o.neck ?? 1), head = H * 0.065 * headK, arm = H * 0.19 * armK, fore = H * 0.18 * armK;
  const w = 1 / thin;
  const bone = (parent, x, y, z) => { const b = new THREE.Object3D(); b.position.set(x, y, z); parent.add(b); return b; };
  const root = new THREE.Group(), hips = bone(root, 0, leg, 0), spine = bone(hips, 0, 0.02, 0), chest = bone(spine, 0, torso * 0.55, 0), neck = bone(chest, 0, torso * 0.45, 0), headB = bone(neck, 0, neckL, 0);
  const B = { root, hips, spine, chest, neck, head: headB };
  // body
  const torsoMat = o.dressed ? clothMat : skin;
  const pelvis = limb(0.12, 0.13 * w, 0.15 * w, 16, torsoMat); pelvis.rotation.x = Math.PI; pelvis.position.y = -0.06; hips.add(pelvis);
  const trunk = limb(torso * 0.95, 0.12 * w, 0.17 * w, 18, torsoMat); trunk.rotation.x = Math.PI; spine.add(trunk);
  const neckM = limb(neckL * 1.1, 0.04 * w, 0.045 * w, 10, skin); neckM.rotation.x = Math.PI; neck.add(neckM);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(head, 24, 18), skin); skull.scale.set(0.85, 1.15, 0.95); skull.position.y = head * 1.05; skull.castShadow = true; headB.add(skull);
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(head * 0.09, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(...(o.eyes ?? [1, 0.95, 0.85])).multiplyScalar(o.eyeGlow ?? 8) }));
    e.position.set(s * head * 0.32, head * 1.12, head * 0.85); headB.add(e); eyes.push(e);
  }
  for (const s of [-1, 1]) {
    const sh = bone(chest, s * 0.2 * w, torso * 0.4, 0), up = bone(sh, 0, 0, 0), fo = bone(up, 0, -arm, 0), hand = bone(fo, 0, -fore, 0);
    up.add(limb(arm, 0.055 * w * (o.dressed ? 1.35 : 1), 0.045 * w * (o.dressed ? 1.45 : 1), 12, sleeveMat)); fo.add(limb(fore, 0.045 * w * (o.dressed ? 1.5 : 1), 0.035 * w * (o.dressed ? 1.7 : 1), 12, sleeveMat));   // wide sleeves
    const palm = limb(H * 0.1 * armK, 0.03 * w, 0.02 * w, 8, skin); hand.add(palm);           // long fingers read as wrong
    const th = bone(hips, s * 0.1 * w, -0.04, 0), sh2 = bone(th, 0, -leg * 0.5, 0), foot = bone(sh2, 0, -leg * 0.48, 0);
    th.add(limb(leg * 0.5, 0.075 * w * (o.dressed ? 1.2 : 1), 0.055 * w * (o.dressed ? 1.3 : 1), 12, legMat)); sh2.add(limb(leg * 0.48, 0.05 * w * (o.dressed ? 1.4 : 1), 0.035 * w * (o.dressed ? 1.6 : 1), 12, legMat));
    const f = limb(0.2, 0.035 * (o.dressed ? 1.3 : 1), 0.03 * (o.dressed ? 1.3 : 1), 8, shoeMat); f.rotation.x = -Math.PI / 2; foot.add(f);
    B[s < 0 ? 'L' : 'R'] = { shoulder: sh, upper: up, fore: fo, hand, thigh: th, shin: sh2, foot };
  }
  // robe: a lathe shell from chest to below the knees gives a far better silhouette than limbs alone
  if (o.robe) {
    const rl = torso * 0.9 + leg * (o.robeLen ?? 0.75), pts = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2((0.15 + 0.22 * Math.pow(t, 1.3)) * w * (1 + 0.04 * Math.sin(t * 17)), -t * rl)); }
    const robe = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), clothMat); robe.castShadow = true; robe.position.y = torso * 0.9; spine.add(robe);
    const p = robe.geometry.attributes.position;   // ragged hem
    for (let i = 0; i < p.count; i++) if (p.getY(i) < -rl * 0.95) p.setY(i, p.getY(i) + rng.range(0, 0.18)); robe.geometry.computeVertexNormals();
  }
  // cloth rags and hair as hanging strips (world-space verlet: they lag and swing)
  const strips = [];
  if (o.cloth !== null) for (let i = 0; i < (o.rags ?? 7); i++) { const a = (i / 7) * Math.PI * 2; strips.push(strip(chest, new THREE.Vector3(Math.sin(a) * 0.15 * w, torso * 0.35, Math.cos(a) * 0.12 * w), { len: torso + leg * rng.range(0.4, 0.9), width: rng.range(0.12, 0.2), mat: clothMat })); }
  if (o.hairStrands !== 0) for (let i = 0; i < (o.hairStrands ?? 9); i++) { const a = (i / 9) * Math.PI * 1.6 - 0.8 + Math.PI; strips.push(strip(headB, new THREE.Vector3(Math.sin(a) * head * 0.8, head * 1.6, Math.cos(a) * head * 0.8), { len: (o.hairLen ?? 0.7) * rng.range(0.8, 1.2), width: 0.07, segs: 6, mat: hairMat })); }
  for (const st of strips) ctx.scene.add(st.mesh);

  let phase = 0, acc = 0, look = new THREE.Vector2(); const _ep = new THREE.Vector3();
  const f = {
    root, bones: B, eyes, strips,
    setEyeGlow(k) { for (const e of eyes) e.material.color.setRGB(...(o.eyes ?? [1, 0.95, 0.85])).multiplyScalar(k); },
    update(dt, { mode = 'idle', speed = 1.2, lookAt = null, stepRate = 0 } = {}) {
      // eyes keep a minimum screen size (about 2 px at 1080p): at 10+ m a real-size eye is sub-pixel and never blooms
      if (eyes.length && ctx.camera) { eyes[0].getWorldPosition(_ep); const k = Math.max(1, _ep.distanceTo(ctx.camera.position) / 6); for (const e of eyes) e.scale.setScalar(k); }
      acc += dt; const step = stepRate > 0 ? 1 / stepRate : 0;
      if (step && acc < step) { for (const st of strips) st.update(dt); return; }
      const T = step ? acc : dt; acc = 0; phase += T * (mode === 'walk' ? speed * 1.8 : mode === 'stalk' ? speed * 1.1 : 0.4);
      const sw = Math.sin(phase * Math.PI), cw = Math.cos(phase * Math.PI), breathe = Math.sin(performance.now() / 1000 * 1.4);
      const walk = mode === 'walk' || mode === 'stalk' ? 1 : 0, hunch = mode === 'stalk' ? 0.45 : mode === 'reach' ? 0.15 : 0.05;
      B.spine.rotation.x = hunch + 0.02 * breathe; B.chest.rotation.x = hunch * 0.6; B.chest.rotation.y = sw * 0.08 * walk;
      B.hips.position.y = leg - Math.abs(cw) * 0.03 * walk - hunch * 0.08;
      for (const [s, side] of [[-1, B.L], [1, B.R]]) {
        const ph = s * sw * walk;
        side.thigh.rotation.x = -ph * (mode === 'stalk' ? 0.55 : 0.45); side.shin.rotation.x = Math.max(0, s * cw * walk) * 0.7 + hunch * 0.3;
        const reach = mode === 'reach' ? 1 : mode === 'stalk' ? 0.35 : 0;
        side.upper.rotation.x = ph * 0.35 * (1 - reach) - reach * 1.3; side.upper.rotation.z = s * (0.08 + 0.03 * breathe);
        side.fore.rotation.x = -0.15 - reach * 0.2; side.hand.rotation.x = -0.2;
      }
      if (lookAt) {   // head turns toward a target, clamped
        const hp = new THREE.Vector3(); B.head.getWorldPosition(hp); const d = lookAt.clone().sub(hp); const inv = new THREE.Quaternion(); root.getWorldQuaternion(inv).invert(); d.applyQuaternion(inv);
        look.x = damp(look.x, THREE.MathUtils.clamp(Math.atan2(d.x, d.z), -1.1, 1.1), 6, T); look.y = damp(look.y, THREE.MathUtils.clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.6, 0.5), 6, T);
      }
      B.head.rotation.set(-look.y - hunch * 0.6, look.x, mode === 'idle' ? Math.sin(phase * 0.7) * 0.18 : 0);   // idle: slow, wrong head tilt
      for (const st of strips) st.update(T);
    },
  };
  return f;   // place root first, then call update every frame (cloth initialises on the first update)
}
