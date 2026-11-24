// Feel check: things a screenshot cannot show, measured while the player really walks.
//   node tools/feel.mjs [outDir] [--url http://localhost:8740/]
// Holds W (walk), Shift+W (sprint), C+W (crouch) from the player start and reports:
//   cadence steps/s (walk 2.5-3.2, sprint 3.6-4.8, crouch 1.3-2.2), rhythm evenness (interval CV < 0.1),
//   head bob (walk 2-7 cm), speed; then checks every step sound for TWO HITS (a second loud peak after a
//   dip: heard as a galloping horse); then renders the real walk timeline to <outDir>/walk.wav + .png.
// Found in the test demo by the user, not by screenshots: 8 steps/s ("machine gun") and heel+toe double hits ("骑马").
import { chromium } from 'playwright-core';
import { execFileSync } from 'child_process';
import fs from 'fs';
import { baseUrl } from './base.mjs';
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'shots/feel';
const base = baseUrl();
fs.mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } });
await p.goto(base + '?autostart=1&noaudio=1&q=low');
await p.waitForFunction(() => (window.__ready && window.__frames > 5) || window.__fatal, null, { timeout: 120000 });
await p.evaluate(() => {
  const G = window.__G; window.__feel = { steps: [], cam: [] };
  G.events.on('player:step', (e) => window.__feel.steps.push({ t: performance.now() / 1000 - (e.ago || 0), surface: e.surface, speed: e.speed }));
  const tick = () => { window.__feel.cam.push([performance.now() / 1000, G.camera.position.y - (G.player.pos?.y ?? 0), G.player.pos?.y ?? 0, G.player.onGround ? 1 : 0]); requestAnimationFrame(tick); }; tick();
  window.__feelStart = G.player.pos.clone(); window.__feelYaw = G.player.yaw;
});
const modes = { walk: [[], [2.5, 3.2]], sprint: [['ShiftLeft'], [3.6, 4.8]], crouch: [['KeyC'], [1.3, 2.2]] };
let warn = 0; const walkSteps = [];
for (const [m, [keys, [lo, hi]]] of Object.entries(modes)) {
  await p.evaluate(() => { const P = window.__G.player; P.pos.copy(window.__feelStart); P.vel.set(0, 0, 0); P.yaw = window.__feelYaw; window.__feel.steps.length = 0; window.__feel.cam.length = 0; });
  await p.waitForTimeout(300);
  // hold the modifier first and let the eye settle (crouching lowers it ~0.6 m: that is not head bob)
  for (const k of keys) await p.keyboard.down(k); if (keys.length) await p.waitForTimeout(1200); await p.keyboard.down('KeyW'); const t0 = await p.evaluate(() => performance.now() / 1000);
  await p.waitForTimeout(3500); await p.keyboard.up('KeyW'); for (const k of keys) await p.keyboard.up(k);
  const r = await p.evaluate(() => JSON.parse(JSON.stringify(window.__feel)));
  // leave out moments near a height change (steps, a platform edge, a fall): landing dips and air time are not bob or rhythm
  const bad = []; for (let i = 1; i < r.cam.length; i++) if (Math.abs(r.cam[i][2] - r.cam[i - 1][2]) > 0.02 || !r.cam[i][3]) bad.push(r.cam[i][0]);
  const near = (t, a = 0.5) => bad.some((b) => Math.abs(b - t) < a), skipped = bad.length ? ' (height changes left out)' : '';
  const st = r.steps.filter((s) => s.t > t0 + 0.6), iv = st.slice(1).map((s, i) => [s.t - st[i].t, s.t]).filter(([, t]) => !near(t, 0.6)).map(([d]) => d);
  const mean = iv.reduce((a, x) => a + x, 0) / Math.max(1, iv.length), cv = Math.sqrt(iv.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, iv.length)) / (mean || 1);
  const cam = r.cam.filter(([t]) => t > t0 + 0.6 && !near(t)).map(([, y]) => y), bob = cam.length ? (Math.max(...cam) - Math.min(...cam)) * 100 : 0;
  const rate = mean ? 1 / mean : 0, speed = st.length ? st.reduce((a, s) => a + s.speed, 0) / st.length : 0;
  const warnMsg = !st.length ? 'no steps (blocked at the start? no player:step event?)' : rate < lo || rate > hi ? `cadence outside ${lo}-${hi}` : cv > 0.1 ? 'uneven rhythm' : m === 'walk' && (bob < 2 || bob > 7) ? 'bob outside 2-7 cm' : '';
  if (warnMsg) warn++;
  console.log(`${warnMsg ? 'WARN' : 'ok  '} ${m.padEnd(7)} ${rate.toFixed(2)} steps/s  cv ${cv.toFixed(2)}  bob ${bob.toFixed(1)} cm  speed ${speed.toFixed(1)} m/s  surfaces ${[...new Set(st.map((s) => s.surface))].join(',')}${skipped}${warnMsg ? '  <-- ' + warnMsg : ''}`);
  if (m === 'walk') walkSteps.push(...st.map((s) => [s.t - st[0].t + 0.05, s.surface]));
}
// two-hit detector on every step surface
// only the surfaces this world's walk actually stepped on (--all: every step surface the audio module knows)
const known = (await p.evaluate(() => window.__audioReport())).map((r) => r.name).filter((n) => n.startsWith('step:')).map((n) => n.slice(5));
// an unknown surface name plays the 'hard' fallback
const used = new Set(walkSteps.map(([, s]) => (known.includes(s) ? s : 'hard'))), surfaces = args.includes('--all') || !used.size ? known : known.filter((s) => used.has(s));
for (const s of surfaces) {
  const peaks = [];
  for (let v = 0; v < 6; v++) {
    const d = await p.evaluate(([s]) => window.__audioRender([[0.01, 'step', { surface: s }]], 0.6), [s]);
    const W = 220, env = []; for (let i = 0; i + W < d.length; i += W) { let e = 0; for (let k = 0; k < W; k++) e += d[i + k] ** 2; env.push(Math.sqrt(e / W)); }
    const mi = env.indexOf(Math.max(...env)), m = env[mi]; let dip = false, second = 0;
    for (let i = mi + 1; i < env.length; i++) { if (env[i] < 0.25 * m) dip = true; if (dip && env[i] > second) second = env[i]; }
    peaks.push(second / m);
  }
  const worst = Math.max(...peaks), bad = worst > 0.45;
  if (bad) warn++;
  console.log(`${bad ? 'WARN' : 'ok  '} step:${s.padEnd(8)} second hit ${(worst * 100).toFixed(0)}% of the first${bad ? '  <-- two hits per step: sounds like a gallop' : ''}`);
}
await b.close();
if (walkSteps.length) {
  const seq = walkSteps.map(([t, s]) => [t, 'step', { surface: s }]);
  execFileSync('node', ['tools/listen.mjs', `${out}/walk.wav`, JSON.stringify(seq), String(walkSteps.at(-1)[0] + 0.8)], { env: { ...process.env, GAME_URL: base }, stdio: 'inherit' });
  console.log(`listen: afplay ${out}/walk.wav   (look at ${out}/walk.png: evenly spaced single blobs)`);
}
process.exit(warn ? 1 : 0);
