// BOOT + SELF-CHECK HARNESS.
// The harness is what lets an agent work for hours without a human: it can load any
// view deterministically, screenshot it, and read errors and frame times back.
//
// URL parameters (all optional):
//   ?show=<module>     render one module's showcase() alone (props, mats, fx, ...)
//   ?cam=x,y,z,lx,ly,lz  pin the camera (position + look-at) — repeatable shots
//   ?view=<name>       pin the camera to one of level.views (named, reviewed every iteration)
//   ?shot=1            screenshot mode: skip title/intro, 'high' quality (override with ?q=), no audio
//   ?dt=0.016          fixed time step (deterministic animation)
//   ?t=12              fast-forward simulated time before the first frame (weather, day cycle)
//   ?seed=4207         world seed
//   ?q=low|medium|high|ultra|test   force a quality tier
//   ?noaudio=1  ?autostart=1  ?noweapon=1  ?fov=60  ?exposure=1.2
//   ?clip=1            manual time: the page only advances when window.__advance(n, dt) is called (tools/clip.mjs)
//   #bench             fly the level's cinematicPath and print frame-time stats
// Window hooks (read by tools/shot.mjs and tools/bench.mjs):
//   __ready  __frames  __fatal  __errors[]  __stats()  __G (the context)  __setShot({cam,fov,exposure})
import * as THREE from 'three';
import { makeRng, makeEvents } from './core/util.js';
import { pickQuality } from './core/quality.js';
import { STUBS, nullInput } from './core/stubs.js';
import * as render from './modules/render.js';
import * as mats from './modules/mats.js';
import * as props from './modules/props.js';
import './modules/props_world.js';   // registers the world's prop builders
import * as level from './modules/level.js';
import * as fx from './modules/fx.js';
import * as audio from './modules/audio.js';
import * as player from './modules/player.js';
import * as input from './modules/input.js';
import * as hud from './modules/hud.js';
import * as game from './modules/game.js';
import * as nature from './modules/nature.js';
import * as figures from './modules/figures.js';

// Modules that can be viewed alone with ?show=<name>. Add every new visual module here.
const SHOWCASE = { mats, props, level, fx, trees: nature, figure: figures };

window.__frames = 0; window.__ready = false; window.__fatal = null; window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push('unhandled: ' + String(e.reason && e.reason.stack || e.reason).slice(0, 400)));
{
  const orig = console.error.bind(console);
  console.error = (...a) => { try { window.__errors.push(a.map((x) => (x && x.stack) || String(x)).join(' ').slice(0, 400)); } catch {} orig(...a); };
}

const bootEl = document.getElementById('boot'), bootMsg = document.getElementById('boot-msg'), bootFill = document.getElementById('boot-fill');
async function progress(msg, f) {
  if (bootMsg) bootMsg.textContent = msg;
  if (bootFill) bootFill.style.width = Math.round(f * 100) + '%';
  await new Promise((r) => setTimeout(r, 0)); // let the page paint the bar
}
function fatal(msg) {
  window.__fatal = String(msg); console.error('[fatal] ' + msg);
  let el = document.getElementById('fatal');
  if (!el) { el = document.createElement('div'); el.id = 'fatal'; document.getElementById('app').appendChild(el); }
  el.textContent = 'Could not start: ' + msg;
}

window.__audioReport = () => audio.report();   // tools/audiocheck.mjs: measure every synthesised sound offline (needs no WebGL)
window.__audioRender = (seq, secs) => audio.renderSeq(seq, secs);   // tools/listen.mjs: render a sound sequence to a WAV

async function boot() {
  const params = Object.fromEntries(new URLSearchParams(location.search));
  const bench = !!params.bench || location.hash === '#bench';
  if (bench) params.bench = '1';
  if (bench || params.shot) { params.noaudio = '1'; params.autostart = '1'; }
  const showName = params.show && SHOWCASE[params.show] ? params.show : null;

  const ctx = {
    THREE, params, events: makeEvents(), rng: makeRng(+(params.seed || 4207)),
    time: { t: 0, dt: 0, frame: 0, real: 0 },
    quality: pickQuality(params.q || (params.shot ? 'high' : '')), // review at the quality the player sees; ?q=test for quick smoke shots
    showcase: showName,
  };
  window.__G = ctx;

  // Pinned camera for repeatable shots.
  let pinned = null;
  const setShot = (o) => {
    if (o.cam !== undefined) {
      if (o.cam === '' || o.cam === null) pinned = null;
      else { const v = String(o.cam).split(',').map(Number); pinned = { pos: new THREE.Vector3(v[0], v[1], v[2]), look: new THREE.Vector3(v[3] ?? 0, v[4] ?? 1, v[5] ?? 0) }; }
    }
    if (o.fov) { ctx.camera.fov = +o.fov; ctx.camera.updateProjectionMatrix(); }
    if (o.exposure) ctx.render.setExposure(+o.exposure);
  };
  window.__setShot = setShot;

  // Load one module; on failure fall back to its stub (unless it is required).
  async function load(name, fn, required = false) {
    const t0 = performance.now();
    try { ctx[name] = await fn(); }
    catch (e) {
      console.error(`[boot] module "${name}" failed: ${(e && e.stack) || e}`);
      if (required || !STUBS[name]) throw e;
      ctx[name] = STUBS[name]();
    }
    const ms = performance.now() - t0;
    if (ms > 150) console.log(`[boot] ${name} ${ms.toFixed(0)}ms`);
  }

  await progress('Waking the renderer', 0.05);
  await load('render', () => render.create(ctx), true);
  ctx.renderer = ctx.render.renderer; ctx.scene = ctx.render.scene; ctx.camera = ctx.render.camera;
  await progress('Mixing materials', 0.2);
  await load('mats', () => mats.create(ctx));
  await load('props', () => props.create(ctx));
  ctx.input = showName || bench || params.shot ? nullInput() : input.create(ctx);

  if (showName) {
    ctx.level = STUBS.level();
    await load('fx', () => fx.create(ctx));
    ctx.audio = STUBS.audio(); ctx.hud = STUBS.hud(); ctx.player = STUBS.player();
    ctx.game = { state: 'showcase', update: () => false, start() {} };
    let info = null;
    try { info = await SHOWCASE[showName].showcase(ctx); } catch (e) { fatal(`showcase "${showName}" threw: ${(e && e.stack) || e}`); }
    ctx.showcaseInfo = info || {};
    if (info && info.cam) setShot({ cam: [...info.cam, ...(info.target || [0, 1, 0])].join(',') });
  } else {
    await progress('Weather and effects', 0.3);
    await load('fx', () => fx.create(ctx));     // before level: the level registers lamps and light cones with fx
    await progress('Building the world', 0.4);
    ctx.level = { groundHeight: null, interiorBoxes: [] };   // placeholder: level.create may set ctx.level.groundHeight early so trees/props planted during create sit on the terrain
    await load('level', () => level.create(ctx), true);
    await load('audio', () => (params.noaudio ? STUBS.audio() : audio.create(ctx)));
    await load('player', () => player.create(ctx));
    await load('hud', () => hud.create(ctx));
    ctx.game = game.create(ctx);
  }

  await progress('Waiting for first light', 0.9);
  try { await ctx.render.onLevelReady?.(); } catch (e) { console.error('[boot] onLevelReady failed: ' + ((e && e.stack) || e)); }

  let avgDt = 0;
  window.__stats = () => ({ ...(ctx.render.stats ? ctx.render.stats() : {}), fps: avgDt ? +(1 / avgDt).toFixed(1) : 0, state: ctx.game && ctx.game.state, quality: ctx.quality.name });
  if (params.view && ctx.level?.views?.[params.view]) { const v = ctx.level.views[params.view]; setShot({ cam: [...v.cam, ...v.target].join(',') }); }
  if (params.cam) setShot(params);
  if (params.fov) setShot({ fov: params.fov });
  if (params.exposure) setShot({ exposure: params.exposure });
  if (!showName && (params.shot || params.autostart)) { try { ctx.game.start({ skipIntro: true }); } catch (e) { console.error('[boot] game.start failed', e); } }
  if (params.noweapon) ctx.player.setWeaponVisible?.(false);
  if (bench) startBench(ctx);
  if (showName || bench || params.shot) document.getElementById('title')?.classList.add('hidden');
  if (params.shot && !params.hud) { const st = document.createElement('style'); st.textContent = '#hud,#cam-ui{display:none!important}'; document.head.appendChild(st); }   // review shots: the picture, not the UI

  await progress('Ready', 1);
  bootEl?.classList.add('done'); setTimeout(() => { if (bootEl) bootEl.hidden = true; }, 700);

  // Fast-forward simulated time (e.g. let rain/particles fill the air before a screenshot).
  const warm = +(params.t || 0);
  const step = (dt) => tick(dt, true);

  // Each module update is isolated: one throwing module logs once and the rest keep running.
  const errs = {};
  const run = (name, dt) => {
    const m = ctx[name]; if (!m || !m.update) return;
    try { m.update(dt); } catch (e) { if (!errs[name]) { errs[name] = 1; console.error(`[loop] ${name}.update threw: ${(e && e.stack) || e}`); } }
  };
  function tick(dt, silent) {
    ctx.time.dt = dt; ctx.time.t += dt; ctx.time.frame++;
    run('input', dt);
    let playing = false;
    try { playing = ctx.game.update(dt) !== false && ctx.game.state !== 'title' && ctx.game.state !== 'paused'; }
    catch (e) { if (!errs.game) { errs.game = 1; console.error('[loop] game.update threw: ' + ((e && e.stack) || e)); } }
    if (showName) { try { ctx.showcaseInfo.update?.(dt); } catch (e) { if (!errs.sc) { errs.sc = 1; console.error('[loop] showcase update threw: ' + ((e && e.stack) || e)); } } }
    else if (playing) run('player', dt);
    if (pinned) { ctx.camera.position.copy(pinned.pos); ctx.camera.lookAt(pinned.look); }   // before fx/level: they read the camera (interiors, snow wrap, mist)
    if (ctx.game.state !== 'paused') { run('fx', dt); run('level', dt); run('props', dt); run('mats', dt); }
    run('audio', dt); run('hud', dt);
    if (pinned) { ctx.camera.position.copy(pinned.pos); ctx.camera.lookAt(pinned.look); }
    if (!silent) ctx.bench?.frame(dt);
  }
  for (let t = 0; t < warm; t += 1 / 30) step(1 / 30);
  // Manual time for motion clips: advance n ticks of dt, then render one frame.
  window.__advance = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) tick(dt, false); ctx.render.frame(dt); ctx.input.endFrame?.(); return ctx.time.t; };

  let last = performance.now();
  ctx.renderer.setAnimationLoop(() => {
    if (params.clip && window.__frames > 2) { window.__frames++; return; } // tools/clip.mjs drives time
    const now = performance.now(); const real = (now - last) / 1000; last = now;
    avgDt = avgDt ? avgDt * 0.95 + real * 0.05 : real;
    ctx.time.real = now / 1000;
    const dt = params.dt ? +params.dt : Math.min(real, 0.05);
    tick(dt, false);
    if (ctx.bench) ctx.bench.real(real);
    try { ctx.render.frame(dt); } catch (e) { if (!errs.render) { errs.render = 1; console.error('[loop] render.frame threw: ' + ((e && e.stack) || e)); } }
    ctx.events.emit('frame:rendered');   // the drawing buffer is still valid here (photo capture reads it)
    ctx.input.endFrame?.();
    window.__frames++; if (window.__frames === 2) window.__ready = true;
  });
}

// Bench: fly the cinematic path for 30 s, report avg / median / p99 frame time on screen and in __bench.
function startBench(ctx) {
  const pre = document.createElement('pre');
  pre.id = 'bench';
  pre.style.cssText = 'position:absolute;left:12px;top:12px;z-index:90;margin:0;padding:10px 12px;font:12px/1.45 ui-monospace,monospace;color:#d8f0d0;background:rgba(0,0,0,.72);white-space:pre-wrap;pointer-events:none';
  document.getElementById('app').appendChild(pre);
  const path = ctx.level.cinematicPath && ctx.level.cinematicPath.length >= 2 ? ctx.level.cinematicPath
    : [{ pos: [-20, 2, 10], look: [0, 1.5, 0] }, { pos: [20, 2, 10], look: [0, 1.5, 0] }];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), LA = new THREE.Vector3(), LB = new THREE.Vector3();
  const samples = []; let t = 0, lastReport = 0; const loop = 30;
  if (ctx.player) ctx.player.enabled = false;
  ctx.bench = {
    frame(dt) {
      t += dt;
      const p = ((t / loop) % 1) * (path.length - 1), i = Math.min(path.length - 2, Math.floor(p)), f = p - i, s = f * f * (3 - 2 * f);
      A.fromArray(path[i].pos); B.fromArray(path[i + 1].pos); LA.fromArray(path[i].look); LB.fromArray(path[i + 1].look);
      ctx.camera.position.lerpVectors(A, B, s); ctx.camera.lookAt(LA.lerp(LB, s));
    },
    real(dt) {
      if (t > 2) samples.push(dt * 1000); if (samples.length > 3000) samples.shift();
      if (t - lastReport > 1 && samples.length > 10) {
        lastReport = t;
        const x = samples.slice().sort((a, b) => a - b), avg = x.reduce((a, b) => a + b, 0) / x.length;
        const r = { t: +t.toFixed(0), avg: +avg.toFixed(2), median: +x[x.length >> 1].toFixed(2), p99: +x[Math.floor(x.length * 0.99)].toFixed(2), fps: Math.round(1000 / avg), quality: ctx.quality.name, stats: ctx.render.stats ? ctx.render.stats() : {}, errors: window.__errors.length };
        window.__bench = r;
        pre.textContent = `BENCH t=${r.t}s  quality ${r.quality}\nframe ms avg ${r.avg} median ${r.median} p99 ${r.p99} => ${r.fps} fps\nstats ${JSON.stringify(r.stats)}\nerrors ${r.errors}`;
      }
    },
  };
}

boot().catch((e) => fatal((e && e.stack) || e));
