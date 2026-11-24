// Screenshot + health check. The agent's eyes.
//   node tools/shot.mjs <outDir> name=query [name=query ...] [--url http://localhost:8740/] [--size 1600x900] [--wait 1500] [--sheet]
// Each shot: loads the page with ?query, waits for window.__ready (+ frames), waits --wait ms,
// saves <outDir>/<name>.png, prints stats + every console error / page error.
// --sheet also writes <outDir>/_sheet.png: all shots in one labelled grid (look at ONE image).
// Exit code 1 if any shot had a fatal error or JS errors, so loops can stop on breakage.
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { baseUrl } from './base.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
const base = opt('--url', '') || baseUrl();   // opt() also removes --url from the shot list
const [W, H] = opt('--size', '1600x900').split('x').map(Number);
const WAIT = +opt('--wait', '1500');
const sheet = flag('--sheet');
const [outDir, ...shots] = args;
if (!outDir || !shots.length) { console.log('usage: node tools/shot.mjs <outDir> name=query ... [--url U] [--size WxH] [--wait ms] [--sheet]'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

// Brightness numbers (sRGB luma 0..1) so "too dark / flat / washed out" is caught even when the eye adapts.
// Calibration — Saltline at high (dusk, rain): gameplay views mean ~0.29, p5 ~0.11, p95 ~0.69.
// A first test run of a snowy-night world measured mean 0.04–0.14, p95 0.07–0.27: it read as murky, not as night.
async function luminance(page, png) {
  const r = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = 160; c.height = 90; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 160, 90);
    const d = g.getImageData(0, 0, 160, 90).data, L = [];
    for (let i = 0; i < d.length; i += 4) L.push((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255);
    L.sort((a, b) => a - b); const q = (p) => +L[Math.floor(p * (L.length - 1))].toFixed(3);
    return { mean: +(L.reduce((a, b) => a + b, 0) / L.length).toFixed(3), p5: q(0.05), p50: q(0.5), p95: q(0.95) };
  }, png.toString('base64'));
  r.warn = r.mean < 0.12 ? 'TOO DARK: most of the frame is near black (raise exposure / ambient / fill, or brighten the sky)'
    : r.p95 < 0.4 ? 'NO HIGHLIGHTS: nothing bright in frame (sky gap, lamps, emissives, specular)'
    : r.p95 - r.p5 < 0.3 ? 'FLAT: low contrast (fog too thick or lighting too even)'
    : r.p5 > 0.3 ? 'WASHED OUT: no true darks' : '';
  return r;
}

const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: CHROME, headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
let bad = 0; const done = [];
for (const s of shots) {
  const i = s.indexOf('='), name = i < 0 ? s : s.slice(0, i), q = i < 0 ? '' : s.slice(i + 1);
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const logs = [];
  page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning' || /^\[[a-z0-9_-]+\]/i.test(m.text())) logs.push(`[${t}] ${m.text().slice(0, 400)}`); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message.slice(0, 400)));
  const t0 = Date.now();
  await page.goto(base + (q ? (q.startsWith('#') ? q : '?' + q) : ''));
  let timeout = false;
  try { await page.waitForFunction(() => (window.__ready && window.__frames > 30) || window.__fatal, null, { timeout: 120000 }); } catch { timeout = true; }
  await page.waitForTimeout(WAIT);
  const st = await page.evaluate(() => ({ fatal: window.__fatal, errors: (window.__errors || []).slice(0, 10), stats: window.__stats ? window.__stats() : null, frames: window.__frames }));
  const file = path.join(outDir, name + '.png');
  const png = await page.screenshot({ path: file });
  const lum = await luminance(page, png);
  const broken = timeout || st.fatal || st.errors.length;
  if (broken) bad++;
  console.log(`${broken ? 'FAIL' : 'ok  '} ${name}  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${JSON.stringify(st.stats)}${timeout ? '  TIMEOUT(no __ready)' : ''}${st.fatal ? '\n     FATAL ' + st.fatal : ''}`);
  if (logs.some((l) => /status of 503/.test(l))) console.log('     BUILD FAILED? the dev server answered 503: the bundle did not build. Read dev.log (esbuild error with file:line).');
  console.log(`     luma mean ${lum.mean} p5 ${lum.p5} p50 ${lum.p50} p95 ${lum.p95}${lum.warn ? '  <-- ' + lum.warn : ''}`);
  // compact: first line + first GLSL 'ERROR:' line of each message, duplicates counted once
  const squash = (t) => { const L = String(t).split('\n'); const g = L.find((x) => /ERROR: \d/.test(x)); return (L[0] + (g ? ' | ' + g.trim() : '')).slice(0, 260); };
  const seen = new Map();
  for (const t of [...st.errors.map((e) => 'error: ' + squash(e)), ...logs.map(squash)]) seen.set(t, (seen.get(t) || 0) + 1);
  [...seen].slice(0, 14).forEach(([t, n]) => console.log('     ' + t + (n > 1 ? `  (x${n})` : '')));
  done.push({ name, file: path.resolve(file) });
  await page.close();
}
if (sheet && done.length) {
  const cols = Math.ceil(Math.sqrt(done.length)), cw = 800, ch = Math.round(cw * H / W);
  const page = await browser.newPage({ viewport: { width: cols * cw, height: Math.ceil(done.length / cols) * (ch + 22) } });
  const imgs = done.map((d) => `<figure><img src="data:image/png;base64,${fs.readFileSync(d.file).toString('base64')}"><figcaption>${d.name}</figcaption></figure>`).join('');
  await page.setContent(`<style>body{margin:0;display:grid;grid-template-columns:repeat(${cols},${cw}px);background:#111}figure{margin:0}img{width:${cw}px;height:${ch}px;display:block}figcaption{font:13px monospace;color:#ddd;padding:3px 6px;height:16px}</style>${imgs}`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, '_sheet.png'), fullPage: true });
  console.log('sheet  ' + path.join(outDir, '_sheet.png'));
}
await browser.close();
process.exit(bad ? 1 : 0);
