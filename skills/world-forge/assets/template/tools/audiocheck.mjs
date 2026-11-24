// Sound check without ears: renders every recipe in src/modules/audio.js offline and prints
// length, peak and RMS level (dBFS) and clipped samples. Rules of thumb:
//   peak between -12 and -1 dBFS · no clipped samples · one-shots < 2 s · footsteps < 0.3 s ·
//   loud events (shots, impacts) RMS around -20 dBFS, quiet ones (steps, UI) -35..-28.
// Then ASK THE USER TO LISTEN: numbers cannot tell you whether it sounds good.
//   node tools/audiocheck.mjs [--url http://localhost:8740/]
import { chromium } from 'playwright-core';
import fs from 'fs';
import { baseUrl } from './base.mjs';
const args = process.argv.slice(2), i = args.indexOf('--url'), base = baseUrl();
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const p = await b.newPage();
await p.goto(base + '?shot=1&q=test');
await p.waitForFunction(() => typeof window.__audioReport === 'function', null, { timeout: 120000 });
const rows = await p.evaluate(() => window.__audioReport());
let bad = 0;
for (const r of rows) {
  if (r.error) { console.log(`FAIL ${r.name}: ${r.error}`); bad++; continue; }
  const warn = r.clipped_samples ? 'CLIPS' : r.peak_dBFS > -1 ? 'too hot' : r.peak_dBFS < -30 ? 'too quiet' : r.length_s > 9 && !/train|horn|drone|amb/.test(r.name) ? 'long tail' : '';   // pass-bys and swells are long on purpose
  if (warn) bad++;
  console.log(`${warn ? 'WARN' : 'ok  '} ${r.name.padEnd(12)} len ${String(r.length_s).padStart(6)} s  peak ${String(r.peak_dBFS).padStart(6)} dBFS  rms ${String(r.rms_dBFS).padStart(6)} dBFS${warn ? '  <-- ' + warn : ''}`);
}
await b.close();
process.exit(bad ? 1 : 0);
