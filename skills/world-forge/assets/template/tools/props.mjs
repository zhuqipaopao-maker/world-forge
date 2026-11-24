// Prop audit: every registered prop alone, from 4 angles (+ a 'top' close-up for props taller than 2.4 m), one sheet per prop.
// The level sheet is too far away to show a part on the wrong side, a floating slat, a missing back,
// a stretched texture. In the test demo the user found a mirrored bench frame that 9 sheets had missed.
//   node tools/props.mjs <outDir> [--only bench,hut] [--url http://localhost:8740/]
// Then LOOK at every <outDir>/<prop>/_sheet.png and ask for each: does every part touch what holds it up?
// is anything on the wrong side? are the edges bevelled? does the material read at 1 m (no stripes, no moire)?
import { chromium } from 'playwright-core';
import { execFileSync } from 'child_process';
import fs from 'fs';
import { baseUrl } from './base.mjs';
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'shots/props';
const base = baseUrl();
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage();
await p.goto(base + '?show=props&shot=1&q=test');
await p.waitForFunction(() => (window.__ready && window.__frames > 2) || window.__fatal, null, { timeout: 120000 });
let names = await p.evaluate(() => window.__G.props.names());
const tall = new Set(await p.evaluate((ns) => ns.filter((n) => { const g = window.__G.props.build(n); return new window.__G.THREE.Box3().setFromObject(g).getSize(new window.__G.THREE.Vector3()).y > 2.4; }), names));
await b.close();
const only = opt('--only', ''); if (only) names = names.filter((n) => only.split(',').includes(n));
const VIEWS = { front: 'az=35&el=15', back: 'az=215&el=20', end: 'az=90&el=5', close: 'az=-30&el=25&zoom=0.45' };
for (const n of names) {
  const views = { ...VIEWS, ...(tall.has(n) ? { top: 'az=35&el=5&zoom=0.7&focus=top' } : {}) };
  const shots = Object.entries(views).map(([v, q]) => `${v}=show=props&shot=1&prop=${encodeURIComponent(n)}&${q}`);
  try { execFileSync('node', ['tools/shot.mjs', `${out}/${n}`, ...shots, '--url', base, '--size', '1000x700', '--sheet'], { stdio: ['ignore', 'pipe', 'pipe'] }); console.log(`ok   ${n.padEnd(16)} ${out}/${n}/_sheet.png`); }
  catch (e) { console.log(`FAIL ${n}: ${String(e.stderr || e.message).slice(0, 300)}`); }
}
