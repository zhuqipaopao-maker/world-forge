// AUDIO: every sound is a function of Web Audio nodes — no files.
// Buses: master <- (sfx, ambience, music); sfx feeds a generated reverb; master -> compressor -> out.
// A sound = 2–3 short layers (transient, body, tail), each: source -> filter -> gain envelope.
// RECIPES(ac, out, kit) is pure: the same code plays live and renders offline for tools/audiocheck.mjs
// (peak / RMS / clipping per sound — the agent cannot hear, so it measures). Grow toward audio-feel-ai-flow.md.

const noiseBuffer = (ac, secs = 2) => { const b = ac.createBuffer(1, ac.sampleRate * secs, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; };
function kitFor(ac) {
  const nb = noiseBuffer(ac);
  return {
    noise(loop = false) { const s = ac.createBufferSource(); s.buffer = nb; s.loop = loop; return s; },
    filt(type, f, q = 0.7) { const x = ac.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; },
    env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); },
    gain(v = 0) { const g = ac.createGain(); g.gain.value = v; return g; },   // default 0: a source started before its env() would leak at full volume
    osc(type, f) { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; return o; },
  };
}

// ---- FOOTSTEPS: sample-level synthesis, rendered once per AudioContext (8 variants per surface) ----
// What makes a step read as a step (in order of importance):
//  1. the BOOT IMPACT is the loudest layer: noise through a low-pass that falls from bright to dull in ~50 ms
//     (100-800 Hz thump). Without it you hear "frying" or "paper", not feet.
//  2. ONE contact per step at walking pace; the heel-to-toe roll is a continuous texture, not a second hit.
//  3. the surface TEXTURE rides on the load: snow = dense, slightly pitched crunch grains with a SOFT attack
//     (snow compresses, 15-30 ms), cold snow squeaks on the roll (stick-slip); stones = sparse ringing clacks
//     that keep settling; wood = a few short low modes; steel = damped inharmonic partials.
//  4. tone: snow absorbs highs (low-pass ~4 kHz); open air has no echo.
// Each layer is rendered on its own and scaled to a target peak, so the mix is set by the numbers below.
function synthStep(sr, surf, rnd) {
  const N = Math.floor(sr * 0.5), d = new Float32Array(N);
  const heel = 0.006;
  const lu = (a, b) => a * Math.pow(b / a, rnd());   // log-uniform
  const layer = (peak, fn) => { const L = new Float32Array(N); fn(L); let m = 0; for (let i = 0; i < N; i++) m = Math.max(m, Math.abs(L[i])); const k = peak * (0.85 + 0.3 * rnd()) / (m || 1); for (let i = 0; i < N; i++) d[i] += L[i] * k; };
  // boot impact: noise -> 2-pole low-pass sweeping f0 -> f1; attack in seconds
  const impact = (L, t0, dur, f0, f1, atk) => {
    const i0 = Math.floor(t0 * sr), n = Math.floor(dur * sr); let y = 0, y2 = 0;
    for (let i = 0; i < n && i0 + i < N; i++) { const u = i / n, f = f0 * Math.pow(f1 / f0, Math.min(1, u * 2.5)), c = 1 - Math.exp(-6.2832 * f / sr); y += c * ((rnd() * 2 - 1) - y); y2 += c * (y - y2); L[i0 + i] += y2 / Math.sqrt(c) * (1 - Math.exp(-i / (atk * sr + 1))) * Math.exp(-u * 4.5); }
  };
  // one resonant grain: a short noise kick into a band-pass biquad (f, q) that rings out by itself
  const grain = (L, i0, f, q, exLen, amp) => {
    if (i0 >= N) return; f = Math.min(f, sr * 0.45);
    const w = 6.2832 * f / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al, b0 = al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
    const n = Math.min(N - i0, exLen + Math.floor(q / (Math.PI * f) * 7 * sr) + 8); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let k = 0; k < n; k++) { const x = k < exLen ? (rnd() * 2 - 1) * Math.exp(-3 * k / exLen) : 0, y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; L[i0 + k] += amp * y; }
  };
  // grain cloud riding a load envelope: atk = fraction of dur spent rising (soft for snow, short for stones)
  const cloud = (L, t0, dur, rate, atk, fr, q, ex, tail = 1.6) => {
    const i0 = Math.floor(t0 * sr), n = Math.floor(dur * sr);
    for (let i = 0; i < n; i++) {
      const u = i / n, env = u < atk ? Math.sin(u / atk * Math.PI / 2) : Math.pow(1 - (u - atk) / (1 - atk), tail);
      if (rnd() >= rate * env / sr) continue;
      grain(L, i0 + i, lu(fr[0], fr[1]), q[0] + (q[1] - q[0]) * rnd(), Math.max(2, Math.floor(lu(ex[0], ex[1]) * sr / 1000)), env * (0.3 + 0.7 * rnd()) * (rnd() < 0.5 ? -1 : 1));
    }
  };
  const modes = (L, t0, fr, dec, amp) => { const i0 = Math.floor(t0 * sr); fr.forEach((f0, m) => { const f = f0 * (0.94 + 0.12 * rnd()), ph = rnd() * 6.283, dc = dec[m] ?? dec[0], a = amp[m] ?? amp[0]; for (let i = 0, n = Math.min(N - i0, Math.floor(dc * 7 * sr)); i < n; i++) { const t = i / sr; L[i0 + i] += a * Math.sin(ph + 6.2832 * f * t) * Math.exp(-t / dc) * Math.min(1, t / 0.0015); } }); };
  // cold-snow squeak: stick-slip = a jittered pulse train (300-600 Hz) through a 1-2 kHz band-pass, rising then fading
  const squeak = (L, t0, dur) => {
    const i0 = Math.floor(t0 * sr), n = Math.floor(dur * sr), f = 300 + rnd() * 300; let next = 0;
    for (let i = 0; i < n; i++) { if (i >= next) { const u = i / n; grain(L, i0 + i, lu(1100, 2200), 6, 3, Math.sin(Math.PI * u) * (0.6 + 0.4 * rnd())); next = i + Math.floor(sr / (f * (1 + 0.25 * u) * (0.85 + 0.3 * rnd()))); } }
  };
  // ONE impact per step, then one continuous texture while the weight rolls heel -> toe (~0.25 s, so at
  // walking pace each step almost reaches the next). A second, separate toe hit makes "da-dum da-dum":
  // the user heard that as "像在骑马" (a galloping horse).
  const S = {
    snow() {
      layer(1.0, (L) => impact(L, heel, 0.09, 1100, 220, 0.012));
      layer(0.6, (L) => cloud(L, heel, 0.28, 6000, 0.12, [450, 2800], [1.5, 4], [0.3, 1.4], 1.2));
      if (rnd() < 0.55) layer(0.1 + rnd() * 0.08, (L) => squeak(L, heel + 0.07 + rnd() * 0.04, 0.07 + rnd() * 0.04));
    },
    ballast() {   // crushed stone between the sleepers: sparse ringing clacks that keep settling under the foot
      layer(0.9, (L) => impact(L, heel, 0.07, 1500, 250, 0.003));
      layer(0.8, (L) => cloud(L, heel, 0.22, 1100, 0.05, [1100, 4500], [4, 10], [0.15, 0.5], 3.2));   // steep tail: a late loud stone reads as a second step
      layer(0.2, (L) => cloud(L, heel, 0.22, 2500, 0.15, [500, 2500], [1.5, 3], [0.3, 1], 1.2)); // thin snow on top
    },
    sleeper() {   // a heavy timber bedded in stone: dull short "tok", no ring, a little ice grit
      layer(1.0, (L) => impact(L, heel, 0.06, 1800, 300, 0.002));
      layer(0.55, (L) => modes(L, heel, [230 + rnd() * 80, 520 + rnd() * 120], [0.018, 0.01], [1, 0.5]));
      layer(0.2, (L) => cloud(L, heel, 0.2, 1500, 0.1, [600, 3000], [1.5, 4], [0.2, 0.8], 1.2));
    },
    rail() {      // boot on a rail head: damped inharmonic steel partials + a faint long ring down the rail
      layer(0.8, (L) => impact(L, heel, 0.06, 2000, 300, 0.002));
      layer(0.5, (L) => modes(L, heel, [430, 1150, 2240, 3700], [0.09, 0.06, 0.04, 0.025], [1, 0.7, 0.5, 0.3]));
      layer(0.08, (L) => modes(L, heel, [2900 + rnd() * 300], [0.35], [1]));
    },
    wood() {      // platform planks over a hollow frame, thin snow on top
      layer(1.0, (L) => impact(L, heel, 0.07, 1600, 250, 0.002));
      layer(0.55, (L) => modes(L, heel, [104, 166, 247, 395], [0.035, 0.03, 0.022, 0.015], [1, 0.8, 0.6, 0.35]));
      layer(0.25, (L) => cloud(L, heel, 0.24, 2600, 0.12, [500, 2800], [1.5, 4], [0.3, 1.2], 1.2));
    },
    floor() {     // dry indoor boards: impact + short low modes + a soft sole scuff on the roll
      layer(1.0, (L) => impact(L, heel, 0.07, 2000, 300, 0.002));
      layer(0.5, (L) => modes(L, heel, [142, 228, 345, 610], [0.03, 0.025, 0.018, 0.012], [1, 0.75, 0.5, 0.25]));
      layer(0.13, (L) => cloud(L, heel + 0.02, 0.18, 6000, 0.4, [1500, 4500], [0.8, 1.5], [0.5, 2], 1.2));
    },
    wet() {       // wet bluestone flags: firm slap + a thin film of water squeezed out under the sole
      layer(1.0, (L) => impact(L, heel, 0.06, 2400, 280, 0.0015));
      layer(0.3, (L) => grain(L, Math.floor(heel * sr), 1000 + rnd() * 300, 2, 18, 1));
      layer(0.32, (L) => cloud(L, heel + 0.004, 0.2, 9000, 0.08, [1800, 7000], [0.8, 2], [0.1, 0.35], 1.6));
      if (rnd() < 0.5) layer(0.08, (L) => modes(L, heel + 0.03 + rnd() * 0.05, [1400 + rnd() * 900], [0.012], [1]));   // a droplet
    },
    stone() {     // dry-ish granite stair treads of the bridge
      layer(1.0, (L) => impact(L, heel, 0.055, 2800, 320, 0.0012));
      layer(0.3, (L) => grain(L, Math.floor(heel * sr), 1300 + rnd() * 300, 3, 14, 1));
      layer(0.16, (L) => cloud(L, heel, 0.16, 5000, 0.1, [2500, 7000], [1, 2], [0.1, 0.3], 1.6));
    },
    hard() {      // concrete, asphalt, frozen ground: sharp impact, a short slap, a little sand grit
      layer(1.0, (L) => impact(L, heel, 0.06, 2600, 300, 0.0015));
      layer(0.35, (L) => grain(L, Math.floor(heel * sr), 900 + rnd() * 300, 2, 20, 1));
      layer(0.2, (L) => cloud(L, heel, 0.2, 1500, 0.1, [1500, 5000], [2, 5], [0.1, 0.4], 1.2));
    },
  };
  (S[surf] || S.hard)();
  const cut = { wet: 8000, stone: 8000, snow: 4200, ballast: 7000, sleeper: 5000, rail: 9000, wood: 5000, floor: 5500, hard: 7000 }[surf] || 7000, c = 1 - Math.exp(-6.2832 * cut / sr);
  for (let pass = 0; pass < 2; pass++) { let y = 0; for (let i = 0; i < N; i++) { y += c * (d[i] - y); d[i] = y; } }
  // high-pass: a step has a thump, not a rumble (snow most of all: it is soft and short)
  const hp = { wet: 80, stone: 80, snow: 120, ballast: 70, sleeper: 60, rail: 80, wood: 50, floor: 60, hard: 70 }[surf] || 70, ch = 1 - Math.exp(-6.2832 * hp / sr);
  for (let pass = 0; pass < 2; pass++) { let lo = 0; for (let i = 0; i < N; i++) { lo += ch * (d[i] - lo); d[i] -= lo; } }
  let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(d[i]));
  const k = 0.7 / (peak || 1), fade = Math.floor(0.03 * sr); for (let i = 0; i < N; i++) d[i] *= k * Math.min(1, (N - i) / fade);
  return d;
}
// surfaces: level.surfaceAt returns one of these ('hard' is the fallback for anything unknown)
const STEP_BANKS = new WeakMap(), STEP_LEVEL = { wet: 0.5, stone: 0.5, snow: 0.55, ballast: 0.6, sleeper: 0.5, rail: 0.45, wood: 0.5, floor: 0.5, hard: 0.5 };
function stepBank(ac) {
  let b = STEP_BANKS.get(ac); if (b) return b;
  let seed = 9173; const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  b = {}; for (const s of Object.keys(STEP_LEVEL)) b[s] = Array.from({ length: 8 }, () => { const d = synthStep(ac.sampleRate, s, rnd), buf = ac.createBuffer(1, d.length, ac.sampleRate); buf.getChannelData(0).set(d); return buf; });
  STEP_BANKS.set(ac, b); return b;
}
let lastStep = -1;

// name -> (t, opts) => void.  Add your world's sounds here; every one shows up in audiocheck.
// rainy worlds: rain = patter loop level (0 = off, 1 = full), drips = random eave drips into puddles (0 = off, 1 = ~2/s)
export const WEATHER_SOUND = { rain: 0, drips: 0 };
// the acoustic space: bed = 'wind' (outdoor noise layers + gusts) | 'station' (fluorescent hum, ventilation, tunnel
// wind) | 'none'; stepRoom = step reverb length (s) and stepSend its level outside / inside interiorBoxes.
// Outdoors is dry; a tiled underground hall rings for ~1.5-2 s and every footstep comes back from the walls.
export const SPACE = { bed: 'wind', stepRoom: 0.4, stepSend: [0.03, 0.35] };   // underground hall: { bed: 'station', stepRoom: 1.7, stepSend: [0.32, 0.32] }
export const RECIPES = (ac, out, K) => ({
  click(t) { const o = K.osc('sine', 1800), g = K.gain(); o.connect(g).connect(out); K.env(g, t, 0.002, 0.3, 0.04); o.start(t); o.stop(t + 0.06); },
  thud(t, o = {}) {
    const n = K.noise(), f = K.filt('lowpass', 1200), g = K.gain(); f.frequency.setValueAtTime(1200, t); f.frequency.exponentialRampToValueAtTime(120, t + 0.25);
    n.connect(f).connect(g).connect(out); K.env(g, t, 0.003, o.gain ?? 0.7, 0.3); n.start(t); n.stop(t + 0.4);
    const s = K.osc('sine', 90), sg = K.gain(); s.frequency.exponentialRampToValueAtTime(40, t + 0.2); s.connect(sg).connect(out); K.env(sg, t, 0.002, 0.5, 0.25); s.start(t); s.stop(t + 0.3);
  },
  // footsteps: o.surface snow | hard | wood | floor, o.gain 0..1, o.run (faster roll), o.side -1/1 (slight pan)
  step(t, o = {}) {
    const bank = stepBank(ac), surf = STEP_LEVEL[o.surface] ? o.surface : 'hard', list = bank[surf];
    let i = Math.floor(Math.random() * list.length); if (i === lastStep) i = (i + 1) % list.length; lastStep = i;
    const src = ac.createBufferSource(); src.buffer = list[i]; src.playbackRate.value = (0.95 + Math.random() * 0.1) * (o.run ? 1.1 : 1);
    const g = K.gain(STEP_LEVEL[surf] * (o.gain ?? 1) * (0.8 + Math.random() * 0.2));
    let node = src.connect(g);
    if (ac.createStereoPanner) { const pn = ac.createStereoPanner(); pn.pan.value = (o.side ?? 0) * 0.1; node = node.connect(pn); }
    node.connect(out); src.start(t);
  },
  heartbeat(t, o = {}) { for (const [dt, k] of [[0, 1], [0.28, 0.7]]) { const s = K.osc('sine', 55), g = K.gain(); s.frequency.exponentialRampToValueAtTime(38, t + dt + 0.15); s.connect(g).connect(out); K.env(g, t + dt, 0.01, 0.6 * k * (o.gain ?? 1), 0.18); s.start(t + dt); s.stop(t + dt + 0.25); } },
  metal(t, o = {}) {   // clank: a few inharmonic partials with fast decay
    for (const [f, a, d] of [[523, 0.25, 0.6], [1307, 0.15, 0.35], [2211, 0.1, 0.25], [3780, 0.06, 0.15]]) { const s = K.osc('sine', f * (o.pitch ?? 1)), g = K.gain(); s.connect(g).connect(out); K.env(g, t, 0.002, a, d); s.start(t); s.stop(t + d + 0.05); }
    const n = K.noise(), f = K.filt('highpass', 3000), g = K.gain(); n.connect(f).connect(g).connect(out); K.env(g, t, 0.001, 0.2, 0.03); n.start(t); n.stop(t + 0.06);
  },
  pickup(t) {   // small metal-and-porcelain chink + a soft rising tone
    for (const [f, a, d] of [[2400, 0.18, 0.12], [3650, 0.1, 0.08], [5200, 0.05, 0.05]]) { const s = K.osc('sine', f), g = K.gain(); s.connect(g).connect(out); K.env(g, t, 0.002, a, d); s.start(t); s.stop(t + d + 0.05); }
    const o = K.osc('triangle', 520), g = K.gain(); o.frequency.exponentialRampToValueAtTime(880, t + 0.25); o.connect(g).connect(out); K.env(g, t + 0.03, 0.04, 0.12, 0.35); o.start(t + 0.03); o.stop(t + 0.5);
  },
  clunk(t) {    // fuse seated in its holder: snap + body thump + ring
    const n = K.noise(), f = K.filt('bandpass', 2500, 2), g = K.gain(); n.connect(f).connect(g).connect(out); K.env(g, t, 0.001, 0.5, 0.03); n.start(t); n.stop(t + 0.06);
    const s = K.osc('sine', 140), sg = K.gain(); s.frequency.exponentialRampToValueAtTime(70, t + 0.12); s.connect(sg).connect(out); K.env(sg, t, 0.002, 0.45, 0.15); s.start(t); s.stop(t + 0.2);
    for (const [fr, a] of [[1180, 0.08], [1730, 0.05]]) { const r = K.osc('sine', fr), rg = K.gain(); r.connect(rg).connect(out); K.env(rg, t + 0.005, 0.002, a, 0.4); r.start(t + 0.005); r.stop(t + 0.5); }
  },
  relay(t) {    // relays pull in: three clacks, then a 50 Hz transformer hum swells
    for (const d of [0, 0.09, 0.15]) { const n = K.noise(), f = K.filt('highpass', 1500), g = K.gain(); n.connect(f).connect(g).connect(out); K.env(g, t + d, 0.001, 0.35, 0.025); n.start(t + d); n.stop(t + d + 0.05); }
    for (const [fr, a] of [[100, 0.18], [200, 0.08], [300, 0.04]]) { const o = K.osc('sawtooth', fr), lp = K.filt('lowpass', 600), g = K.gain(); o.connect(lp).connect(g).connect(out); K.env(g, t + 0.2, 0.3, a, 1.3); o.start(t + 0.2); o.stop(t + 1.9); }
  },
  creak(t, o = {}) {   // a branch creaks and snow slides somewhere in the trees
    const s = K.osc('sawtooth', 70 + Math.random() * 30), bp = K.filt('bandpass', 900, 8), g = K.gain();
    s.frequency.linearRampToValueAtTime(55, t + 0.7); s.connect(bp).connect(g).connect(out); K.env(g, t, 0.15, 0.14 * (o.gain ?? 1), 0.6); s.start(t); s.stop(t + 0.9);
    const n = K.noise(), f = K.filt('lowpass', 1200), g2 = K.gain(); n.connect(f).connect(g2).connect(out); K.env(g2, t + 0.5, 0.2, 0.12 * (o.gain ?? 1), 0.9); n.start(t + 0.4); n.stop(t + 1.7);
  },
  sting(t) {    // the lunge: low boom + dissonant cluster + noise rush
    const b = K.osc('sine', 60), bg = K.gain(); b.frequency.exponentialRampToValueAtTime(30, t + 1.2); b.connect(bg).connect(out); K.env(bg, t, 0.005, 0.5, 1.4); b.start(t); b.stop(t + 1.6);
    for (const fr of [311, 329, 466, 494]) { const o = K.osc('sawtooth', fr), lp = K.filt('lowpass', 1800), g = K.gain(); o.connect(lp).connect(g).connect(out); K.env(g, t, 0.01, 0.05, 1.6); o.start(t); o.stop(t + 1.8); }
    const n = K.noise(), f = K.filt('bandpass', 3000, 0.8), g = K.gain(); n.connect(f).connect(g).connect(out); K.env(g, t, 0.003, 0.3, 0.5); n.start(t); n.stop(t + 0.6);
  },
  bell(t, o = {}) {    // the boatman's bronze hand bell: strike + inharmonic partials, long ring
    const k = o.gain ?? 1;
    for (const [f, a, d] of [[620, 0.22, 1.8], [1245, 0.12, 1.1], [1610, 0.1, 0.8], [2290, 0.06, 0.5], [3020, 0.04, 0.35]]) { const s = K.osc('sine', f), g = K.gain(); s.connect(g).connect(out); K.env(g, t, 0.002, a * k, d); s.start(t); s.stop(t + d + 0.1); }
    const n = K.noise(), f = K.filt('bandpass', 3500, 1.5), g = K.gain(); n.connect(f).connect(g).connect(out); K.env(g, t, 0.001, 0.25 * k, 0.02); n.start(t); n.stop(t + 0.05);
  },
  deliver(t) {   // a letter slides across a wooden counter, then two soft knocks of the hand on the wood
    const n = K.noise(), f = K.filt('bandpass', 2600, 0.7), g = K.gain(); n.connect(f).connect(g).connect(out);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32); n.start(t); n.stop(t + 0.35);
    for (const d of [0.38, 0.52]) { const o = K.osc('sine', 190), og = K.gain(); o.frequency.exponentialRampToValueAtTime(120, t + d + 0.08); o.connect(og).connect(out); K.env(og, t + d, 0.002, 0.4, 0.09); o.start(t + d); o.stop(t + d + 0.15);
      const c = K.noise(), cf = K.filt('bandpass', 1400, 2), cg = K.gain(); c.connect(cf).connect(cg).connect(out); K.env(cg, t + d, 0.001, 0.2, 0.025); c.start(t + d); c.stop(t + d + 0.05); }
  },
  drip(t, o = {}) {   // one drop from an eave into a puddle: a fast rising "plink" over a tiny splash
    const f0 = (o.pitch ?? 1) * (900 + Math.random() * 700), s = K.osc('sine', f0), g = K.gain(); s.frequency.exponentialRampToValueAtTime(f0 * 2.1, t + 0.04); s.connect(g).connect(out); K.env(g, t, 0.001, 0.12 * (o.gain ?? 1), 0.05); s.start(t); s.stop(t + 0.08);
    const n = K.noise(), f = K.filt('highpass', 3000), ng = K.gain(); n.connect(f).connect(ng).connect(out); K.env(ng, t, 0.001, 0.05 * (o.gain ?? 1), 0.02); n.start(t); n.stop(t + 0.04);
  },
  chime(t, o = {}) {   // the station's two-tone announcement chime (叮咚): soft bell partials, long ring
    const k = o.gain ?? 1;
    for (const [d, f0] of [[0, 784], [0.55, 659.3]]) for (const [m, a, dec] of [[1, 0.2, 1.6], [2.01, 0.05, 0.7], [3.0, 0.025, 0.4]]) {
      const s = K.osc('sine', f0 * m), g = K.gain(); s.connect(g).connect(out); K.env(g, t + d, 0.004, a * k, dec); s.start(t + d); s.stop(t + d + dec + 0.1); }
  },
  flicker(t, o = {}) { // a starter relay clacks and the tubes buzz while they fail to strike
    const n = K.noise(), f = K.filt('bandpass', 2200, 3), g = K.gain(); n.connect(f).connect(g).connect(out); K.env(g, t, 0.001, 0.35, 0.03); n.start(t); n.stop(t + 0.06);
    const b = K.osc('sawtooth', 100), bf = K.filt('bandpass', 600, 2), bg = K.gain(); b.connect(bf).connect(bg).connect(out);
    bg.gain.setValueAtTime(0.0001, t); for (let i = 0; i < 9; i++) { const ti = t + 0.04 + i * 0.07; bg.gain.setValueAtTime(i % 2 ? 0.0001 : 0.12 * (o.gain ?? 1), ti); }
    bg.gain.setValueAtTime(0.0001, t + 0.7); b.start(t); b.stop(t + 0.75);
  },
  lock(t) {            // a steel gate pulled to, the bolt, then a padlock snapping shut
    const n = K.noise(), f = K.filt('bandpass', 900, 1.5), g = K.gain(); n.connect(f).connect(g).connect(out); K.env(g, t, 0.002, 0.5, 0.25); n.start(t); n.stop(t + 0.3);
    for (const [fr, a, d] of [[310, 0.25, 0.6], [742, 0.12, 0.4], [1310, 0.06, 0.25]]) { const s = K.osc('sine', fr), sg = K.gain(); s.connect(sg).connect(out); K.env(sg, t, 0.002, a, d); s.start(t); s.stop(t + d + 0.1); }
    const c = K.noise(), cf = K.filt('highpass', 3500), cg = K.gain(); c.connect(cf).connect(cg).connect(out); K.env(cg, t + 0.7, 0.001, 0.4, 0.015); c.start(t + 0.7); c.stop(t + 0.75);
  },
  switch(t) {          // a heavy key switch, then the PA amplifier's hum dies away
    const c = K.noise(), cf = K.filt('bandpass', 1800, 2), cg = K.gain(); c.connect(cf).connect(cg).connect(out); K.env(cg, t, 0.001, 0.5, 0.02); c.start(t); c.stop(t + 0.05);
    const h = K.osc('sawtooth', 50), hf = K.filt('lowpass', 300), hg = K.gain(); h.connect(hf).connect(hg).connect(out); hg.gain.setValueAtTime(0.06, t); hg.gain.exponentialRampToValueAtTime(0.0001, t + 1.2); h.start(t); h.stop(t + 1.3);
  },
  pen(t) {             // a ballpoint signing: five quick strokes of paper noise
    for (let i = 0; i < 5; i++) { const ti = t + i * 0.16 + Math.random() * 0.04, n = K.noise(), f = K.filt('bandpass', 3500 + Math.random() * 2000, 1.5), g = K.gain(); n.connect(f).connect(g).connect(out); K.env(g, ti, 0.01, 0.08, 0.1); n.start(ti); n.stop(ti + 0.14); }
  },
  train(t, o = {}) {   // a train in the tunnel that should not exist: far rumble swelling, wheel beats, a squeal, gone
    const k = o.gain ?? 1, n = K.noise(), lp = K.filt('lowpass', 160), g = K.gain(); n.connect(lp).connect(g).connect(out);
    g.gain.setValueAtTime(0.2 * k, t); g.gain.exponentialRampToValueAtTime(3.0 * k, t + 5); g.gain.exponentialRampToValueAtTime(0.0001, t + 9); n.start(t); n.stop(t + 9.2);   // audible from the start: far rumble
    for (let i = 0; i < 16; i++) { const ti = t + 3 + i * 0.28, c = K.noise(), cf = K.filt('bandpass', 400, 2), cg = K.gain(); c.connect(cf).connect(cg).connect(out); K.env(cg, ti, 0.003, 0.35 * k * Math.max(0.05, Math.sin(Math.PI * (i + 0.5) / 16)), 0.08); c.start(ti); c.stop(ti + 0.12); }
    const sq = K.osc('sine', 2400), sg = K.gain(); sq.connect(sg).connect(out); sg.gain.setValueAtTime(0.0001, t + 5.2); sg.gain.exponentialRampToValueAtTime(0.03 * k, t + 5.6); sg.gain.exponentialRampToValueAtTime(0.0001, t + 6.6); sq.frequency.linearRampToValueAtTime(2150, t + 6.6); sq.start(t + 5.2); sq.stop(t + 6.7);
  },
  horn(t, o = {}) {   // a two-tone diesel horn, far away: low-passed, long tail
    const k = o.gain ?? 1, lp = K.filt('lowpass', 900 + 1500 * k), g = K.gain(); lp.connect(g).connect(out);
    for (const fr of [311, 370, 466]) { const s = K.osc('sawtooth', fr), sg = K.gain(0.12); s.connect(sg).connect(lp); s.start(t); s.stop(t + 2.2); }
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * k, t + 0.08); g.gain.setValueAtTime(0.5 * k, t + 1.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
  },
});

export async function create(ctx) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC(), K = kitFor(ac);
  const master = K.gain(0.8), comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp).connect(ac.destination);
  const bus = (g) => { const n = K.gain(g); n.connect(master); return n; };
  const sfx = bus(0.9), amb = bus(0.5), music = bus(0.35);
  // reverb impulse from decaying stereo noise
  const ir = ac.createBuffer(2, ac.sampleRate * 2.2, ac.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3); }
  const verb = ac.createConvolver(); verb.buffer = ir; const verbOut = K.gain(0.25); verb.connect(verbOut).connect(master); sfx.connect(verb);
  // ambience bed: band-passed noise layers, always running (high hiss, mid body, low rumble) + slow gusts
  const gust = K.gain(1); gust.connect(amb);
  if (SPACE.bed === 'wind') for (const [type, f, g] of [['highpass', 4000, 0.16], ['bandpass', 700, 0.12], ['lowpass', 140, 0.22]]) { const n = K.noise(true), fl = K.filt(type, f), gn = K.gain(g); n.connect(fl).connect(gn).connect(gust); n.start(); }
  if (SPACE.bed === 'station') {
    // fluorescent ballast hum (100 Hz and its harmonics, narrow), the ventilation roar, tunnel air breathing in the gusts
    for (const [f, g] of [[100, 0.035], [200, 0.02], [300, 0.012]]) { const o = K.osc('sawtooth', f), bp = K.filt('bandpass', f, 12), gn = K.gain(g); o.connect(bp).connect(gn).connect(amb); o.start(); }
    for (const [type, f, g, q] of [['lowpass', 220, 0.3, 1], ['bandpass', 900, 0.05, 0.7]]) { const n = K.noise(true), fl = K.filt(type, f, q), gn = K.gain(g); n.connect(fl).connect(gn).connect(amb); n.start(); }
    const w = K.noise(true), wf = K.filt('bandpass', 180, 1.2), wg = K.gain(0.25); w.connect(wf).connect(wg).connect(gust); w.start();
  }
  // rain patter: a 6 s loop of ~2400 tiny drop impacts (each a damped high blip + a noise tick), stereo,
  // over the noise bed: what makes the bed read as RAIN on tiles and water instead of wind
  if (WEATHER_SOUND.rain > 0) {
    const sr = ac.sampleRate, N = sr * 6, buf = ac.createBuffer(2, N, sr);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c);
      for (let k = 0; k < 2400; k++) { const i0 = Math.floor(Math.random() * N), f = 1800 + Math.random() * 4200, dec = 0.002 + Math.random() * 0.006, a = 0.05 + Math.random() * Math.random() * 0.25;
        for (let i = 0, n = Math.floor(dec * 6 * sr); i < n; i++) { const t = i / sr, j = (i0 + i) % N; d[j] += a * Math.exp(-t / dec) * (Math.sin(6.2832 * f * t) * 0.7 + (Math.random() * 2 - 1) * 0.3); } } }
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true; const hp = K.filt('highpass', 900), g = K.gain(0.5 * WEATHER_SOUND.rain); src.connect(hp).connect(g).connect(amb); src.start();
  }
  // dread drone: two detuned low sines + band-passed noise on the music bus; setIntensity(0..1) swells it
  const drone = K.gain(0); drone.connect(music); for (const fr of [55, 58.3]) { const o = K.osc('sine', fr); o.connect(drone); o.start(); }
  const dn = K.noise(true), dnf = K.filt('bandpass', 260, 4); dn.connect(dnf).connect(drone); dn.start();
  const S = RECIPES(ac, sfx, K);
  let intensity = 0;
  // steps skip the big reverb: dry outside (open air, snow eats echo), a short small-room tail indoors
  const stepBus = K.gain(1); stepBus.connect(master);
  const room = ac.createBuffer(2, ac.sampleRate * SPACE.stepRoom, ac.sampleRate);
  for (let c = 0; c < 2; c++) { const d = room.getChannelData(c), tau = SPACE.stepRoom * 0.16; for (let i = 0; i < d.length; i++) { const tt = i / ac.sampleRate; d[i] = (Math.random() * 2 - 1) * Math.exp(-tt / tau) * (tt < 0.012 ? tt / 0.012 : 1); } }   // a short pre-delay gap, then a smooth decay
  const roomV = ac.createConvolver(); roomV.buffer = room; const roomSend = K.gain(SPACE.stepSend[0]); stepBus.connect(roomSend).connect(roomV).connect(master);
  const SS = RECIPES(ac, stepBus, K);
  // level.surfaceAt(x, z) returns a STEP_LEVEL key: snow | ballast | sleeper | rail | wood (outdoor planks) | floor (indoor boards) | hard (concrete, asphalt; also the fallback)
  // fixed 50 ms latency minus the overshoot (e.ago) = even spacing whatever the frame rate
  ctx.events.on('player:step', (e) => SS.step(ac.currentTime + 0.05 - Math.min(0.045, e.ago || 0), { surface: e.surface, gain: Math.min(1, 0.45 + e.speed / 8), run: e.speed > 5.5, side: e.side }));
  ctx.events.on('player:land', (v) => { const cp = ctx.camera.position; SS.step(ac.currentTime + 0.005, { surface: ctx.level?.surfaceAt?.(cp.x, cp.z), gain: Math.min(1.3, 0.6 + v / 10) }); });
  return {
    ctx: ac, buses: { master, sfx, amb, music },
    resume() { if (ac.state !== 'running') ac.resume(); },
    play(name, opts) { const fn = S[name]; if (!fn) { console.error(`[audio] unknown sound "${name}"`); return; } fn(ac.currentTime + 0.005, opts); },
    setIntensity(v) { intensity = v; },
    setPaused(p) { master.gain.setTargetAtTime(p ? 0.15 : 0.8, ac.currentTime, 0.1); },
    update() {
      const t = ac.currentTime; gust.gain.setTargetAtTime(0.75 + 0.35 * Math.sin(t * 0.21) * Math.sin(t * 0.077 + 1), t, 0.8);
      music.gain.setTargetAtTime(0.2 + intensity * 0.3, t, 0.5);
      drone.gain.setTargetAtTime(Math.pow(intensity, 1.5) * 0.5, t, 0.8);
      if (WEATHER_SOUND.drips && Math.random() < 0.035 * WEATHER_SOUND.drips) S.drip(t + 0.01 + Math.random() * 0.05, { gain: 0.25 + Math.random() * 0.6, pitch: 0.7 + Math.random() * 0.6 });
      const inside = (ctx.level?.interiorBoxes || []).some((b) => b.containsPoint(ctx.camera.position)); amb.gain.setTargetAtTime(inside && SPACE.bed === 'wind' ? 0.18 : 0.5, t, 0.4); roomSend.gain.setTargetAtTime(SPACE.stepSend[inside ? 1 : 0], t, 0.2);   // walls muffle the weather
    },
  };
}

// Render every recipe offline and measure it. Used by tools/audiocheck.mjs via window.__audioReport().
export async function report() {
  const out = [];
  const names = Object.keys(RECIPES({ createGain() {} }, null, {}));
  const cases = names.filter((n) => n !== 'step').map((n) => [n, {}]).concat(Object.keys(STEP_LEVEL).map((s) => ['step:' + s, { surface: s }]));
  for (const [name, opts] of cases) {
    const sr = 44100, oac = new OfflineAudioContext(2, sr * 10, sr), K = kitFor(oac)   /* 10 s: long swells (a train, a horn) must fit */, g = oac.createGain(); g.connect(oac.destination);
    try { RECIPES(oac, g, K)[name.split(':')[0]](0.01, opts); } catch (e) { out.push({ name, error: e.message }); continue; }
    const buf = await oac.startRendering(), d = buf.getChannelData(0);
    let peak = 0, sum = 0, last = 0, clip = 0; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); peak = Math.max(peak, a); sum += d[i] * d[i]; if (a > 1e-3) last = i; if (a >= 0.999) clip++; }
    const db = (v) => (v > 0 ? +(20 * Math.log10(v)).toFixed(1) : -120);
    out.push({ name, length_s: +(last / sr).toFixed(3), peak_dBFS: db(peak), rms_dBFS: db(Math.sqrt(sum / Math.max(1, last))), clipped_samples: clip });
  }
  return out;
}

// Render a timed list of sounds offline: [[time_s, name, opts], ...] -> mono Float32 samples (for tools/listen.mjs).
export async function renderSeq(seq, secs = 6) {
  const sr = 44100, oac = new OfflineAudioContext(2, Math.ceil(sr * secs), sr), K = kitFor(oac), g = oac.createGain(); g.connect(oac.destination);
  const R = RECIPES(oac, g, K); for (const [t, name, opts] of seq) R[name](t, opts || {});
  const buf = await oac.startRendering(); return Array.from(buf.getChannelData(0));
}
