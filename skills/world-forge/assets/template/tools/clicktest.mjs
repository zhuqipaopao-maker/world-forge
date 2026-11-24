// Start the game the way a PLAYER does: no URL parameters, wait, click the title, press W.
// Automated shots use ?shot=1 / autostart and skip the title, so only this test catches
// an invisible layer that swallows the first click, a title that never hides, dead input...
//   node tools/clicktest.mjs [url]   (default: file://<project>/dist/index.html — run after npm run build)
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
const url = process.argv[2] || 'file://' + path.resolve('dist/index.html');
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.goto(url);
await p.waitForFunction(() => (window.__ready && window.__frames > 30) || window.__fatal, null, { timeout: 120000 });
await p.waitForTimeout(1500);
const top = await p.evaluate(() => { const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return e ? `${e.tagName.toLowerCase()}#${e.id}` : null; });
const before = await p.evaluate(() => window.__G.game.state);
await p.mouse.click(800, 450); await p.waitForTimeout(800);
const after = await p.evaluate(() => window.__G.game.state);
const p0 = await p.evaluate(() => window.__G.player?.pos?.toArray?.() || null);
await p.keyboard.down('KeyW'); await p.waitForTimeout(1000); await p.keyboard.up('KeyW');
const p1 = await p.evaluate(() => window.__G.player?.pos?.toArray?.() || null);
const moved = p0 && p1 ? Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) : 0;
const errors = await p.evaluate(() => window.__errors.slice(0, 8));
const ok = before === 'title' && after === 'playing' && moved > 0.5 && !errors.length;
console.log(`${ok ? 'ok  ' : 'FAIL'} element at centre before click: ${top} | state ${before} -> ${after} | moved ${moved.toFixed(2)} m with W`);
for (const e of errors) console.log('     error: ' + e);
if (!ok && after !== 'playing') console.log('     The click did not start the game. Look for a full-screen element above the title (CSS display overriding [hidden], z-index).');
await b.close();
process.exit(ok ? 0 : 1);
