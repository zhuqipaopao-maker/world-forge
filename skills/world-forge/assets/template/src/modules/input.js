// INPUT: keyboard + mouse with pointer lock. Exposes a plain state object read by player/game.
export function create(ctx) {
  const down = new Set(), pressed = new Set();
  const s = {
    move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, fire: false, sprint: false, crouch: false, jump: false, locked: false, sensitivity: 1,
    down: (k) => down.has(k), pressed: (k) => pressed.has(k),
    requestLock() { ctx.renderer.domElement.requestPointerLock?.(); },
    exitLock() { document.exitPointerLock?.(); },
    update() {
      s.move.x = (down.has('KeyD') ? 1 : 0) - (down.has('KeyA') ? 1 : 0);
      s.move.y = (down.has('KeyW') ? 1 : 0) - (down.has('KeyS') ? 1 : 0);
      s.sprint = down.has('ShiftLeft'); s.crouch = down.has('KeyC') || down.has('ControlLeft'); s.jump = pressed.has('Space');
    },
    endFrame() { pressed.clear(); s.look.dx = 0; s.look.dy = 0; },
  };
  addEventListener('keydown', (e) => { if (!down.has(e.code)) pressed.add(e.code); down.add(e.code); });
  addEventListener('keyup', (e) => down.delete(e.code));
  addEventListener('blur', () => down.clear());
  // no pointer lock (embedded frames, some browsers deny it): hold the left button and drag to look
  addEventListener('mousemove', (e) => { if (s.locked || (e.buttons & 1)) { s.look.dx += e.movementX * s.sensitivity; s.look.dy += e.movementY * s.sensitivity; } });
  document.addEventListener('pointerlockerror', () => ctx.events.emit('lockerror'));
  addEventListener('mousedown', (e) => { if (e.button === 0) s.fire = true; pressed.add('Mouse' + e.button); });
  addEventListener('mouseup', (e) => { if (e.button === 0) s.fire = false; });
  document.addEventListener('pointerlockchange', () => { s.locked = document.pointerLockElement === ctx.renderer.domElement; ctx.events.emit('lock', s.locked); });
  return s;
}
