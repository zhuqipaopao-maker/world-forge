// Motion check: render a deterministic frame sequence and make a video + a filmstrip you can look at.
//   node tools/clip.mjs <outDir> "<query>" [--frames 48] [--fps 24] [--size 1280x720] [--q medium] [--url U]
// Example: node tools/clip.mjs shots/clip_walk "show=figure" --frames 36
// Writes <outDir>/clip.mp4 (if ffmpeg exists), <outDir>/strip.png (8 frames in a row: read THIS to judge
// motion: does it move, is it smooth, does it pop?), and the frame PNGs.
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { baseUrl } from './base.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const base = opt('--url', '') || baseUrl(), frames = +opt('--frames', '48'), fps = +opt('--fps', '24'), q = opt('--q', 'medium');   // medium: ~2x faster than high; motion, not looks, is what a clip checks
const [W, H] = opt('--size', '1280x720').split('x').map(Number);
const [outDir, query = ''] = args;
if (!outDir) { console.log('usage: node tools/clip.mjs <outDir> "<query>" [--frames N] [--fps N] [--size WxH]'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(base + '?clip=1&' + (/(^|&)q=/.test(query) ? '' : `q=${q}&`) + query.replace(/^\?/, ''));
await page.waitForFunction(() => (window.__ready && window.__frames > 3) || window.__fatal, null, { timeout: 120000 });
await page.evaluate((dt) => window.__advance(2, dt), 1 / fps);   // settle: cloth/particles initialise, shadows render
const files = [];
for (let i = 0; i < frames; i++) {
  await page.evaluate((dt) => window.__advance(1, dt), 1 / fps);
  const f = path.join(outDir, `f${String(i).padStart(3, '0')}.png`); await page.screenshot({ path: f }); files.push(f);
}
const errors = await page.evaluate(() => window.__errors.slice(0, 5));
// filmstrip: 8 evenly spaced frames
const pick = Array.from({ length: 8 }, (_, k) => files[Math.round((k * (files.length - 1)) / 7)]);
const sp = await browser.newPage({ viewport: { width: 8 * 320, height: Math.round(320 * H / W) + 20 } });
await sp.setContent(`<style>body{margin:0;display:flex;background:#111}figure{margin:0}img{width:320px;display:block}figcaption{font:11px monospace;color:#ccc;padding:2px 4px}</style>` +
  pick.map((f) => `<figure><img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}"><figcaption>${path.basename(f)}</figcaption></figure>`).join(''));
await sp.waitForTimeout(200); await sp.screenshot({ path: path.join(outDir, 'strip.png'), fullPage: true });
await browser.close();
try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(outDir, 'f%03d.png'), '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', path.join(outDir, 'clip.mp4')]); console.log('video  ' + path.join(outDir, 'clip.mp4')); } catch { console.log('(no ffmpeg: frames only)'); }
console.log('strip  ' + path.join(outDir, 'strip.png') + `  (${frames} frames @ ${fps} fps)`);
for (const e of [...errs, ...errors]) console.log('     error: ' + String(e).slice(0, 240));
