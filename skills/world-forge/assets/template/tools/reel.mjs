// Promo reel: render shots from src/reel_shots.js frame by frame (manual time, so a heavy scene still plays smooth) and
// encode each to H.264. No HUD, no people. usage: node tools/reel.mjs <outDir> [shot ...] [--fps 30] [--size 1920x1080]
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { SHOTS, ORDER } from '../src/reel_shots.js';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const base = opt('--url', process.env.GAME_URL || 'http://localhost:8740/'), fps = +opt('--fps', '30'), [W, H] = opt('--size', '1920x1080').split('x').map(Number), q = opt('--q', 'high');
const [outDir, ...names] = args; const list = names.length ? names : ORDER; fs.mkdirSync(outDir, { recursive: true });
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
for (const name of list) {
  const S = SHOTS[name]; if (!S) { console.log('FAIL unknown shot ' + name); continue; }
  const t0 = Date.now(), fdir = path.join(outDir, name + '_f'); fs.rmSync(fdir, { recursive: true, force: true }); fs.mkdirSync(fdir);
  const page = await browser.newPage({ viewport: { width: W, height: H } }); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${base}?clip=1&shot=1&q=${q}&reel=${name}&${S.q}`);
  await page.waitForFunction(() => (window.__ready && window.__frames > 3) || window.__fatal, null, { timeout: 240000 });
  await page.addStyleTag({ content: 'body > div:not(#app), #hud, #title, #end, #pause, #boot, .toast { display: none !important; }' });
  await page.evaluate(() => { window.__advance(1, 0); });
  const n = Math.round(S.dur * fps);
  for (let i = 0; i < n; i++) { await page.evaluate((dt) => window.__advance(1, dt), 1 / fps); await page.screenshot({ path: path.join(fdir, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 94 }); }
  const errors = await page.evaluate(() => window.__errors.slice(0, 3)); await page.close();
  const out = path.join(outDir, name + '.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(fdir, 'f%04d.jpg'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', out]);
  fs.rmSync(fdir, { recursive: true, force: true });
  console.log(`ok   ${name.padEnd(10)} ${n} frames  ${((Date.now() - t0) / 1000).toFixed(0)} s  -> ${out}`); for (const e of [...errs, ...errors]) console.log('     error: ' + String(e).slice(0, 200));
}
await browser.close();
