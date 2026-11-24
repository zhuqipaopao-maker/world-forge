// Stand-ins. If a module throws while booting, the game swaps in its stub and keeps
// running, so one broken system never hides the state of all the others.
// Keep each stub's API identical to the real module's public API.
const noop = () => {};

export const STUBS = {
  mats: () => ({ stub: true, get: () => null, update: noop }),
  props: () => ({ stub: true, build: () => null, list: () => [], update: noop }),
  level: () => ({ stub: true, playerStart: { pos: [0, 0, 6], yaw: 0 }, objectives: [], cinematicPath: [], interiorBoxes: [], surfaceAt: () => 'default', update: noop }),
  fx: () => ({ stub: true, update: noop, burst: noop, clear: noop }),
  audio: () => ({ stub: true, update: noop, resume: noop, play: noop, setIntensity: noop, setPaused: noop }),
  hud: () => ({ stub: true, update: noop, toast: noop, setObjective: noop }),
  player: () => ({ stub: true, enabled: false, update: noop, reset: noop, damage: noop }),
};

// Input that does nothing — used in showcase / bench / shot modes.
export function nullInput() {
  return { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, fire: false, sprint: false, crouch: false, jump: false,
    locked: false, down: () => false, pressed: () => false, update: noop, endFrame: noop, requestLock: noop };
}
