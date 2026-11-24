// Offline ambience bed for promo reels: synthesised in a headless page with an OfflineAudioContext, written as a 16-bit stereo WAV.
// usage: node tools/ambience.mjs <out.wav> <spec.json>
// spec: { dur, layers: [{ type, from, to, gain, fade?, muffle? }] }
// types: wind, snowhiss, rain, drops, room, crackle, tick, hum, traffic, drip, tunnel
import { chromium } from 'playwright-core';
import fs from 'fs';
const [out, specFile] = process.argv.slice(2); const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio'] });
const p = await b.newPage(); await p.goto('about:blank');
const res = await p.evaluate(async (spec) => {
  const sr = 44100, ac = new OfflineAudioContext(2, Math.ceil(sr * spec.dur), sr);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const nb = ac.createBuffer(1, sr * 4, sr); { const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }
  const brown = ac.createBuffer(1, sr * 4, sr); { const d = brown.getChannelData(0); let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (rnd() * 2 - 1)) / 1.02; d[i] = l * 3.5; } }
  const noise = (buf = nb) => { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = rnd() * 3; return s; };
  const filt = (type, f, q = 0.7) => { const x = ac.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
  const env = (g, L) => { const f = L.fade ?? 0.8, a = L.from, z = L.to, k = L.gain ?? 1; g.gain.setValueAtTime(0, 0); g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(k, a + f); g.gain.setValueAtTime(k, Math.max(a + f, z - f)); g.gain.linearRampToValueAtTime(0, z); };
  const lfo = (g, a, z, lo, hi, rate) => { const n = Math.max(2, Math.ceil((z - a) * rate * 4)), c = new Float32Array(n); let v = (lo + hi) / 2; for (let i = 0; i < n; i++) { v += (rnd() - 0.5) * (hi - lo) * 0.5; v = Math.min(hi, Math.max(lo, v)); c[i] = v; } g.gain.setValueCurveAtTime(c, a, z - a); };
  const out = ac.destination;
  for (const L of spec.layers) {
    const g = ac.createGain(); env(g, L); let dst = g; if (L.muffle) { const m = filt('lowpass', 500); g.connect(m); m.connect(out); } else g.connect(out);
    const pan = (v) => { const pn = ac.createStereoPanner(); pn.pan.value = v; return pn; };
    if (L.type === 'wind') for (const pv of [-0.6, 0.6]) { const s = noise(), bp = filt('bandpass', 380 + rnd() * 200, 0.6), lp = filt('lowpass', 900), m = ac.createGain(), pn = pan(pv); lfo(m, L.from, L.to, 0.25, 1.2, 0.15); s.connect(bp).connect(lp).connect(m).connect(pn).connect(dst); s.start(L.from); s.stop(L.to);
      const r = noise(brown), rl = filt('lowpass', 140), rg = ac.createGain(); rg.gain.value = 0.5; r.connect(rl).connect(rg).connect(pn); r.start(L.from); r.stop(L.to); }
    if (L.type === 'snowhiss') for (const pv of [-0.8, 0.8]) { const s = noise(), hp = filt('highpass', 5000), m = ac.createGain(); m.gain.value = 0.12; s.connect(hp).connect(m).connect(pan(pv)).connect(dst); s.start(L.from); s.stop(L.to); }
    if (L.type === 'rain') for (const pv of [-0.7, 0.7]) { const s = noise(), bp = filt('bandpass', 2600, 0.4), m = ac.createGain(); m.gain.value = 0.5; s.connect(bp).connect(m).connect(pan(pv)).connect(dst); s.start(L.from); s.stop(L.to); const s2 = noise(), lp = filt('lowpass', 700), m2 = ac.createGain(); m2.gain.value = 0.35; s2.connect(lp).connect(m2).connect(pan(pv)).connect(dst); s2.start(L.from); s2.stop(L.to); }
    if (L.type === 'drops' || L.type === 'crackle' || L.type === 'drip') { const rate = L.type === 'drops' ? 22 : L.type === 'crackle' ? 6 : 0.9, fq = L.type === 'drops' ? 3500 : L.type === 'crackle' ? 1800 : 1200;
      for (let t = L.from; t < L.to; t += -Math.log(1 - rnd()) / rate) { const s = noise(), bp = filt('bandpass', fq * (0.6 + rnd() * 0.8), L.type === 'drip' ? 8 : 2), m = ac.createGain(), d = L.type === 'drip' ? 0.09 : 0.012 + rnd() * 0.03, a = (0.3 + rnd() * 0.7);
        m.gain.setValueAtTime(0, t); m.gain.linearRampToValueAtTime(a, t + 0.002); m.gain.exponentialRampToValueAtTime(0.001, t + d); s.connect(bp).connect(m).connect(pan(rnd() * 1.6 - 0.8)).connect(dst); s.start(t); s.stop(t + d + 0.02); } }
    if (L.type === 'tick') for (let t = L.from + 0.3; t < L.to; t += 1) { const s = noise(), bp = filt('bandpass', 3200, 6), m = ac.createGain(); m.gain.setValueAtTime(0, t); m.gain.linearRampToValueAtTime(0.5, t + 0.001); m.gain.exponentialRampToValueAtTime(0.001, t + 0.03); s.connect(bp).connect(m).connect(pan(0.3)).connect(dst); s.start(t); s.stop(t + 0.05); }
    if (L.type === 'room') { const s = noise(brown), lp = filt('lowpass', 220), m = ac.createGain(); m.gain.value = 0.6; s.connect(lp).connect(m).connect(dst); s.start(L.from); s.stop(L.to); }
    if (L.type === 'hum') for (const [f, a] of [[50, 0.35], [100, 0.2], [150, 0.06], [1000, 0.012]]) { const o = ac.createOscillator(); o.frequency.value = f; const m = ac.createGain(); m.gain.value = a; o.connect(m).connect(dst); o.start(L.from); o.stop(L.to); }
    if (L.type === 'tunnel') { const s = noise(brown), lp = filt('lowpass', 90), m = ac.createGain(); lfo(m, L.from, L.to, 0.5, 1.3, 0.1); s.connect(lp).connect(m).connect(dst); s.start(L.from); s.stop(L.to); }
    if (L.type === 'traffic') { for (let t = L.from + rnd() * 3; t < L.to - 4; t += 5 + rnd() * 7) { const s = noise(), lp = filt('lowpass', 500 + rnd() * 400), m = ac.createGain(), pk = 0.4 + rnd() * 0.6, dd = 3 + rnd() * 3, pn = ac.createStereoPanner();
        pn.pan.setValueAtTime(rnd() < 0.5 ? -0.8 : 0.8, t); pn.pan.linearRampToValueAtTime(-pn.pan.value, t + dd); m.gain.setValueAtTime(0.0001, t); m.gain.exponentialRampToValueAtTime(pk, t + dd * 0.5); m.gain.exponentialRampToValueAtTime(0.0001, t + dd); s.connect(lp).connect(m).connect(pn).connect(dst); s.start(t); s.stop(t + dd + 0.1); } }
  }
  const buf = await ac.startRendering(); const enc = (ch) => { const d = buf.getChannelData(ch), i16 = new Int16Array(d.length); for (let i = 0; i < d.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(d[i] * 32767))); let s = ''; const u8 = new Uint8Array(i16.buffer); for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  return { L: enc(0), R: enc(1), n: buf.length };
}, spec);
await b.close();
const L = Buffer.from(res.L, 'base64'), R = Buffer.from(res.R, 'base64'), n = res.n, buf = Buffer.alloc(44 + n * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(44100, 24); buf.writeUInt32LE(44100 * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
for (let i = 0; i < n; i++) { L.copy(buf, 44 + i * 4, i * 2, i * 2 + 2); R.copy(buf, 46 + i * 4, i * 2, i * 2 + 2); }
fs.writeFileSync(out, buf); console.log(`wrote ${out} (${(n / 44100).toFixed(1)} s)`);
