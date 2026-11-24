// PLAYER: first-person controller. Velocity with acceleration/friction (not instant), collide-and-slide
// against level AABBs on X and Z separately, head bob tied to distance walked, landing dip.
// Every number here is a feel knob; keep them in TUNE so they can be tuned in one place.
import * as THREE from 'three';
import { PLAYER } from '../art.js';
import { damp } from '../core/util.js';

export const TUNE = { walk: 4.2, sprint: 6.8, crouch: 2.2, accel: 14, airAccel: 3, friction: 10, gravity: 22, jump: 6.2,
  bobAmp: 0.045, stride: 1.3, strideK: 0.04, lookSens: 0.0022, landDip: 0.08 };

export async function create(ctx) {
  const p = {
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true, enabled: true,
    health: 100, eye: PLAYER.eye, bob: 0, dip: 0,
    reset() {
      const s = ctx.level.playerStart; p.pos.fromArray(s.pos); p.yaw = s.yaw || 0; p.pitch = 0; p.vel.set(0, 0, 0); p.health = 100;
    },
    damage(n) { p.health = Math.max(0, p.health - n); ctx.events.emit('player:hurt', n); },
    update(dt) {
      if (!p.enabled) return;
      const inp = ctx.input;
      p.yaw -= inp.look.dx * TUNE.lookSens; p.pitch = THREE.MathUtils.clamp(p.pitch - inp.look.dy * TUNE.lookSens, -1.45, 1.45);
      const speed = inp.crouch ? TUNE.crouch : inp.sprint && inp.move.y > 0 ? TUNE.sprint : TUNE.walk;
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      let wx = fx * inp.move.y + rx * inp.move.x, wz = fz * inp.move.y + rz * inp.move.x; const l = Math.hypot(wx, wz); if (l > 1) { wx /= l; wz /= l; }
      const a = p.onGround ? TUNE.accel : TUNE.airAccel;
      p.vel.x = damp(p.vel.x, wx * speed, a, dt); p.vel.z = damp(p.vel.z, wz * speed, a, dt);
      if (p.onGround && inp.jump) { p.vel.y = TUNE.jump; p.onGround = false; }
      p.vel.y -= TUNE.gravity * dt;
      move(p, dt, ctx.level.colliders || []);
      // camera
      const target = inp.crouch ? PLAYER.crouchEye : PLAYER.eye; p.eye = damp(p.eye, target, 12, dt);
      const hs = Math.hypot(p.vel.x, p.vel.z);
      // one bob cycle = one step; stride grows with speed: walk 4.2 m/s -> ~2.9 steps/s, sprint -> ~4.3, crouch -> ~1.6
      // ago = how long before this frame the foot really landed, so audio can schedule it frame-exact (even rhythm at any fps)
      if (p.onGround) { const before = Math.floor(p.bob), db = hs * dt / (TUNE.stride + TUNE.strideK * hs); p.bob += db; if (Math.floor(p.bob) !== before) ctx.events.emit('player:step', { pos: p.pos, surface: ctx.level.surfaceAt?.(p.pos.x, p.pos.z), speed: hs, side: Math.floor(p.bob) % 2 ? 1 : -1, ago: db > 0 ? (p.bob - Math.floor(p.bob)) / db * dt : 0 }); }
      p.dip = damp(p.dip, 0, 8, dt);
      const cam = ctx.camera;
      cam.position.set(p.pos.x, p.pos.y + p.eye - p.dip + Math.abs(Math.sin(p.bob * Math.PI)) * TUNE.bobAmp * Math.min(1, hs / TUNE.walk), p.pos.z);
      cam.rotation.set(p.pitch, p.yaw, Math.sin(p.bob * Math.PI) * 0.004 * Math.min(1, hs / TUNE.walk), 'YXZ');
    },
  };
  function move(p, dt, boxes) {
    const r = PLAYER.radius, h = PLAYER.height;
    for (const axis of ['x', 'z']) {
      p.pos[axis] += p.vel[axis] * dt;
      for (const b of boxes) {
        if (p.pos.y + h <= b.min.y || p.pos.y >= b.max.y - 0.35) continue; // low boxes: step up handled below
        if (p.pos.x + r > b.min.x && p.pos.x - r < b.max.x && p.pos.z + r > b.min.z && p.pos.z - r < b.max.z) {
          if (axis === 'x') p.pos.x = p.vel.x > 0 ? b.min.x - r : b.max.x + r; else p.pos.z = p.vel.z > 0 ? b.min.z - r : b.max.z + r;
          p.vel[axis] = 0;
        }
      }
    }
    p.pos.y += p.vel.y * dt;
    let floor = ctx.level.groundHeight ? ctx.level.groundHeight(p.pos.x, p.pos.z) : 0; // terrain hook
    for (const b of boxes) if (p.pos.x + r > b.min.x && p.pos.x - r < b.max.x && p.pos.z + r > b.min.z && p.pos.z - r < b.max.z && p.pos.y >= b.max.y - 0.36) floor = Math.max(floor, b.max.y);
    if (p.pos.y <= floor) { if (!p.onGround && p.vel.y < -4) { p.dip = TUNE.landDip * Math.min(1, -p.vel.y / 12); ctx.events.emit('player:land', -p.vel.y); } p.pos.y = floor; p.vel.y = 0; p.onGround = true; }
    else p.onGround = p.pos.y - floor < 0.02;
  }
  p.reset();
  return p;
}
