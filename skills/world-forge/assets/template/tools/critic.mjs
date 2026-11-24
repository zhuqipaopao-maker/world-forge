#!/usr/bin/env node
// Independent critic: a fresh model looks at review sheets and scores them blind.
// Use it when your agent has no subagents, or when your own model cannot read images (e.g. DeepSeek).
//
//   node tools/critic.mjs score <sheet> [more views…] [--goal "photographic realism"] [--world "one sentence"]
//   node tools/critic.mjs ab <older> <newer> [--goal …]        blind A/B, labels shuffled, scores un-shuffled for you
//   node tools/critic.mjs cal <sheet> [--ref <reference>]      blind calibration against a finished world-forge sheet
//
// Backends (first one configured wins):
//   CRITIC_CLI=claude          runs `claude -p` (Claude Code) as a separate process; CRITIC_MODEL defaults to sonnet
//   CRITIC_CLI=codex           runs `codex exec -i …` (Codex CLI) as a separate process
//   CRITIC_API_KEY=…           any OpenAI-compatible vision endpoint: CRITIC_BASE_URL (default https://api.openai.com/v1)
//                              + CRITIC_MODEL (e.g. qwen-vl-max, glm-4v-plus, gpt-5.x, moonshot-v1-…-vision)
//   CRITIC_PROVIDER=anthropic  with CRITIC_API_KEY: the Anthropic Messages API (CRITIC_MODEL e.g. claude-sonnet-5-5)
// CRITIC_DRY=1 prints the prompt and the images instead of calling anything.
// Every verdict is appended to shots/critic.log with the label key.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const mode = argv.shift();
const opt = {}, files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
  else files.push(argv[i]);
}
const usage = () => { console.error('usage: critic.mjs score|ab|cal <images…> [--goal ..] [--world ..] [--ref ..]'); process.exit(2); };
if (!['score', 'ab', 'cal'].includes(mode) || !files.length) usage();
for (const f of files) if (!fs.existsSync(f)) { console.error('missing image: ' + f); process.exit(2); }

const goal = opt.goal || 'photographic realism';
const world = opt.world || readBriefLine();
const SCALE = 'Score 1-10 on this scale: 10 = indistinguishable from a real photo, 8 = beyond a high-end AAA screenshot (only a trained eye can tell), 7 = a high-end AAA game screenshot, 5 = a decent indie game, 3 = a prototype.';
const AGE = 'Also judge AGE AND USE: does this look like a place used daily for 10+ years, or like a new build?';

function readBriefLine() {
  try {
    const b = fs.readFileSync('BRIEF.md', 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    return b[0] ? b[0].slice(0, 300) : '';
  } catch { return ''; }
}

function findRef() {
  if (opt.ref) return opt.ref;
  const cands = [path.join(HERE, '../../reference/street-sheet.jpg'), path.join(os.homedir(), '.claude/skills/world-forge/assets/reference/street-sheet.jpg'),
    path.join(os.homedir(), '.codex/skills/world-forge/assets/reference/street-sheet.jpg'), path.join(os.homedir(), '.agents/skills/world-forge/assets/reference/street-sheet.jpg')];
  const hit = cands.find(f => fs.existsSync(f));
  if (!hit) { console.error('no reference sheet found: pass --ref <path to assets/reference/street-sheet.jpg>'); process.exit(2); }
  return hit;
}

// ---- build the job: images (with neutral labels) + prompt ----
let images = [], prompt = '', key = {};
if (mode === 'score') {
  images = files.map((f, i) => ({ label: 'IMAGE ' + (i + 1), file: f }));
  prompt = `You are an art director. Look at the attached images: a review sheet of views from one 3D game world${files.length > 1 ? ' and some full-size views' : ''}.
${world ? 'The world is meant to be: ' + world + '\n' : ''}Goal: ${goal}. Compare with real photographs of such places.
1. The 3 biggest gaps, most important first: which view, what you see, why it breaks the illusion, one concrete fix.
2. One thing that already works and must not be lost.
3. ${SCALE}
${AGE}
Only describe what you actually see. Under 250 words. No praise beyond item 2.
End with one line exactly: SCORE: <n>`;
} else {
  const pair = mode === 'ab' ? [['older', files[0]], ['newer', files[1] || usage()]] : [['ours', files[0]], ['reference', findRef()]];
  const flip = crypto.randomInt(2) === 1;
  const order = flip ? [pair[1], pair[0]] : pair;
  const L = mode === 'ab' ? ['X', 'Y'] : ['P', 'Q'];
  images = order.map(([who, f], i) => ({ label: L[i], file: f, who }));
  key = Object.fromEntries(images.map(im => [im.label, im.who]));
  prompt = `You are an art director. Two review sheets of 3D game views are attached, labelled ${L[0]} (first image) and ${L[1]} (second image). They may show different worlds.
Goal: ${goal}. Judge craft (light, materials, geometry, age and use, atmosphere), not content.
1. Which is more convincing, and by how much (none / small / clear / large)?
2. The 3 differences that decide it (say which sheet each detail is in; only describe what you actually see).
3. The 3 changes that would most raise the weaker one.
4. ${SCALE} Score each sheet.
${AGE}
Under 300 words. End with one line exactly: SCORES: ${L[0]}=<n> ${L[1]}=<n> MARGIN=<none|small|clear|large>`;
}

// copy to neutral names so no file name leaks which is which
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'critic-'));
for (const im of images) {
  const ext = path.extname(im.file).toLowerCase() || '.png';
  im.blind = path.join(tmp, im.label.replace(/\s+/g, '_') + ext);
  fs.copyFileSync(im.file, im.blind);
  shrink(im);
}

function shrink(im) {
  // most APIs cap image bytes (~5 MB) and edge length; downscale big sheets to 2400 px wide when a tool is available
  if (fs.statSync(im.blind).size < 3.5e6) return;
  const out = im.blind.replace(/\.\w+$/, '.jpg');
  const tries = [['sips', ['-Z', '2400', '-s', 'format', 'jpeg', im.blind, '--out', out]], ['magick', [im.blind, '-resize', '2400x2400>', '-quality', '85', out]],
    ['ffmpeg', ['-y', '-loglevel', 'error', '-i', im.blind, '-vf', 'scale=2400:-2', '-q:v', '3', out]]];
  for (const [cmd, args] of tries) {
    const r = spawnSync(cmd, args, { stdio: 'ignore' });
    if (r.status === 0 && fs.existsSync(out)) { im.blind = out; return; }
  }
  console.error(`warning: ${im.file} is ${(fs.statSync(im.blind).size / 1e6).toFixed(1)} MB and no resizer (sips/magick/ffmpeg) was found; the API may reject it`);
}

const mime = f => (/\.jpe?g$/i.test(f) ? 'image/jpeg' : /\.webp$/i.test(f) ? 'image/webp' : 'image/png');
const b64 = f => fs.readFileSync(f).toString('base64');

async function run() {
  const env = process.env;
  if (env.CRITIC_DRY) return 'DRY RUN\n' + images.map(i => `${i.label}: ${i.file}`).join('\n') + '\n\n' + prompt;
  if (env.CRITIC_CLI === 'claude') {
    const list = images.map(i => `${i.label}: ${i.blind}`).join('\n');
    const p = `Read these image files first:\n${list}\n\n${prompt}`;
    return execFileSync('claude', ['-p', p, '--model', env.CRITIC_MODEL || 'sonnet', '--allowedTools', 'Read'], { encoding: 'utf8', maxBuffer: 1 << 24, cwd: tmp });
  }
  if (env.CRITIC_CLI === 'codex') {
    const last = path.join(tmp, 'last.txt');
    const args = ['exec', '--skip-git-repo-check', '--output-last-message', last];
    if (env.CRITIC_MODEL) args.push('-m', env.CRITIC_MODEL);
    for (const i of images) args.push('-i', i.blind);
    args.push(prompt);
    execFileSync('codex', args, { encoding: 'utf8', maxBuffer: 1 << 24, cwd: tmp, stdio: ['ignore', 'pipe', 'inherit'] });
    return fs.readFileSync(last, 'utf8');
  }
  if (!env.CRITIC_API_KEY) {
    console.error('No critic backend configured. Set CRITIC_CLI=claude|codex, or CRITIC_API_KEY (+ CRITIC_BASE_URL, CRITIC_MODEL) for a vision API.');
    process.exit(2);
  }
  if (env.CRITIC_PROVIDER === 'anthropic') {
    const content = [];
    for (const i of images) content.push({ type: 'text', text: i.label + ':' }, { type: 'image', source: { type: 'base64', media_type: mime(i.blind), data: b64(i.blind) } });
    content.push({ type: 'text', text: prompt });
    const r = await post((env.CRITIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages',
      { 'x-api-key': env.CRITIC_API_KEY, 'anthropic-version': '2023-06-01' },
      { model: env.CRITIC_MODEL || 'claude-sonnet-5-5', max_tokens: 1500, messages: [{ role: 'user', content }] });
    return (r.content || []).map(c => c.text || '').join('');
  }
  if (!env.CRITIC_MODEL) { console.error('Set CRITIC_MODEL to a vision model name for your endpoint.'); process.exit(2); }
  const content = [];
  for (const i of images) content.push({ type: 'text', text: i.label + ':' }, { type: 'image_url', image_url: { url: `data:${mime(i.blind)};base64,${b64(i.blind)}` } });
  content.push({ type: 'text', text: prompt });
  const base = (env.CRITIC_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const r = await post(base + '/chat/completions', { authorization: 'Bearer ' + env.CRITIC_API_KEY },
    { model: env.CRITIC_MODEL, messages: [{ role: 'user', content }], max_tokens: 1500 });
  const m = r.choices?.[0]?.message?.content;
  return Array.isArray(m) ? m.map(c => c.text || '').join('') : (m || '');
}

async function post(url, headers, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const txt = await res.text();
  if (!res.ok) { console.error(`critic API error ${res.status}: ${txt.slice(0, 500)}`); process.exit(1); }
  return JSON.parse(txt);
}

const text = (await run()).trim();
console.log(text);
if (process.env.CRITIC_DRY) { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0); }

// un-shuffle
let summary = '';
if (mode === 'score') {
  const m = text.match(/SCORE:\s*([\d.]+)/i);
  summary = m ? `score ${m[1]}` : 'score not found';
} else {
  const [l0, l1] = images.map(i => i.label);
  const m = text.match(new RegExp(`SCORES:\\s*(${l0})\\s*=\\s*([\\d.]+)\\s+(${l1})\\s*=\\s*([\\d.]+)(?:\\s+MARGIN\\s*=\\s*(\\w+))?`, 'i'));
  if (m) {
    const s = { [m[1].toUpperCase()]: m[2], [m[3].toUpperCase()]: m[4] };
    summary = Object.entries(key).map(([lab, who]) => `${who} ${s[lab] ?? '?'}`).join(', ') + (m[5] ? ` (margin ${m[5]})` : '');
  } else summary = 'scores not found';
}
const keyTxt = Object.entries(key).map(([l, w]) => `${l}=${w}`).join(' ');
console.log(`\n== ${mode}: ${summary}${keyTxt ? '   [key ' + keyTxt + ']' : ''}`);
try {
  fs.mkdirSync('shots', { recursive: true });
  fs.appendFileSync('shots/critic.log', `${new Date().toISOString()} ${mode} ${files.join(' ')} -> ${summary} ${keyTxt}\n`);
} catch {}
fs.rmSync(tmp, { recursive: true, force: true });
