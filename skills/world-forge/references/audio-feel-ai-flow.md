# Case study: Procedural audio, game feel (movement, recoil, springs, bob), enemy AI, HUD and game flow, test harness

> What the Saltline game (Claude Fable 5.2, one autonomous run, Three.js, zero asset files) does in this area, with its numbers and the reasons it looks or feels good.
> Use it as a **technique catalogue and a quality bar**. Re-implement in your own code for your own world; change the numbers to fit your art bible. Short-form names like "Kit", "getShadow", "wave" are descriptive labels, not APIs to import.

---

## 1. Audio: everything is synthesised into AudioBuffers, then played through a small game-audio engine

### 1.1 Architecture
* **Two layers.** (a) Offline DSP "recipes" render Float32Arrays at boot or lazily; (b) a runtime mixer plays buffers and loops. Gameplay code never calls audio directly. It only `events.emit("weapon:fire" ...)`, and the audio module subscribes. Events used: weapon:fire/dry/reload{phase}/melee, shell:bounce, impact{point,surface,enemy,part,from,dir}, player:step/jump/land/hit/dead, enemy:spawn/alert/fire/step/telegraph/melee/killed, explosion, objective:done/all, extraction:reached, thunder, ui:click/hover, game:state. This decoupling is why audio could be tuned independently and stubbed (`?noaudio` gives a silent object with the same API,  and ).
* **Deterministic.** Each sound is generated with a seeded PRNG (mulberry32, ``) seeded from FNV hash of the name + variant*7919. Same sound every run, so an agent can compare renders.
* **Time-sliced generation.** Sounds flagged `boot:1` (rifle, tails, steps, dry fire) are built synchronously; the rest are queued and generated in `function*` generators that `yield` between DSP stages; a pump runs <=6 ms per tick every 12 ms. Demand for a not-yet-ready sound bumps it to the queue front. Sounds in a "late" set (thunder, explosion, death...) are dropped if they would play >2.5 s after the event. Cost is logged (`debug.genMs`).
* **Per-sound registry**: `{gen, n variants, sr, peak, bus, max voices, pri, ref, roll, loop, ir, boot}`. Sample rates are chosen per content: 44.1 kHz for transients (shots, impacts), 32 kHz for bodies/steps/enemies/music, 22.05 kHz for dark content (thunder, wind, sea, foghorn, ear ring). Every sound is peak-normalised to its own `peak` (0.12 for UI hover up to 0.97 for rifle/explosion) and gets 0.3 ms fade-in / 12 ms fade-out. Mixing level is therefore declared in the table, not in the recipes.

### 1.2 Bus and master chain
```
buses: world(1) near(.95) amb(.55) -> lowpass S (20 kHz, Q .5; "muffle" filter) -> gain z (pause duck)
       dry(1) ------------------------------------------------------------------> master A (bypasses muffle)
       music(.62) -> gain O (duck) -> A
A -> DynamicsCompressor (thr -10 dB, knee 6, ratio 6, atk 2 ms, rel 140 ms) -> gain .45
  -> WaveShaper soft clip (identity below .6, tanh knee above, 2x oversample) -> master volume (.9) -> destination
```
* Two **ConvolverNodes** with impulse responses synthesised in code: `ir_outdoor` and `ir_shed`. Sends: world .9, near .32 (guns stay dry/punchy), music .2 (into shed). Outdoor wet = `1-0.9*P`, shed wet = `P`, where P is the smoothed interior factor.
* **Voice pools**: 22 spatial (panner, "equalpower", inverse distance, refDistance 3, rolloff .6, maxDistance 400) for world, 12 non-spatial "near", 8 dry, 3 music. Allocation: if the same sound already has `max` voices, steal the oldest of that sound; else take a finished voice; else steal the lowest-priority voice with pri <= new pri. Stolen voice is faded over 4 ms and stopped at 25 ms.
* Variation: round-robin variant index with 30% chance to skip one (`n>2`), pitch jitter +-3.5% default, gain x(1-8%*rand). Per-event rate limits (impact 22 ms, shell 40 ms, alert 120 ms, ricochet 220 ms, ear-ring 1.8 s).

### 1.3 DSP primitives
`noise(sec)`, RBJ biquad `lp/hp/bp` (static or with a per-sample sweep function, coefficients refreshed every 32 samples), `expEnv(decay, attack)`, `sinSweep(f0->f1, expDecay)`, `modalBank([[freq, tau, amp]...])` (sum of exponentially decaying sines = struck metal/wood/glass), `chirp`, `burstNoise(sec, decay, {hp,lp,bp,q,att})` normalised to 1, `clicks(n, ...)` (random 1-4 ms noise grains, density-shaped), `mixAt(dst, src, t, gain)`, circular `mixAtWrap` for loops, `softclip tanh(x*k)/tanh(k)`, and `crossfadeLoop` (generate length+0.4 s, equal-power fade the tail into the head, ). Everything is vanilla JS loops over typed arrays.

### 1.4 Recipes with numbers
**Rifle shot** (`KR`, ; 0.32 s; 4 variants with pitch/size factors [1,.955,1.045,.985] and [1,1.12,.9,1.05]). Layered, each as `mixAt(time, gain)`:
1. 12 ms noise HP 2600 Hz, decay 1.1 ms, gain 2.6 (crack/transient).
2. 20 ms noise bp 1.2-8 kHz, gain 1.2 (+0.2 ms) (air).
3. Sine sweep 160->45 Hz, 110 ms, taus .024/.03, gain .62 (chest thump).
4. 220 ms noise HP 300 / LP 2500, decay 30 ms, gain 1.5 (blast body).
5. 90 ms band-pass 760 Hz Q2.2 (report), gain .9; 160 ms HP 4.8 kHz fizz, gain .34.
6. Bolt/action "clack" at +35 ms: modal bank [2150, 3420, 5230, 880 Hz] taus 4-12 ms, plus a second at +62 ms [1780, 2890, 640], plus low rattle 712/1466 Hz.
7. Whole thing `softclip(k=1.5)` after x.46.
The **tail is a separate sound**: `rifle_tail_out` = 5 discrete slap echoes at 58/97/139/176/262 ms (band-limited noise, HP 420 LP 4200->1300 falling) + two noise washes (LP 3400->380 swept, tau .3 and LP 150 tau .26); `rifle_tail_in` = five resonant room modes (noise bp 54/81/117/163/228 Hz at Q9) + 8 comb echoes at 44 ms spacing, 0.74 decay each, LP 3800/(1+.35u). Gameplay plays out/in tails crossfaded by P, triggered only if no tail played within 0.28 s, and also 0.1 s after the last shot of a burst. Result: full-auto sounds like a tight crack train with one coherent decay, not N stacked reverbs.

**Other one-shots** (all the same layered pattern):
* Dry-click `t8`: two modal pings (2840/4130/6320 Hz, 4 ms) + 930/1870 Hz at +16 ms.
* Mag out `n8` / mag in `i8` / bolt `s8`: 2-3 sequenced modal taps (3300/5100 Hz plate, 415/1140/2290/3470 Hz body) with a brief "slide" noise (`e_`: bandpass 1.7-3.4 kHz with stepped random amplitude at 190 Hz = rubbing sound) between them. Bolt: 230->105 Hz thud + 1310...7900 Hz modal ring at +30 ms.
* Shell bounce `o8`: brass modal [4180,6830,9760,11900,2470] x (jittered), 2-3 bounces with spacing .085-.15 s and gain x .45-.62 each (physical decay of bounces).
* Footsteps concrete `r8`: 112->58 Hz thump (60 ms), LP 720 noise, bp 2500 noise at +12 ms, sparse HP 3.8 kHz grit with random amplitude every 70 samples (scrape). Water `t_`: band-passed noise sweeping 1500->520 Hz with `exp` envelope + 5 chirp "plops" 500-1700 Hz. Metal step `l8`: modal [178,412,733,1214,1958,3130] over a thud.
* Impacts: concrete `p8` (LP 950 noise + thump + HP 2 kHz + 16 sparse grit grains), metal `d8` (8 inharmonic partials ratios [1,1.58,2.24,2.92,3.71,4.93,6.31,8.1] on base 640/880/745 Hz, tau .13/(1+.55k)), wood `m8`, water `g8`, glass `x8` (9 high modal grains 3.2-9.5 kHz scattered over 0.3 s), enemy hit `v8` (HP 4 kHz tick + 2.9/4.7/7.3 kHz modal + 320 Hz bp + a 118 Hz gated pulse train = electrical buzz).
* Ricochet `y8`: sine sweeping 3300->820 Hz (tau .16) with vibrato and 2nd harmonic + narrow bp noise. Bullet whiz `b8`: bandpass noise swept 5200->1300 Hz, Q3.5, Gaussian envelope peaking at 50 ms.
* Enemy guns: gull `E8` (square/saw 380+620e^(-t/18ms) Hz "zap" + bp 2.4k noise + 240->120 thump, soft-clipped), hound `S8` (112->37 Hz boom, bp 420 Hz noise, modal 310/642/985 Hz).
* Telegraph `P8` (0.6 s, rises with `h^1.4`): gull = two sines 620->2520 Hz plus noise ticks; hound = 170->550 Hz saw + 680-1580 Hz. The audio code plays it with `playbackRate = 0.55 / telegraphTime`, so the whine always ends exactly when the attack fires.
* Explosion `I8` (3 s): click + 96->27 Hz sweep (tau .16/.36) + LP 2800->260 noise (tau .26) + <120 Hz rumble (tau .7) + 120 debris grains + 7 randomly pitched ring-offs; soft clip k=1.7, scaled .36. Explosion event also sets `musicDuck=.4`, adds screen shake and ear-muffle.
* Death sounds: gull `A8` (4 detuned saw-ish voices decaying in pitch 0.16^t with chopped AM, then crash at .72 s with noise grains), hound `R8` (30+112(1-t/1.3)^1.6 Hz saw descending + 180-1230 Hz sine, then 5 metal clunks at .62-1.33 s with modal 388/861/1540/2750 Hz).
* Relay cut `z8`: gated bp-3k noise crackle + pitched-down 100->(decay .22^t) buzz ending; Objective stingers are tuned chords (A3 D4 F4 A4 via `Pf` additive bells) + kick.
* Ear ring `f8`: three sines 3150/4013/5310 Hz, 2.4 s, envelope (1-e^(-t/.12))e^(-t/.55).
* Foghorn `L8`: 92.5 Hz with 7 harmonics weights [1,.435,.268,.19,.145,.116,.097] + 138.6 Hz fifth, slow +-0.25% vibrato, LP 520, 5 s. Gull cry `k8`: 3-4 chirps 1550 Hz with 55% glide, 63 Hz AM. Halyard: 3-4 modal 2.3 kHz bursts spaced .09-.26 s. Container bang: sub modal [47,77,121,163,214,330 Hz] tau .7-.12 s, echoed at +.36/.61 s.

**Rain bed** (`O8`, ; two independently-seeded stereo channels so L/R are decorrelated; 6 s loop):
1. 6.4 s noise HP 900 / LP 8500, gain .5 (hiss) + 6 s noise bp 420 Hz Q.5, gain .75 (body).
2. 1020 random droplet grains (0.6-3 ms noise bursts, amplitude `rand^3*1.6+.15`, random position), run through a 2-pass HP 2.2 kHz -> sparkle, x.55.
3. 30 tiny upward "plink" chirps (8-20 ms, 700-2100 Hz -> x1.7, gain .08-.3) at random times.
4. Equal-power crossfade of the tail into the head (loop with no seam).
Interior rain `H8`: LP 1300/HP 110 noise (.8) + 1560 sparse impulses (`.2+rand^4*3`) fed through five resonant bandpasses (1820 Q14, 2740 Q16, 4150 Q18, 6200 Q14, 940 Q8) x5 (tin-roof ringing) + 4 low metal chirps. Wind `V8`: noise bandpassed with a centre frequency moving 380+190 sin+90 sin (Q1.3) plus a second whistle band 1350+-260 (Q9) that is gated by `sin^2`. Sea `W8`: 4 s wave cycle (`(.5-.5cos)^1.5` swell + crest HP 2.4 kHz hiss at phase .5 + 520 Hz bp thump), 8 s loop.

**Rain is positional only by content, not by source**: `rain`, `wind` are stereo non-spatial loops on `amb`; `sea` is a spatial loop whose z follows the player (clamped -28..26) at x=+33, always on the quay side.

**Enemy loops**: gull rotor `_8`: four detuned harmonic stacks at 184/207.5/233/258.5 Hz, each 5 harmonics, with 2.5-4.5 Hz tremolo, plus HP 1.1k/LP 5.2k noise gated at 46 Hz "blade pass". Frequencies are quantised (`round(f*2)/2`) so a 2 s buffer contains whole cycles = seamless loop. Hound servo `M8`: 310 Hz with FM wobble + 62 Hz stack + HP 2.8 kHz hiss. Relay hum `w8`: 50 Hz mains-like harmonics + 4.1 kHz whine + 1.25 kHz FM + resonant crackle.
Runtime: the 6 nearest enemies within 90 m get live HRTF-panned loops (re-evaluated every 0.25 s; the rest are stopped). Per-enemy pitch tune 0.96-1.06; gull pitch .94+.3*speed/10 (Doppler-like), hound gain .3+.5*speedNorm, pitch .88+.3*speedNorm.

### 1.5 Spatial audio
Listener position/orientation is copied from the camera matrix each frame. One-shots with `pos` use pooled panners (equal-power); looped enemies use HRTF. Per-sound `ref`/`roll` tune distance falloff (explosion ref 12, gull gun 7, impacts 4, shell 2). Far one-shots are simply placed far away: foghorn at x+320 with ref 400; gulls 35-85 m away at 14-32 m height. Bullet **whiz**: when an enemy shot is not a hit, compute the closest point of the ray to the player; if within 3.2 m and the point is ahead of the impact (`t < -1.5`), spawn a positional `whiz` there with gain `1.15 - d/3.5`. This is the single best "bullets are real" cue.

### 1.6 Interior / exterior
Camera inside any AABB in `level.interiorBoxes` -> target P=1. P is smoothed (rate 3/s) and drives: outdoor reverb send x(1-.9P), shed reverb x P, rain gain x(1-.93P) with interior rain x P, wind x(1-.65P), sea x(1-.5P), random distant one-shots x(1-.7P), and the rifle tail in/out crossfade. The shed IR = two noise branches (LP-swept 5200->650 Hz, tau .33 and .4) + 5 early reflections 18-139 ms. Outdoor IR = noise 1.3 s LP 6000->900, tau .27 + HP 300 branch + 5-6 discrete 62-243 ms slaps. Sample-rate of IR buffers matches context rate (`f` ).

### 1.7 Dynamic music and intensity
* Five stems at 100 bpm, 8 bars (19.2 s) each, 32 kHz, same start time `t0` so they stay phase-locked: `drone` (3 detuned saws per note on the chord roots with LP 560+-300 Hz LFO), `ost` (16-step plucked arp, saw+square with resonant swept 2-pole LP), `perc` (kick 74->34 Hz, 90 ms hat grains, a 4-hit fill at the loop end), `brass` (two saws detuned 1.004, LP swept 240->1940 Hz per swell), `motif` (additive bell partials 1/2.003/3.01/4.2/.5, notes D4 A4 Bb4 F4 / ...). Chords D2 minor, Bb, G minor, A.
* Stem gains by state: title `[.85,0,0,0,.9]`, intro `[.8,0,0,0,.6]`, dead `[.75,0,0,0,0]`, complete `[.6,0,0,0,.7]`, playing at intensity `t`: `[.6+.3t, smooth(.05,.5,t)*.85, smooth(.4,.8,t)*.95, smooth(.62,1,t)*.8, 0]`. Each stem eases to target with a 0.5 s time constant. Music starts only when all five buffers exist.
* Intensity source: game sets 0.15 (patrol), 0.6 (recently alerted, or any enemy within 26 m), 1.0 (wave active / queued / all relays cut). Audio also keeps a combat accumulator `Y` bumped by alert/fire/telegraph/hit (floor .6), decaying .045/s with enemies alive, .14/s otherwise; the used intensity eases at 2/s: `L += (max(V,max(.15,Y)) - L)*...`.
* **Ducking**: every rifle shot sets `duck=min(duck,.55)`, explosion `.4`; duck recovers at 3.5/s into the music bus. Pause drops master to 0 (rate 12) and music to .45.
* **Concussion/death muffling**: global lowpass S frequency `20000*0.03^Z` (so Z=.7 -> 1.7 kHz, Z=1 -> 600 Hz). Hits set Z>=clamp(dmg/40,.2,.7) and decay at .9/s; death drives Z to .85 at rate 3; ear-ring plays on hits >=6 damage. The ear ring is on the `dry` bus so it bypasses the muffle.

---

## 2. Game feel

### 2.1 Input
Mouse 0.0021 rad/px (x sens slider .2-3); touch 0.0052; gamepad 3 rad/s with quadratic response, deadzone .16 rescaled; keyboard turn 2.1 rad/s. Mouse deltas >400 px are discarded (Chrome pointer-lock spike bug). Pointer lock with fallbacks: on `pointerlockerror` or >1.2 s without lock it switches to a "drag" mode (move to look, edge-pan, click fires) and tells the player. Esc and lock-loss both pause. Input state is polled in an `update`, with `pressed` (edge) / `down` (level) sets cleared by `endFrame` at the end of the frame.

### 2.2 Player constants (`Mt`, ; eye 1.68, crouch eye 1.05, radius .32, height 1.8, FOV 74)
* Speeds m/s: walk 3.8, sprint 6.4, crouch 1.9, ADS 2.4; backward x(1-.18*|back|).
* Acceleration: ground 34 m/s^2, ground decel 26, air accel 9 (and 0.6 braking when no input in air = momentum preserved). Velocity moves toward target by a capped step (vector, not per-axis).
* Gravity 21, jump apex 1.0 m -> v0 = sqrt(2*21*1)=6.48. Coyote 0.12 s, jump buffer 0.13 s. Crouch can't un-crouch under a low ceiling (box test, ). Eye height eases at rate 11. Pitch limit 1.5 rad. Sprint requires forward>.55, |strafe|<.6, not crouched, ADS<.35, not firing; sprint FOV +6, ADS FOV 52 (rate 30 mid-transition, 7 otherwise).
* Fall: land when airborne >.12 s; vertical speed `s`; landing dip `g.v -= min(s*.36,3.2)`, shake if s>7.5 (`min(.5,(s-7.5)*.06)`), fall damage `(s-13)*7` if s>13. Out-of-bounds (below the sea) teleports to last safe spot, 12 damage, turns you around, shows "Hauled out of the water".
* Health 100, regen after 4 s at 25 hp/s.

### 2.3 Camera
Camera rotation order YXZ. Final = base look + sum of independent layers:
* **Bob**: phase advances by distance (`stride` 1.55 m walk, 2.1 sprint, 1.05 crouch), so steps and bob are locked. Y = `-cos(2pi*phase)*.024*amp`, X = `sin(pi*phase)*.013*amp` (lateral, applied along the camera right vector), amp = speed/walk x sprint 1.9 x ADS .22 x crouch .7, eased at rate 9. Footstep event fires when `floor(phase)` changes. Also roll `.35*bobX` and strafe roll `.02 rad` toward velocity.
* **Landing spring**: `g` spring (k=150, c=17), clamp -.2..+.05, also added to roll `*.12`.
* **Recoil** (see 2.5), **shake** (see 2.6), **FOV** easing.
* Death: eye drops to .22 m by `smoothstep(0,.85,t)^2`, roll 1.15 rad, small yaw drift; invulnerable and collapse, not a freeze.

### 2.4 Weapon viewmodel
* Procedural PAC-9 rifle (about 40k tris split in 7 merged meshes by material, with a baked texture for markings drawn on a canvas, a procedural reflex-sight shader with real sky reflection and a parallax-correct red dot, a muzzle-flash shader made of 5 quads with random petal counts per shot, procedural gloved hands with posable finger/thumb IK poses). Details such as 49 rail slots, 8-segment handguard with cutouts, rain droplets in the material shader (`setWetness`, drying indoors at rate .25, rewetting at .6 outdoors).
* Rendered with a **separate view camera** (FOV 54, layer `zc`) parented to the main camera, so it never stretches when the world FOV changes with sprint/ADS. The muzzle world position is converted by `tan(fovCam/2)/tan(fovView/2)` for tracers and light. Model x-squeezed .86 near the front.
* **Pose blending**: hip `p=[.118,-.122,-.275] r=[.034,.085,-.03]`, ADS `p=[0,-sightY,-.135]` (sight line centred), sprint `p=[-.035,.004,.03] r=[-.04,.62,.26]` (rifle tilted/rotated), reload pose. ADS time 0.18 s (linear in, quintic smootherstep out); sprint pose eases rate 9; sprint blocks firing until `sprintT<.45`.
* **Springs** (semi-implicit, sub-stepped 8 ms,  and 3829-3837): `kickZ(520,30)`, `kickPitch(380,26)`, `kickYaw(300,22)`, `kickRoll(300,20)`, `swayYaw(110,15)`, `swayPitch(110,15)`, `jumpY/P(140,13)`, `bump(600,30)`. Each is `a = (target-x)*k - v*c` with an *impulse into velocity* (not position), which gives a natural overshoot.
* **Per shot**: `kickZ.v += 1.5*lerp(1,.6,ads)` (rifle back), `kickP.v += 1.5*bt`, random `kickY/kickR`, `bloom += .17`, muzzle flash 36-56 ms (intensity 9.5*sqrt(life), random rotation .4 rad, scale .8-1.3, x.62 in ADS), muzzle point-light pool flash (45 intensity, 9 m, 50 ms), tracer, ejected shell with velocity (2+1.2rand, 1.2+.8rand, .5-.6rand) + player velocity, bolt travel .062 m over 72 ms (`sin` curve; locks back on empty), heat +.05 (smoke wisps after the burst, barrel glow `uHeat`). Trigger finger blend on the glove mesh (morph between 2 poses, rate 30).
* **Sway**: look deltas inject velocity into sway springs (`dx*3.2`, `dy*2.6`, x.4 in ADS), clamped +-.09/.07 rad; strafe adds roll `-move.x*.035`. Breathing: slow sines at .5/.85/1.7 rad/s with amplitudes .001-.004 (x.3 in ADS). Walk weapon bob uses its own phase `5.2+speed*1.55`, with vertical shape `sin(2p)*.0042 - (.5+.5cos(2p+.6))^4*.0048` (sharp footfall dip, not a plain sine).
* **Jump/land**: takeoff `jumpY.v -= .22, jumpP.v += .7`; landing impulse `-clamp(vy*.06,0,.6)`.
* **Reload** is a keyframed hand path (SLERP + position LERP with smootherstep) with events at times: tactical 2.1 s, empty 2.72 s; `magout` @.47 s, `magin` @1.345 s (ammo actually transfers here, with a bump impulse), fresh-mag visible after .86 s, bolt rack @2.19 s (empty only); each phase emits `weapon:reload{phase}` which the audio hooks. Auto-reload 0.32 s after a dry click. Idle inspect animation after 24 s of no input.
* Fire cadence 720 rpm via accumulator (up to 3 shots per frame to stay exact); mag 30, reserve 150; damage 26; range 300; headshot ("weak") x2.2 on hound head/whole gull? (gull body only).

### 2.5 Recoil and spread
Camera recoil is a **two-part model**: each shot, 35% (`recoilKeep`) of the kick is added permanently to the aim (`pitch`, `yaw`) and 65% goes to a visual offset (x,y; clamped +-.3/+-.2 rad). After `recoilHold` .09 s the visual offset decays at rate 6.5/s, and the offset applied to the camera follows it at rate 34. So the player has to pull down a little (permanent part), yet the screen snaps and settles. Per-shot pitch kick `.0068 rad * (1 if burst<=9 else .38) * ads(.55) * crouch(.85) * (.85..1.15 rand)`; yaw: random +-.0011 for the first 3 shots, then `sin(shotIndex*.57 + burstPhase)*.0042 + noise` (a learnable but wandering pattern; the burst resets after .24 s of no firing with a new random phase). 

Spread (cone half-angle, rad): `base .0125 -> .0012 ADS` + `speed/6 * (.013 -> .004 ADS)` + `bloom*(.0065 -> .0022)` + airborne .022 - crouch .002; smoothed with rate 18. Bullet direction sampled uniformly in disc: `tan(spread)*sqrt(rand)`. The HUD crosshair gap is computed from exactly this value so the visual matches the mechanics.

### 2.6 Screen shake
Trauma model: `_ = min(1, _ + add)` decays 1.7/s; displacement = `trauma^2 * amp * (sin(t*43.1) + .6 sin(t*71.7+1.3))` per axis with different incommensurate frequencies; max pitch/yaw .03 rad, roll .045 rad. Adders: rifle shot .12 (x.55 ADS), damage `.22+dmg/70`, relay cut .18, explosion `(1 - dist/(14+10*size))*(.35+.35*size)`, landing hard.

### 2.7 Hit feedback
* No slow-motion or hit-stop. Feedback is stacked and cheap: hitmarker DOM element (four ticks) with WAAPI scale pop (1.15x hit, 1.5x weak/kill; 240 ms, kill 420 ms, `ease-out`) and three classes (hit/weak/kill, differently coloured in CSS); impact sound pitched x1.25 for weak point; kill feed line with a "Weak point" tag if the killing shot was weak; enemy flinches (springs, section 3).
* Damage direction: 4 pooled SVG arcs rotated to `atan2(src - player) + yaw`, life 1.5 s, fade in last .6 s. Post-processing: `damage` (hurtPulse: `+= .35+dmg/40`, decays 1.9/s) adds chromatic aberration, red edge, desaturation x(1-.5*damage); `lowHealth` (smoothed toward `smoothstep(.55,.12,health/max)`) adds vignette +.55, pulsing red edge, desaturation x(1-.65*lowHealth).
* Audio feedback: `hurt` thump on dry bus, `ear_ring`, muffle filter, music intensity bump, low-health radio line at <30 hp.

---

## 3. Enemies

Everything is built from procedural geometry merged per "slot" (shell/metal/glow/lens) and skinned to a tiny bone rig (`iu` class : bones with local offsets, parts merged and weighted 100% to one bone each; no animation clips). Vertex colours bake a top-light gradient (`.74+.26*(ny*.5+.5)`). Emissive parts (lens, beacons, strobes) use over-1.0 colour values so bloom picks them up (e.g. lens `[8,4,.7]` amber idle, `[14,1,.35]` red when engaged). Serial numbers (`G-11`, `H-03`) are drawn as stencil label decals.

### 3.1 "Gull" drone (`j_`, )
Fuselage ellipsoid + 4 rotor arms with discs (blur disc geometry), gimbal ball with camera lens and spotlight cone (additive, view-dependent shader), underslung twin barrels, red/green/white nav strobes that blink on a ~1 s pattern. A real light from the light pool follows the nearest gull's spotlight.
**TUNE** (`Zv`, ): hp 45, bolt dmg 7, bolt speed 70 m/s, burst 3 (gap .12), telegraph .55, cooldown 1.9-3.3 s, orbit range 12-25, altitude 4-8, maxSpeed 8, patrol 3, accel 11, spread far .065 / near .018, fireRange 42, death blast radius 3 / dmg 30.
Flight: PD spring toward a target point (xz `acc=(target-pos)*2.2 - vel*2.4`, y `*5 - vel*3.6`), acceleration clamp 11, 3 round-robin feeler rays (forward / down / up, one per frame) producing avoidance impulses, tilt (pitch/roll) from acceleration, rotor spin 41 rad/s * throttle. Orbits the player (angular speed 3.6/r or slower 0.9/r while attacking, direction flips every 3-8 s with 60% chance). With no LOS for >1.5 s it flies to last-known position. Below 50% hp: wobbling jitter + smoke trail. Death: random rotor shears off, spins, falls with gravity 9.5, smoke every 45 ms, then explodes at ground (area damage to player *and* other enemies via `combat.explode`).

### 3.2 "Hound" robot dog (`Z_` rig , AI )
Quadruped, 4 legs x 3 bones (abduct, thigh, shin) with **analytic 2-bone IK** (`q_`, ). Gait: diagonal pairs `[0,3],[1,2]`, a pair swings when its feet are furthest from their predicted spots (look-ahead `N=.27-speed*.026`, clamp .14-.27 s), foot path = smoothstep lerp + sine lift `.065+min(.09,speed*.02)`; each touchdown fires `enemy:step` and kicks the body spring. Body pose from three springs (sY 160/17, sP/sR 130/15) fed by the feet heights, acceleration (pitch) and turn-rate*speed (roll). Turret yaw/head pitch with separate lag; antenna swings on its own spring. Hit reactions are impulses into those springs along the shot direction (more for weak hits), so damage reads physically.
**TUNE** (`Kv`, ): hp 140, shot dmg 5, burst 4 (gap .11), telegraph .5, cooldown 1.8-3, run 4.5, stalk 2, patrol 1.5, accel 7, turn rate 2.5, preferred range 8-18, spread far .12 / near .045, lunge: range 3, wind-up .28, dmg 15, speed 9.5 for .36 s, cooldown 3.5, recover .55; smoke below 40% hp. Hit volumes: head sphere r=.155 (`weak`, x2.2), two body capsules r .25-.27.
Combat state machine (`es`): `move -> aim -> tele -> burst -> cool -> (repeat <=2 bursts) -> reposition`; interrupt: `wind -> lunge -> recover` when within 3 m and lunge cooldown is ready. Position choice `w` scores cover points (-2), 7 random navmesh points and 5 points on a ring at the hound's own bearing +-1.3 rad; candidates must be 8-18 m from the player; cost = travel*.9 + rand*3 + 22 if no LOS from there + up to 14 for sharing an angle (dot>.86) with another engaged hound + 16 if within 3 m of one: hounds therefore spread and flank. Pathing uses `physics.nav.findPath` replanned every .6 s, feelers (rays every .12 s) detect blocking and induce unstick turns. Separation push between hounds (1.7 m) and from the player (1.25 m).
Death: ragdoll-free: body falls (vy gravity 9.8, bounces with .22 restitution, crash sound), feet slide outward, lens strobes red then dies, smoke 6.5 s, wreck sinks after; at most 5 wrecks (`maxWrecks`).

### 3.3 Perception and director (`Ui`, )
* `sightRange 45`, `sightCone 200 deg`, near-sense radius 3.5 m, LOS raycast sampled every 0.11-0.19 s (staggered). Engage when seeing the player for `seeT > think` (gull .4 s, hound .55 s while patrolling, x.45 if already investigating). Lose track after 4 s without LOS -> `search` for 8+rand(3) s -> back to patrol (home = where it ended).
* **Exposure** (0..1): +0.1/s while seeing, -0.45/s otherwise; lowers the enemy's spread (`far + (near-far)*exposure`) and gets multiplied by `1+playerSpeed*.45`(gull)/`.3`(hound). So a player who keeps moving and breaks LOS is rewarded; standing in the open is punished gradually.
* Hearing: player gunshot alerts all non-engaged enemies within 45 m (throttled .3 s) to investigate the shot origin; explosions 30 m; alert + rally: an engaging enemy rallies others within 18 m to its last-known point; being hit rallies 20 m ("provoke").
* **Attack tokens**: max 2 simultaneous attackers (3 if >5 alive), min 1.25 s between grants, and avoid the same enemy type twice in a row unless the other type has not been waiting. This is the main reason fights feel fair and readable.
* **Telegraphs** are the contract: gull flares its lens (flare ramps 4.5/s), whine (audio at the same duration), 0.55 s; hound crouches (N=.05) + lens flare + whine .5 s; melee wind-up crouches .16 and plays the melee telegraph. Gulls lead the target by a random factor .2-.85 of ideal; attacks require aiming error <.35 rad and LOS.
* Bolts are real projectiles (pooled 32, instanced mesh, speed 70 m/s, 1.3 s life) with swept raycast per frame and capsule hit test (radius .36) so players can dodge; hound shots are hitscan with tracer.

### 3.4 Pacing and spawning (`Yi`, )
* Start: 2 gulls + 1 hound on patrol, placed >=32 m from the player, preferring hidden spawn points.
* Waves trigger on each relay cut: 3 gulls+1 hound, then 3+2, then 4+3 (hounds interleaved in the queue). Spawn at `now+1.6+i*.85 s`, in state `alert`, cap `maxAlive 9`. Spawn point scoring: >=18 m away, + not in LOS (+2.5 if hidden), - penalty if used in the last 6 s. A HUD warning "Contact - NORTH-EAST" computed from the mean spawn bearing.
* After all relays cut: up to 5 pursuit spawns, one every 7 s while fewer than 4 alive, plus noise alerts every 4 s (radius 90). Music intensity is held at 1. Extraction at the quay ladder; entering the radius before all cut gives "the boat will not wait under fire".
* Objective: hold E for 2.4 s at a relay within 2.2 m and facing (dot>.45); progress decays x1.6 faster when released; each cut calls `addShake(.18)`, triggers wave, radio line, audio `objective:done` (relay hum stops, `relay_cut` positional, stinger after .35 s).

---

## 4. HUD and game flow

### HUD
DOM-based, all updates cached by value (`X` object) so DOM is only touched on change. Elements: compass tape (-90..450 deg, 4 px per degree, cardinal/intercardinal labels, translate3d), heading numeric, objective box with typewriter (46 cps), relay pips (n/3), waypoint markers both on the compass and in world space (project; off-screen clamp to 0.9/0.82 of screen with flipped coordinates when behind; dim when near the crosshair; "near" when <3 m), crosshair of 4 ticks (gap `= tan(spread)/tan(fov/2)*H/2 + 4 (+10 sprint)` clamped 4-70 px, hidden when ADS>.6 because the red dot takes over), hitmarker, damage arcs, hold-to-interact prompt with SVG ring (stroke-dashoffset), kill feed (max 4, 4.2 s, fade at .6 s), warning banner, message line, health (10 segments + number, only visible when damaged, `crit` class at <=3 segments), ammo (number + a pip per round, cue text "Low ammo" at <=27%, "R - Reload" at 0, "Reloading"), radio subtitles (58 cps typewriter, queue, `aria-live=polite`). HUD marks hide when aiming (<.5).

### Menus / screens
Title (cinematic flythrough behind, premise line, Deploy/Settings/Controls, key legend), paused, dead ("Signal lost", time survived, relays cut, Retry), debrief (time, accuracy, kills, retries, rating), settings panel (quality auto/low/medium/high/ultra, sensitivity, invert Y, master volume, FOV 60-95, fullscreen, focus trap, Esc closes), controls tab (keyboard/touch/gamepad). Settings in localStorage key `saltline.settings.v1`, validated and clamped on load. UI sounds via `ui:click`/`ui:hover` events (hover from `mouseover` on buttons).

### Flow
`title -> intro -> playing <-> paused -> dead | complete`.
* Title: camera rides a Catmull-Rom spline of `level.cinematicPath` (positions and look targets), speed ~1.15 m/s, min loop 26 s, eased `t*t*(3-2t)*.25+t*.75`, micro-drift sines at .13-.43 rad/s, fov 50, fade in/out at ends. The title is the same live world (rain, audio at .6 gain, title stems).
* Intro (3.5 s; retries 1.3 s): fade from black over ~2.6 s, location card at .5 s, radio briefing at 1.3 s, HUD appears 0.6 s before control; player disabled.
* Playing: pause on Esc/P, on pointer-lock loss (only if lock was gained previously) and on tab hidden; pause has .35 s debounce.
* Death: saturation -> .12 (rate 2.2), fade -> .55 (rate 1.4), dead screen after 1.5 s; Retry restarts with short intro, keeps retry count. Complete: invulnerable, fade .72, saturation x.7, debrief after 3.3 s. Rating: points from time (<270 s: 2, <400 s: 1) + accuracy (>=50%: 2, >=30%: 1) + zero retries (1) -> `Messy, Loud, Steady, Clean, Sharp, Surgical`.
* Radio lines (`_l`) deliver tutorial and story: briefing, contact, per-cut lines, all-cut ("boat is holding at the quay ladder"), low health, debrief.
* Touch: floating left stick (radius 58 px, pushing >.93 forward sets sprint), right-side drag to look (also dragging while holding FIRE), buttons FIRE / AIM (toggle) / RLD / JUMP / USE / pause; `touch` auto-detected from first touchstart (then pointer lock is released and the UI body gets `is-touch`); ignoring emulated mouse for 800 ms after a touch. Gamepad standard mapping (RT fire, LT aim, A jump, B crouch, X reload, Y use, L3 sprint, Start pause).

---

## 5. Test and debug harness

**URL parameters**
| param | effect |
|---|---|
| `?shot` | deterministic screenshot mode: quality `test`, game auto-started (skip intro), dynamic resolution off, shadow map refreshed every frame, auto-exposure read-back (``), no title screen / lock hints |
| `?autostart` | skip title and intro, gameplay immediately |
| `?cam=x,y,z,lx,ly,lz` | freeze camera at a position/look target (re-applied every frame, after game update); `?fov=`, `?exposure=` |
| `?seed=` (default 4207), `?eseed=` (9001) | RNG seeds for world/gameplay and enemy AI |
| `?q=test|low|medium|high|ultra` | quality preset (otherwise auto-detect by UA/GPU string) |
| `?dt=0.0166` | fixed timestep instead of real frame time (clamped .05 otherwise) so physics/animation is reproducible |
| `?noaudio`, `?noweapon` | silent stub / hide viewmodel |
| `?show=<module>` | **showcase** mode: boots only that module on a stub level with fake modules for everything else; names: `mats` (+`only=`, `names=`, `wet=`), `level`, `backdrop` (`bshow=`), `ground`, `fx` (`fxshow=all|impact|explosion|tracer`, `fxhold=muzzle`, `fxt=`, `fxsize=`, `fxsoft=0`, `fxage=`), `weapon` (`wpose=hip|ads|sprint|fire|reload|empty|side|right|top|hands|rhand|muzzle|optic|lower`, `wt=` reload time, `wempty`, `wads`, `wlook=south|east|north|west|nw`), `enemies` (`eshow=gull|hound|fight|dead|both`, `epre=` seconds of pre-simulation, `efreeze`), `props`, `render` |
| `?bench` / `#bench` | benchmark overlay (below); implies `noaudio` + `autostart` |
| `?dynres=0` | disable dynamic resolution scaling |

**Window hooks**: `window.__ready` (true after 2 rendered frames), `__frames` (counter), `__fatal` (string if boot failed; also shown on screen), `__errors` (array: `window.onerror` + every `console.error`, truncated to 400 chars), `__G` (the whole game context: `__G.audio.selfTest`, `.debug`, `.setIntensity`, `__G.game.start({skipIntro})`, `.debugCut`, `__G.enemies.spawn("hound", pos, {state:"alert"})`, `.debug`, `__G.weapon.debug.{freeze,reloadT,empty,flash,noFire}`, `__G.player.tuning`, `__G.render.stats`), `__setShot({cam,fov,exposure,wpose,...})` (change a shot without reloading), `__stats` (render stats + fps + game state).
Robustness features: every module init is wrapped (`r` at ): on failure it logs, falls back to a stub from `dr[...]` and continues, unless marked required; each per-frame `update` is try/caught and logs once per module. The loop order is input, game, player, weapon, enemies, fx, ground, level, backdrop, mats, audio, hud, camera override, bench, render.

**Audio self-test** (`selfTest`, ): spins up an `OfflineAudioContext` (stereo, N seconds), runs the real mixer against a fake event bus at 50 Hz virtual time (using `suspend/resume` to step the mixer per tick), scripts shots, enemy fire, an explosion, a hit, a kill, objective, optionally in the interior; returns `{renderMs, peak, over (samples >= .999), nan, rmsDb per 0.5 s, debug}`. An agent can assert no NaN, no clipping, plausible loudness, and compare interior vs exterior. (The recipe functions are also pure and can be rendered in Node.)

**Bench** (`eP`, ): moves the camera along `cinematicPath` (30 s loop, smoothstep per segment), samples frame times, shows GPU string, buffer size, quality, DPR, avg/median/p99 ms and fps, renderer stats, and the first 6 errors in a `<pre id=bench>`.

**How an autonomous agent verifies its own work** (this is what the 8-hour run must have done): load `?shot&cam=...&fov=...&seed=N&dt=.0166`, wait for `__ready`, then screenshot; read `__errors`/`__fatal` after each change; use `?show=weapon&wpose=...` and `?show=enemies&eshow=...&epre=` for close-up asset inspection of each subsystem in isolation with the same camera every time; `?q=test` for speed; `#bench` for performance numbers and `__stats` for draw calls; `selfTest` for audio sanity; `__G.game.debugCut` and `__G.enemies.spawn` to jump the director; fixed `dt` + seeds make before/after diffs meaningful.

---

## 6. Why it feels good (ranked)

1. **Every action emits an event that audio, HUD, FX and shake all listen to**: one shot = recoil impulse + camera shake + viewmodel springs + flash shader + point light + tracer + shell + sound + tail + hit sound in the same frame. Nothing is "silent". 
2. **Impulse-driven springs, not keyframed offsets**: kicks are velocity injections into under-damped springs, so overshoot and settle is organic; same primitive reused for hounds.
3. **Split recoil**: 35% permanent aim, 65% visual, hold 0.09 s then recover at 6.5/s: heavy but controllable and no auto-return that feels like the game "takes the aim back".
4. **Bob locked to distance travelled and to footsteps**, asymmetrical vertical weapon bob; ADS reduces bob to 22%; sway from look input; landing dip spring.
5. **Responsive movement numbers**: 34 m/s^2 ground accel with 0.12 s coyote and 0.13 s jump buffer; air keeps momentum.
6. **Crosshair = real spread**: honest information, makes ADS/crouch/sprint meaningful.
7. **Audio layering**: tight crack + thump + mechanical clack + separate tail crossfaded by room; bullet whiz at closest approach; sound telegraphs time-stretched to telegraph length; music ducks per shot; concussion lowpass + ear ring; all-synthesised sounds normalised to declared peaks, compressor + soft clipper at master.
8. **Fair enemy design**: tokens, telegraph before every attack (flare + whine), exposure-scaled accuracy, bolts that can be dodged (70 m/s), 0.55 s telegraph, cap 9 alive, hidden spawn scoring, flanking cost function, directional "Contact - NE" warning.
9. **Readable hit confirmation**: weak-point x2.2 with distinct marker size, pitch and feed tag; enemies visibly flinch (springs) and die with distinct physical animations; wrecks persist (max 5).
10. **State-driven ambience**: interior factor P drives six audio parameters at once, plus weapon wetness and render interior env; rain/wind/sea each have gust or position logic; distant one-shots on randomised timers.
11. **Pacing through relay-triggered waves and radio lines** that double as tutorial; intensity feeds the music stems.
12. **Polish on the edges**: title cinematic over the live scene, intro fade + location card, dead screen desaturation, debrief rating, pause that suspends audio/FX, settings persistence, touch + gamepad, pointer-lock fallbacks.

---

## 7. Reusable pseudo-code (paraphrased)

### 7.1 Layered procedural gunshot
```js
function gunshot(sr, rng, v) {
  const out = zeros(sr*.32), P=[1,.955,1.045,.985][v&3];
  add(out, burst(sr,rng,.012, tau=.0011, {hp:2600}), 0,    2.6);   // crack
  add(out, burst(sr,rng,.02,  tau=.003,  {hp:1200,lp:8000}), 0, 1.2);
  add(out, sineSweep(sr,.11, 160*P, 45*P, tauF=.024, tauA=.03), 0, .62);   // thump
  add(out, burst(sr,rng,.22,  tau=.03,   {hp:300*P,lp:2500*P}), 0, 1.5);  // blast
  add(out, burst(sr,rng,.09,  tau=.016,  {bp:760*P,q:2.2}), 0, .9);
  add(out, modal(sr,.05,[[2150*P,.007,1],[3420*P,.006,.7],[880*P,.012,.5]],rng), .035, .26); // action clack
  return softclip(scale(out,.46), 1.5);   // then normalise to table peak; tail is a separate sound
}
```

### 7.2 Split recoil + spring viewmodel
```js
addRecoil(p, y){ aim.pitch += p*.35; aim.yaw += y*.35;
                 vis.p = clamp(vis.p + p*.65, -.3,.3); vis.y = clamp(vis.y + y*.65,-.2,.2); hold = .09; }
update(dt){ hold -= dt; if(hold<=0){ vis.p = decay(vis.p,0,6.5,dt); vis.y = decay(vis.y,0,6.5,dt); }
            applied.p = decay(applied.p, vis.p, 34, dt);    // camera pitch = aim.pitch + applied.p }
// viewmodel: each axis is a spring {x,v,k,c}; on shot: kickZ.v += 1.5; kickP.v += 1.5; kickY.v += rnd(-.5,.5)
step(s,dt){ s.v += ((0 - s.x)*s.k - s.v*s.c)*dt; s.x += s.v*dt; }   // k~300-600, c~20-30
```

### 7.3 Seamless procedural rain loop
```js
function rainLoop(sr, rng){
  const hiss = crossfadeLoop(filter(noise(6.4), hp900, lp8500), 6);  // equal-power tail->head
  const body = crossfadeLoop(bandpass(noise(6.4), 420, q=.5), 6);
  const drops = zeros(6*sr);
  for (i<1020) addGrain(drops, rng*len, noiseBurst(.6-3ms), amp=rng**3*1.6+.15, wrap=true);
  highpass2x(drops, 2200);
  for (i<30) addChirp(drops, rng*len, 8-20ms, f0=700..2100 -> f0*1.7, gain=.08-.3);
  return hiss*.5 + body*.75 + drops*.55;     // call twice with different seeds for L/R
}
```

### 7.4 Attack tokens + telegraph
```js
requestToken(e){ if(e.hasToken) return true;
  const cap = alive>5 ? 3 : 2;
  if(tokens>=cap || now-lastGrant<1.25 || sameTypeStreakBlocked(e)) { wantT[e.type]=now; return false; }
  tokens++; lastGrant=now; e.hasToken=true; return true; }
// attack: if(los && cooldown<=0 && aimed && requestToken(e)) { e.state='tele'; t=.55; emit('enemy:telegraph',{time:.55}) }
// tele: lens flare ramps to 1; audio plays whine at playbackRate = .55/time; then 'burst' of 3 shots; releaseToken at the end
```

## 8. Caveats
* "Harbormaster" is only the narrative antagonist (the security network); there is no boss enemy in the code. Only two enemy types exist.
* The line "headshot" applies to the hound head sphere only; gull has one body ellipsoid.
* Music stem scores and the `X8`/`q8` sequencer details were skimmed; numbers above for drum/arp patterns are approximate.
