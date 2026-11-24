// Render sounds to a WAV (and a waveform + spectrogram PNG) so a human can listen without playing,
// and the agent can at least SEE the shape (attacks, two-contact steps, tails).
//   node tools/listen.mjs out.wav '[[0,"step",{"surface":"snow"}],[0.35,"step",{"surface":"snow"}]]' [secs]
//   node tools/listen.mjs out.wav walk        # preset: 6 steps on each step surface
//   node tools/listen.mjs out.wav walk:snow,rail   # 6 steps on each listed surface
import { chromium } from 'playwright-core';
import fs from 'fs';
import { baseUrl } from './base.mjs';
const pos = process.argv.slice(2).filter((a, i, A) => a !== '--url' && A[i - 1] !== '--url');
const [out = 'listen.wav', spec = 'walk', secsArg] = pos;
const base = baseUrl();
let seq, secs = +secsArg || 0;
if (spec.startsWith('walk')) { seq = []; let t = 0.1; for (const s of (spec.split(':')[1] || 'snow,wood,ballast,sleeper,floor').split(',')) { for (let i = 0; i < 6; i++) { seq.push([t, 'step', { surface: s, side: i % 2 ? 1 : -1 }]); t += 0.35; } t += 0.6; } secs = secs || t + 0.5; }
else { seq = JSON.parse(spec); secs = secs || Math.max(...seq.map((x) => x[0])) + 2; }
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1600, height: 500 } });
await p.goto(base + '?shot=1&q=test');
await p.waitForFunction(() => typeof window.__audioRender === 'function', null, { timeout: 120000 });
const d = await p.evaluate(([s, n]) => window.__audioRender(s, n), [seq, secs]);
// 16-bit WAV
const sr = 44100, buf = Buffer.alloc(44 + d.length * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + d.length * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(d.length * 2, 40);
for (let i = 0; i < d.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(d[i] * 32767))), 44 + i * 2);
fs.writeFileSync(out, buf);
// picture: waveform (top) + log-frequency spectrogram (bottom), drawn in the page
await p.setContent('<canvas id=c width=1600 height=500></canvas>');
await p.evaluate((d) => {
  const c = document.getElementById('c'), g = c.getContext('2d'), W = 1600, sr = 44100; g.fillStyle = '#111'; g.fillRect(0, 0, W, 500);
  g.strokeStyle = '#8cf'; g.beginPath(); const per = d.length / W;
  for (let x = 0; x < W; x++) { let mn = 0, mx = 0; for (let i = Math.floor(x * per); i < (x + 1) * per; i++) { mn = Math.min(mn, d[i]); mx = Math.max(mx, d[i]); } g.moveTo(x, 75 - mx * 70); g.lineTo(x, 75 - mn * 70); } g.stroke();
  const N = 1024, H = 340, top = 155;
  for (let x = 0; x < W; x++) {
    const i0 = Math.floor(x * per); const re = new Float32Array(N), im = new Float32Array(N);
    for (let i = 0; i < N; i++) re[i] = (d[i0 + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    for (let size = 2, j = 0, i = 1; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } }
    for (let size = 2; size <= N; size <<= 1) { const h = size >> 1, a = -2 * Math.PI / size; for (let s = 0; s < N; s += size) for (let k = 0; k < h; k++) { const cr = Math.cos(a * k), ci = Math.sin(a * k), r = re[s + k + h] * cr - im[s + k + h] * ci, q = re[s + k + h] * ci + im[s + k + h] * cr; re[s + k + h] = re[s + k] - r; im[s + k + h] = im[s + k] - q; re[s + k] += r; im[s + k] += q; } }
    for (let y = 0; y < H; y++) { const f = 40 * Math.pow(16000 / 40, 1 - y / H), bin = Math.min(N / 2 - 1, Math.round(f / sr * N)); const m = Math.hypot(re[bin], im[bin]) / (N / 4); const db = 20 * Math.log10(m + 1e-9); const v = Math.max(0, Math.min(1, (db + 90) / 70)); g.fillStyle = `rgb(${v * 255 | 0},${v * v * 200 | 0},${v * v * v * 120 | 0})`; g.fillRect(x, top + y, 1, 1); }
  }
  g.fillStyle = '#aaa'; g.font = '12px monospace'; for (const f of [100, 500, 1000, 4000, 10000]) { const y = top + H * (1 - Math.log(f / 40) / Math.log(16000 / 40)); g.fillText(f + ' Hz', 4, y); }
}, d);
await p.screenshot({ path: out.replace(/\.wav$/, '.png') });
await b.close();
console.log(`wrote ${out} (${secs.toFixed(1)} s) and ${out.replace(/\.wav$/, '.png')}`);
