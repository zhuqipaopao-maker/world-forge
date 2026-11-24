// Performance check: flies the level's cinematicPath (#bench) and reports frame times.
//   node tools/bench.mjs [--q high] [--secs 20] [--url http://localhost:8740/] [--size 1600x900]
// Default size 1600x900 = the size Saltline's numbers in quality-bar.md were taken at (compare like with like).
// Prints avg / median / p99 ms. Budget: p99 under ~25 ms on the target machine at 'high'.
import { chromium } from 'playwright-core';
import fs from 'fs';
import { baseUrl } from './base.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const base = baseUrl(), q = opt('--q', 'high'), secs = +opt('--secs', '20');
const [W, H] = opt('--size', '1600x900').split('x').map(Number);
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--mute-audio', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(`${base}?bench=1&q=${q}${opt('--extra', '')}`);   // --extra '&flag=1': A/B a feature your code reads from ctx.params
await page.waitForFunction(() => window.__ready || window.__fatal, null, { timeout: 120000 });
await page.waitForTimeout(secs * 1000);
const r = await page.evaluate(() => ({ bench: window.__bench, errors: window.__errors, fatal: window.__fatal }));
if (!r.bench) console.error('WARN bench did not finish (window.__bench unset): raise --secs');
console.log(JSON.stringify(r, null, 1));
console.error('note: headless timing is indicative only; confirm on the real browser before trusting small differences.');   // stderr: stdout stays pure JSON
await browser.close();
