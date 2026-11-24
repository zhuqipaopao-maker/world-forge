// Assemble the promo: the rendered shots (tools/reel.mjs) joined with 0.8 s dissolves, a fade in/out, an ambience bed
// (tools/ambience.mjs) and the game's own sound events (tools/listen.mjs) placed on the shot timeline.
// usage: node tools/promo.mjs <shotsDir> <outDir>
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { SHOTS, ORDER } from '../src/reel_shots.js';
const [dir, outDir, flag] = process.argv.slice(2); fs.mkdirSync(outDir, { recursive: true }); const reuse = flag === '--reuse';
const X = 0.8, start = {}, end = {}; let t = 0; for (const n of ORDER) { start[n] = t; end[n] = t + SHOTS[n].dur; t += SHOTS[n].dur - X; } const T = t + X;
console.log('timeline ' + T.toFixed(1) + ' s');
// ---- ambience bed: the station (tube hum, hall tone, drips, tunnel rumble), then the street (rain, drops on the canopy, traffic, the shop's hum)
const layers = [];
for (const n of ORDER) { const a = Math.max(0, start[n] - 0.4), z = Math.min(T, end[n] + 0.4);
  if (n.startsWith('m_')) { layers.push({ type: 'hum', from: a, to: z, gain: 0.07 }, { type: 'room', from: a, to: z, gain: 0.4 }, { type: 'drip', from: a, to: z, gain: 0.3 });
    if (n === 'm_track' || n === 'm_train') layers.push({ type: 'tunnel', from: a, to: z, gain: 0.55 }); }
  else { layers.push({ type: 'rain', from: a, to: z, gain: n === 's_out' ? 0.4 : 0.6 }, { type: 'drops', from: a, to: z, gain: n === 's_out' ? 0.55 : 0.35 });
    if (['s_street', 's_facade', 's_outro', 's_bus'].includes(n)) layers.push({ type: 'traffic', from: a, to: z, gain: 0.45 });
    if (n === 's_store') layers.push({ type: 'hum', from: a, to: z, gain: 0.05 }); } }
fs.writeFileSync(path.join(outDir, 'amb.json'), JSON.stringify({ dur: T, layers }));
execFileSync('node', ['tools/ambience.mjs', path.join(outDir, 'amb.wav'), path.join(outDir, 'amb.json')], { stdio: 'inherit' });
// ---- the game's own sounds on the same clock: the station chime, the train running in with its horn
const ev = [[start.m_board + 0.6, 'chime', {}], [start.m_train + 0.2, 'train', { gain: 1 }], [start.m_train + 1.4, 'horn', { gain: 0.6 }]];
execFileSync('node', ['tools/listen.mjs', path.join(outDir, 'ev.wav'), JSON.stringify(ev), String(T)], { stdio: 'inherit' });
// ---- picture: dissolves, fade from and to black
const ins = ORDER.flatMap((n) => ['-i', path.join(dir, n + '.mp4')]); let f = '', prev = '[0:v]', off = 0;
ORDER.slice(1).forEach((n, i) => { off += SHOTS[ORDER[i]].dur - X; const o = i === ORDER.length - 2 ? '[vx]' : `[v${i}]`; f += `${prev}[${i + 1}:v]xfade=transition=fade:duration=${X}:offset=${off.toFixed(3)}${o};`; prev = o; });
f += `[vx]fade=t=in:st=0:d=1.0,fade=t=out:st=${(T - 1.6).toFixed(2)}:d=1.6[v]`;
const silent = path.join(outDir, 'promo_silent.mp4');
if (!reuse || !fs.existsSync(silent)) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...ins, '-filter_complex', f, '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', '30', silent]);
// ---- mix: ambience + events, limited; mux
const mix = path.join(outDir, 'promo_ambience.wav');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(outDir, 'amb.wav'), '-i', path.join(outDir, 'ev.wav'), '-filter_complex', `[1]pan=stereo|c0=c0|c1=c0,volume=0.9[e];[0][e]amix=inputs=2:normalize=0,afade=t=in:d=1.0,afade=t=out:st=${(T - 2).toFixed(2)}:d=2,loudnorm=I=-21:TP=-2:LRA=11,aresample=44100[a]`, '-map', '[a]', '-t', T.toFixed(2), mix]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-i', mix, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', path.join(outDir, 'promo.mp4')]);
console.log('ok   ' + path.join(outDir, 'promo.mp4') + '  (+ promo_silent.mp4, promo_ambience.wav for your music)');
