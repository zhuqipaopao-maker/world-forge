---
name: world-forge
description: Build a small, high-fidelity 3D browser game or explorable world (Three.js, one self-contained HTML file, every model, texture and sound generated in code) by working for a long stretch on your own. You check your own progress with a screenshot-and-error harness instead of waiting for human feedback. It reproduces the working method behind "Saltline" (a browser game built by Claude from a short prompt): AAA-looking quality from code alone. Independent community skill; works in any coding agent that can run shell commands and look at images. Use this skill whenever the user wants to make a 3D game, a playable scene, a "world", a walking simulator, an FPS/horror/exploration level, or a web game "with really high quality", "like Saltline" or "AAA-looking", even if they do not name Three.js. This includes Chinese requests such as 做一个3D游戏, 做一个新世界, 画质要很高, 做一个3D场景. Also use it when the user asks to raise an existing Three.js scene to that quality bar.
---

# World Forge

Make a small 3D world that looks and feels finished. Most of the quality does not come from clever code. It comes from **three habits**:

1. **Decide the look before building.** Write a one-page brief and put the art bible in code (`src/art.js`) before anything else.
2. **Build the eyes first.** Write the harness before the content, so you can load any view the same way every time, take a screenshot, and read back errors and frame times.
3. **Loop on the worst visible flaw.** Shoot fixed views, find the single worst thing against the quality bar, fix it, shoot again. Repeat for hours.

Saltline was made from a short prompt ("insanely detailed quality, small scope, a tiny level") with an empty CLAUDE.md, in about 8 hours. The quality came from the model's own harness and its review loop. This skill gives you that harness ready-made, **plus a tested parts library** (see `references/library.md`), so the time goes into the world, not into plumbing:
- an HDR renderer: tone map and grade, height fog that glows toward the sun, AO, an environment map from the sky, a light pool;
- 13 GPU-baked materials with shared wetness, snow, macro variation and sparkle;
- procedural trees and forests;
- terrain;
- creatures with code animation and hanging cloth;
- rain and snow lit by lamps, light cones;
- synthesised sounds;
- a GLB loader for the rare hero model.

Read `references/library.md` before you write your own version of any of these.

## Which agent you are running in
This skill is plain files and shell commands, so any coding agent can follow it. It needs three things:
1. **Shell access on the user's machine**: npm, a background dev server, and the system Google Chrome (the tools drive it headless through playwright-core). In Codex, run with full access (or approve network and process launches), otherwise `npm install` and Chrome are blocked by the sandbox.
2. **File access**: if your agent does not load skills by itself, the user can tell it to read this file first.
3. **Eyes**: the whole method is shoot → look → fix. If your model cannot read images (DeepSeek and other text-only models), do not guess: configure `tools/critic.mjs` with a vision API and work from its written verdicts plus the luma numbers from `shot.mjs`.
Where this file says "subagent", use your agent's equivalent, or `tools/critic.mjs`. Long background processes: start the dev server with `nohup … & disown` so it survives between commands.

## When the user starts

Get only what you cannot choose yourself, then go:
- **The world in one sentence** (place, who you are, what you do). If they give only a mood ("a scary night village"), make the rest of the choices yourself, boldly and specifically.
- **The time budget** (1–2 h for a slice, 6–8 h for a full small game) and whether they want 2–3 short check-ins or a single long autonomous run (`references/review-process.md` §3). Long runs use a lot of quota, so tell them that.
- **What the budget buys (tell the user before they choose).** Measured on the same calibrated scale (Saltline 7-7.5): 1-hour tests scored 4.5; runs of 2-3 hours of loops scored 5-6; the metro station, after about 6 hours and ~25 blind A/B rounds on ONE scene, reached 6.5. Saltline was about 8 uninterrupted hours on one scene. So with a limited quota, spend it on **one scene, polished for a long time**, not on several new scenes: in run 5 the budget went into three new scenes (fuel station, rooftop test) and none got past 5. A new scene starts at 4-5 again however good the parts library is.
- **Size the scene to the budget, and count the review views (run 7).** Factory 712 (a 300 m valley, 5 POIs, two interiors, a climbable tower, 10 review views, ~8 h over two sessions) sat at 4.5-6 (mostly 5) for 24 blind calibrations while almost every A/B picked the newer build: each view got less than an hour, so every step was small and none moved the absolute score. Rule: at most about one review view per hour of budget, ONE hero space per 6-8 h run (the 60-80 m of "small and dense"), everything else backdrop. Push back on extra POIs in the brief; the user said afterwards "这个场景是不是也太大".
- **What fills the frame sets the ceiling (run 7).** Code + this renderer sells hard surfaces: wet asphalt, concrete, rust, steel, lamps, interiors (Saltline, night-metro 6.5-7). Vegetation is the weakest part: in runs 6 and 7 frames that were 50-70% forest, grass and trees stayed at 4-5, and "card-like trees, repeated grass" was named in every critic round. Before the user picks a nature-heavy world, say so, and offer: (a) frame it so buildings/interiors fill the frame and nature is edge and backdrop, or (b) budget photo-sourced foliage (photo atlases, `library.md` §3) from the first hour. The user's verdict on run 7: "是不是我们的skill不适合做很多自然景观".
- **Pick light the tools can sell.** Dawn haze with a 4-8° sun looked moody but every critic called it "flat, hazy, sepia" next to Saltline's backlit wet contrast, and a sun that low cannot reach into interiors (no shafts through roof holes). Prefer a strong key with wet reflections (rain/after rain with a visible sun, dusk backlight) or practicals at night; if the brief wants mist, keep it in the distance and keep the near ground high-contrast.
- **The location** of the project folder (default: `./<slug>` in the current workspace).

Do not ask about the palette, the materials, the controls or the code structure. These are your decisions, and the brief records them.

## Workflow

### 0. Set up (about 5 minutes)
```bash
cp -R ~/.claude/skills/world-forge/assets/template <project> && cd <project>
npm install            # three, esbuild, playwright-core (uses the system Chrome)
git init -q && (git config user.name >/dev/null || git config user.name "world-forge") \
  && (git config user.email >/dev/null || git config user.email "world-forge@localhost") \
  && git add -A && git commit -qm "world-forge template"
nohup npm run dev -- 8740 > dev.log 2>&1 & disown   # any free port; a plain `&` job gets killed (exit 143) between agent tool calls
# dev.mjs writes .devport and every tool reads it, so the tools never shoot another project's server (or pass --url / GAME_URL)
node tools/shot.mjs shots/000 start=shot=1\&view=start mats=show=mats props=show=props --sheet
date "+start %H:%M" >> PROGRESS.md      # the clock you will budget against
```
Look at `shots/000/_sheet.png`. If it shows a lit scene with no errors, the harness works. If it does not, fix that first, because nothing else can be judged without it.

### 1. Brief (15 minutes)
Write `BRIEF.md` from `references/brief-template.md`. Then put its art bible into `src/art.js` (sun, sky, fog, palette, scale, grade). Every module reads colours and light from there. Write the first-view description carefully: it becomes the `start` view, the title screen and the main thing you judge.

### 2. Build in this order, and screenshot after every step
The order goes from what affects every pixel to what affects a few.

| # | Step | Done when the screenshots show… | Read |
|---|------|----------------------------------|------|
| 1 | **Light + sky + post**: tune `art.js` (sun, sky, fog, GRADE, WEATHER) on grey blockout boxes | a strong value structure and a light direction in `start`, even with no textures; luma numbers in range | library §2; upgrade-path; other-worlds §4 for night |
| 2 | **Material library**: reuse the 13 built-ins, add paint variants and 2–6 world-specific recipes | `?show=mats` (and `&wet=1` / `&snow=1`), with close-ups via `&cam=`: every material reads as its real thing | library §1; render-and-materials §4 |
| 3 | **Hero props** (3–6, real sizes, bevels, grime, labels), **vegetation** (`lib/vegetation.js`) and **creatures** (`lib/figure.js`, or a model for close-up heroes) | `node tools/props.mjs shots/props_NN`: every prop's 4-view sheet (front, back, end-on, close) read one by one — every part touches what holds it up, nothing on the wrong side, no stripes or moire at 1 m; `?show=trees`, `?show=figure`: trees have a ragged silhouette; creature motion checked with `clip.mjs` | props-modeling; library §3, §5; external-models |
| 4 | **Level layout as data** + named views + cinematicPath | `overview` reads as a place with lanes, cover and a landmark; `start` matches the brief | level-ground-backdrop §1 |
| 5 | **Ground / terrain** (`lib/terrain.js`: flatten, paths, berms; wetness or snow) + **backdrop** (distant forest at detail 0.4, skyline) | the horizon has scale; the ground holds up at head height; nothing floats | library §4; level-ground-backdrop §2–4; other-worlds §2–3 |
| 6 | **Weather + FX**: `WEATHER`, `fx.setLamps`, `lampCone`, layered bursts | the air is full in outdoor shots; flakes or drops glow in lamp light; effects are layered | library §6; fx-weather |
| 7 | **Player + feel** | `node tools/feel.mjs` all `ok` (cadence, even rhythm, bob 2–7 cm); moving frames show accel and landing | audio-feel-ai-flow §2 |
| 8 | **Gameplay**: objectives, threats, win/lose | a scripted playthrough reaches the win state with no errors | audio-feel-ai-flow §3–4 |
| 9 | **Audio** (all synthesised, add recipes to `RECIPES`) | every event has a sound; `audiocheck.mjs` all `ok`; `feel.mjs` all `ok` (no two-hit steps); `listen.mjs` spectrogram checked; then ask the user to listen | library §7; audio-feel-ai-flow §1 |
| 10 | **Title, HUD, flow, settings** | the title over the live cinematic; pause; end screen | audio-feel-ai-flow §4 |
| 11 | **Polish passes**: loop on the quality bar | each pass fixes the worst flaw in the sheet | quality-bar |
| 12 | **Performance + tiers**, then `npm run build` | `bench.mjs` p99 within budget; `dist/index.html` runs offline | render-and-materials §5 |

Commit after every step (`git commit -qm "step 3: hero props"`). This lets you roll back a bad experiment in seconds.

### 3. The review loop (most of the time goes here)
```bash
node tools/shot.mjs shots/012 start=shot=1\&view=start cover=shot=1\&view=cover \
  overview=shot=1\&view=overview props=show=props fx=show=fx\&t=3 --sheet
```
1. Read the console part of the output first. Any `FAIL`, `error:` or `FATAL` line comes before looks. Then read the `luma` line of each view: a `TOO DARK`, `NO HIGHLIGHTS` or `FLAT` warning is a real flaw even when the image "looks moody" to you. The target (Saltline gameplay) is mean ≈ 0.29 and p95 ≈ 0.69. Night worlds still need mean ≥ 0.12 and p95 ≥ 0.5 (see other-worlds §4).
2. Open `_sheet.png` (one image, all views). Compare it with the previous sheet, and now and then with the target: `assets/reference/*.jpg` (sheets from finished world-forge runs with their blind scores; the quality to reach, not the content to copy).
3. Write the critique in `PROGRESS.md` in three lines: the views, the worst flaw (with its quality-bar §), the fix and the expected visible change.
4. Make that one fix, and shoot the same views again. If the change does not show in the image, find out why before you continue.
Put the review shot list in a script on day one (`tools/sheet.sh`: the same 8–10 views every time, including one **inside** every interior and one **close** to the nearest foliage), so sheets compare one to one.
For close looks, shoot a single view at full size (`--size 1920x1080`) and read that PNG. For a single prop, add a temporary view or use `cam=x,y,z,lx,ly,lz`.
For anything that moves (creatures, cloth, wind, effects, the player's walk), run `node tools/clip.mjs shots/clip_x "<query>"` and read `strip.png`, because stills cannot show motion.

**Independent critic.** Every 30–45 minutes, and before hand-over, have a fresh critic review the sheet against the reference: a subagent if your agent has them (a smaller, cheaper model is fine), otherwise `node tools/critic.mjs` (a separate process or a vision API; required when your own model cannot read images). It sees only the pictures and the bar, so it is not kind to your work the way you are. Its 3 gaps go to the top of the work queue. The prompt template is in `references/review-process.md` §2.
`?shot=1` renders at `high` quality, so the shots show what the player sees. Add `&q=test` only for quick smoke checks.

**The stop rule: the score, not the clock.** The user's words after test run 4: "Don't stop early and hand me something that isn't good enough. Only stop when the score is really high." So:
- **Target:** the independent critic (review-process.md §2, the calibrated scale: 7 = a high-end AAA screenshot, 8 = beyond it, 10 = a photo) scores the final sheet **≥ 8/10 on two blind A/B reviews in a row** (or the user's own target, written in BRIEF.md). That is the only reason to hand over on your own. Always run the blind A/B progress check too: an anchored critic can repeat the same score while the work improves (run 4: 5/10 eight times).
- **The time budget is a planning estimate, not a stop.** When it runs out below the target, send the user ONE status line (score, the next 3 work items, the time used) and keep working. Stop below the target only when the user says so.
- **Before you even think of stopping, run `date` and read PROGRESS.md:** all four test runs stopped early "with every check green" (47/90, 70/90, 92/120 and ~70/180 minutes). Green checks, a full feature list or a used-up critic budget are not reasons.
- **Looks before features.** Once the game loop works (step 8), every further hour goes to what the critic and the quality bar name, not to new set pieces. Run 4 spent its time on a CCTV gag and a ghost train while the critic said "flat light, too clean" four times.
- Between reviews, work down the last critic's list and your own worst-view list; judge with the numbers and side-by-side sheets. If one flaw resists 3 attempts, try a different technique (library §2 light bake, aging pass) rather than polishing around it.
- Run the full re-check chain (build, clicktest, playthrough, bench) at each critic review, not after every change: between changes the sheet is enough.

### 4. Hand-over
**Shoot one view at `q=low` early in the run, not only at the end.** In run 6 the low and test tiers drew a black frame for hours (every review shot used `high`) until the photo playthrough came out black.

`npm run build` makes one self-contained `dist/index.html` (committed; only `dist/game.js` is ignored). Then run `node tools/clicktest.mjs`: it opens the built file with no parameters, clicks the title like a player and presses W. It must print `ok`. All other checks skip the title screen, so in the first test run an invisible layer blocked the first click and the game could not be started at all, even though every screenshot passed. Shoot the final sheet, run `props.mjs` and read every prop sheet, run `feel.mjs`, `bench.mjs` at `high` and at `low`, `audiocheck.mjs`, and have the critic review the final sheet. **The checks see what you point them at.** In the test demo the user found four faults that every sheet and number had passed: a mirrored bench frame, footsteps at 8 per second, heel+toe double hits ("像在骑马"), one sound for a whole railway track. `props.mjs` and `feel.mjs` exist for exactly these. Then tell the user, plainly:
- what was built, and where;
- which views you are proud of and which are still weak;
- the bench numbers;
- that you cannot hear audio, so they need to listen and give feedback (give them the `listen.mjs` WAV too);
- how to play (`open dist/index.html`, or the dev URL).

## The harness (already in the template)

URL parameters, implemented in `src/main.js`:

| Parameter | Effect |
|---|---|
| `?show=<module>` | the module's `showcase()` alone (`mats`, `props`, `level`, `fx`, …); add yours to `SHOWCASE` |
| `?view=<name>` | camera pinned to `level.views[name]` |
| `?cam=x,y,z,lx,ly,lz` | camera pinned anywhere |
| `?shot=1` | skip the title/intro, `high` quality (add `&q=test` for quick smoke checks), no audio |
| `?clip=1` | manual time: the page advances only on `window.__advance(n, dt)` (used by `clip.mjs`) |
| `?show=trees` / `?show=figure` | the vegetation and creature showcases (`&snow=1`, `&night=1`) |
| `?t=<s>` | fast-forward the simulation before the first frame (fills rain, settles particles) |
| `?dt=<s>` | fixed time step (deterministic) |
| `?seed=<n>` | world seed |
| `?q=<tier>` | `test`, `low`, `medium`, `high` or `ultra` |
| `#bench` / `?bench=1` | flies the `cinematicPath` and reports frame times |

Window hooks: `__ready`, `__frames`, `__fatal`, `__errors[]`, `__stats()`, `__G` (the whole context), `__setShot({cam,fov,exposure})`, `__bench`.

Tools:
- `tools/shot.mjs <outDir> name=query… [--sheet] [--size WxH] [--wait ms] [--url U]`: screenshots, the error log, and brightness numbers (luma mean/p5/p50/p95 with a warning for too dark, no highlights, flat or washed out). It exits 1 if any view fails.
- `tools/clicktest.mjs [url]`: starts the built game as a player does (click on the title, then W) and checks that the state goes `title` → `playing` and the player moves.
- `tools/clip.mjs <outDir> "<query>" [--frames 48] [--fps 24]`: a deterministic frame sequence turned into `strip.png` (8 frames to read) and `clip.mp4`.
- `tools/audiocheck.mjs`: renders every synthesised sound offline and reports length, peak, RMS and clipping.
- `tools/props.mjs <outDir> [--only a,b]`: every registered prop alone (`?show=props&prop=NAME&az=&el=&zoom=`) from front, back, end-on and close; one sheet per prop. Builders face +z.
- `tools/feel.mjs [outDir]`: walks, sprints and crouches the player; reports cadence, rhythm evenness, head bob and speed; flags step sounds with two hits; renders the real walk to `walk.wav`.
- `tools/listen.mjs <out.wav> walk|<json>`: renders sounds to a WAV for the user to hear, plus a waveform and spectrogram PNG for you to look at.
- `tools/bench.mjs [--q high] [--secs 20]`: average, median and p99 frame times. Headless timing is only a rough guide, so confirm big decisions in a real browser.
- `tools/critic.mjs score|ab|cal <images…>`: the independent critic as a separate process or a vision API (blind labels, scores un-shuffled, log in `shots/critic.log`). See review-process.md §2 for the backends.
- `npm run dev` / `npm run build`.

Write scripted checks for gameplay too: a small Playwright script that drives `window.__G` (teleports the player, triggers objectives) and checks that the game reaches `won` and `lost` with no errors. The first test run did this in `tools/playthrough.mjs`, and it is the only way to verify a full playthrough without a human.

Module contract: each module exports `create(ctx)` and returns an object with `update(dt)`. A visual module also exports `showcase(ctx)`, which returns `{cam, target, update?}`. If `create` throws, boot logs the error and swaps in the stub from `core/stubs.js`, so one broken system never hides the state of the others. Keep each stub's API the same as the real module's.

## When the critic plateaus on vegetation or surfaces
Code-drawn textures have a ceiling. In run 6 eight calibrations stayed at 4-5 while geometry, lighting and density changed; replacing the drawn leaf, needle and tree textures with keyed PHOTO atlases (n4d images on white, `library.md`) changed the look more than any code change of the night. If a critic keeps naming the same material ('toon foliage', 'painted', 'stylized') after two technique changes, generate a photo source for it.

**Generated hero models vs style unity (run 7).** Four n4d office props (desk, filing cabinet, chair, washstand) won a blind A/B against plain code boxes (5.5 vs 5), but the user, shown a side-by-side, preferred the code set ("I want the overall style to stay unified"). The code furniture was then rebuilt properly (pedestal desk with drawers, pulls, kneehole and glass top; slatted chair; filing cabinet with drawer fronts; built in local frames with `bevelBox`) and won its own A/B. Before generating models, ask whether the user values one-hand style over the extra realism, and always show a side-by-side before committing; keep a `?param` switch so both stay comparable.

## Principles that explain the numbers

- **Old and used by default.** Real places are dirtier than you think. In runs 4 and 5 the user said "it looks a bit too new" and "you keep making scenes too clean… nothing in real life is this new", and every critic said "new build". Put age in from the first pass: stains under everything that drips, cracks and patches, rust streaks, moss and leaves in corners, faded paint, litter, things left behind. Push it further than feels natural, then check every view: would a real place this old look this clean?

- **Small and dense beats big and empty.** A 60–80 m play area, one landmark, 3–6 hero props reused with variation.
- **Everything is a function.** Textures, models and sounds are made in code from seeds. The game is deterministic, versionable and tiny, and its style stays consistent because one hand makes everything.
- **HDR in, tone map late.** Emissives at 4–30×, the sun disc at about 100×. Bloom is a small mix (about 5–10%), not a glow over everything.
- **Physical units everywhere.** Metres for UVs, real prop sizes, bump strength in metres. Scale errors are the fastest way to look fake.
- **Same data drives looks and gameplay.** The puddle mask drives the shader, the splash particles and the footstep sounds. The interior boxes drive the rain, the reverb and the wetness.
- **Fallbacks, not crashes.** Unknown material: loud magenta plus a log line. A failed prop: a box of the correct size. A failed shader: forward rendering. A failed module: its stub. The run must survive its own bugs.
- **Never add or remove lights at runtime** (it recompiles every shader). Use a fixed pool and fade the intensities.

## Long-run discipline
- **Never put a `//` comment in the middle of a line you insert by script.** It silently comments out the rest of the line (test runs 3 and 4 lost a sound, a closing brace and a whole build to this, five times). Put comments on their own line or at the very end.
- Keep `PROGRESS.md`: the current step, the last critique, the next action, and the known problems. After context compaction, read it first.
- Commit at every green sheet. Before a risky change (a shader patch, a pipeline rewrite), commit, so you can `git checkout .` if it fails.
- Time-box each polish item. If a fix takes 3 tries without a visible change, write it down as a known problem and move to the next-worst flaw.
- Keep the template's harness intact. If you restructure modules, keep the URL parameters and window hooks working, because they are how you see.
- **Seed every random that shapes a texture or a placement.** In run 7 the decal canvases (stains, streaks, mould) used `Math.random`, so every load of the same build looked different and blind A/Bs "saw" changes in walls nobody had touched, for hours. Use a seeded PRNG everywhere; check by shooting the same view twice (mean pixel difference should be ~1-2/255, the volumetric noise).
- **Give each new feature its own RNG.** Adding calls to a shared `rnd()` shifts every later random choice: in run 7 a laundry sheet moved in front of the corridor review camera and a sapling into the workshop foreground. `const r = rng(<new seed>)` per feature keeps the rest of the world where it was.
- **The machine is part of the run.** Run 7's 16 GB Mac kernel-panicked at 04:19 (watchdog; memory compressor full, 34 swapfiles, the disk at 99%) and lost ~4.5 h. Check `df -h /` before a long run and warn the user under ~20 GB free; run one headless Chrome at a time; delete shots after reading them; ask the user to quit heavy apps for the night.
- **Name the gap you are about to fix by checking the frame.** Before tuning, `pick` what is under the pixel (`tools/pick.mjs` in run 7: raycast from a screen point; prints object, material, instance count). It found in minutes that a "black window" was a boarded pane seen from inside, that pale "puffs" on a slope were the slope trees' translucency, and that the dark workshop was missing bounce light rather than sky light.

## References (read the one for the current step)
- `references/library.md`: **the template's tested parts** (materials, renderer, trees, terrain, creatures, weather, audio, models, tools) and how to call them. Read it at step 0.
- `references/review-process.md`: self-review, the independent critic prompt, and user checkpoints.
- `references/external-models.md`: when a hero needs a Tripo or n4d model, and how to bring it in so it matches the procedural style.
- `references/upgrade-path.md`: how to grow the template's renderer step by step toward the Saltline image (env map from the sky, height fog, shadows, light pool, AO, reflections, volumetrics, exposure, grade, shader patches).
- `references/other-worlds.md`: vegetation, terrain, snow and ice, night and low light, interiors, creatures and vehicles, water. Read it whenever the world is not an industrial daytime or dusk site.
- `references/brief-template.md`: the brief you write first.
- `references/quality-bar.md`: the screenshot checklist and the critique format. Read it before the first review loop.
- `references/render-and-materials.md`: post chain, sky, volumetrics, soft shadows, auto-exposure, grade, GPU texture generation, material patching, wetness, quality tiers, AABB physics and A* navigation.
- `references/props-modeling.md`: builder contract, kit plus merge, bevels, swept profiles, vertex-colour AO and grime, decals and stencil text, deformation, caching.
- `references/level-ground-backdrop.md`: layout authoring, cover and spawns, invisible walls, the backdrop beyond the play area, the wet-ground gradient, planar reflections, the sea, rain integration.
- `references/fx-weather.md`: particle pools, stateless GPU rain, layered flashes and impacts, soft lit smoke, decals, light pulses.
- `references/audio-feel-ai-flow.md`: synthesised sounds and the mix, movement, recoil and springs, enemy AI with telegraphs and attack tokens, HUD and game flow.

Several references describe techniques and numbers measured in Saltline (a rainy port FPS). Take the techniques and the size of its numbers, not its content. Do not copy its code (it has no licence), and do not rebuild its look for a different world: a snowy forest needs its own art bible.
