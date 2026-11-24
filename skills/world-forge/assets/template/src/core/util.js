// Small shared helpers: seeded rng, math, event bus.

// Seeded RNG (splitmix-like). Same seed => same world => comparable screenshots.
export function makeRng(seed = 1337) {
  let s = seed >>> 0;
  const r = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.sign = () => (r() < 0.5 ? -1 : 1);
  r.fork = () => makeRng(Math.floor(r() * 4294967296));
  return r;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sat = (v) => clamp(v, 0, 1);
export const smoothstep = (a, b, v) => { const t = sat((v - a) / (b - a)); return t * t * (3 - 2 * t); };
// Frame-rate independent exponential approach: x = damp(x, target, rate, dt)
export const damp = (x, target, rate, dt) => target + (x - target) * Math.exp(-rate * dt);

export function makeEvents() {
  const map = new Map();
  return {
    on(name, fn) { if (!map.has(name)) map.set(name, []); map.get(name).push(fn); return () => this.off(name, fn); },
    off(name, fn) { const l = map.get(name); if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
    emit(name, data) {
      const l = map.get(name); if (!l) return;
      for (const fn of l) { try { fn(data); } catch (e) { console.error(`[events] handler for "${name}" threw`, e); } }
    },
  };
}
