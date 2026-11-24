# Case study: Particles, rain, muzzle/impact/explosion layering, soft particles, lit smoke, decals, light pulses

> What the Saltline game (Claude Fable 5.2, one autonomous run, Three.js, zero asset files) does in this area, with its numbers and the reasons it looks or feels good.
> Use it as a **technique catalogue and a quality bar**. Re-implement in your own code for your own world; change the numbers to fit your art bible. Short-form names like "Kit", "getShadow", "wave" are descriptive labels, not APIs to import.


Identifier key: `l` = lit particle pool (CPU), `c` = additive particle pool, `u` = tracer ring, `h` = debris, `f` = shells, `p` = decals, `r`/`a` = the two instanced draw batches.

---
## 1. Architecture

**Everything is generated at boot, no asset files.**
- Three procedural texture atlases, drawn with canvas 2D or CPU noise loops into DataTextures:
  - `Bb(128)`: lit-smoke/fire flipbook, 4x2 = 8 frames of 128px. Channels: **RG = billow normal, B = thickness/"core" mask, A = coverage**. Frame 6 is a flame tongue, frame 7 is a hot fireball lobe. Normals are derived from a height field by central differences, so smoke is lit like a sphere with fbm bumps.
  - `Ob(128)`: additive atlas, grayscale, 8 frames: 0 round glow, 1 spark/streak, 2-3 muzzle star bursts (7-10 random petals with exp falloff, seeded), 4 shockwave ring, 5 fire puff, 6 dot, 7 tapered tracer/muzzle cone. Edge is faded (`1 - smoothstep(.86,.99,max(|x|,|y|))`) so mip/atlas bleed is impossible.
  - `Hb(256)`: decal atlas 4x2 drawn on 3 canvases at once: albedo, ORM (G = roughness 0..., B = metalness) and a height canvas that is converted to a normal map by Sobel at the end. Metal bullet hole = dark crater + bent torn petal ring + bright burr flakes + scratches; concrete = pitted crater with chipped rim + radial cracks; wood = splinter fan; scorch; soot; glass star-crack with concentric arcs. Decals are real PBR (MeshStandardMaterial with normal/ORM) so they catch lamp and sun light.
- **Two instanced draw calls for ALL particles**: `fx_lit` (alpha-blended, lit, atlas A, renderOrder 10, cap 1400) and `fx_add` (additive, atlas B, renderOrder 20, cap 3200-160 = 3040 particles + 160 reserved for tracers). `stats.drawCalls` literally returns 5 (lit, add, decals, debris, shells).
- **Particle sim is CPU, SoA** (class `Rf`, ): ~30 parallel `Float32Array`s (pos, vel, age, life, size0/size1, size-curve exponent `sk`, rot, rotv, rgba, drag, grav, wind, turb, seed, fade-in, fade-out, stretch, shade, key, ground-y) plus `Uint8Array`s for frame/mode/flags/ramp. Free-list stack (`free[]`, `freeTop`) gives O(1) emit; an `order[]` compacting list gives O(live) update. `emit` returns -1 when full (silently drops) so overload degrades gracefully. The sim packs a 16-float instance (4 x vec4) per particle into `InstancedBufferAttribute`s and uploads only `addUpdateRange(0, n*4)`.
- **Instance layout** (shader ): `aPos` xyz + size; `aAxis` xyz (stretch vector or plane normal) + roll; `aCol` HDR rgba; `aMisc` = atlas frame, **mode** (0 billboard, 1 velocity-stretched, 2 surface-aligned), age01, shade/sun visibility. One vertex shader serves three particle kinds.
- **Per-particle flags**: `qc` = bounce off ground plane (restitution .25-.55, friction .65), `Xc` = die on ground hit, `GR` = stick. Ground height `gy` is sampled once at spawn by a downward raycast `A` rather than per frame.
- **Colour ramps** (`ramp` byte, ): 1 = ember cooling (R^.5, G^1.4, B^3 as life ends), 2 = fire (heat curve with strong blue/green drop), 3 = flicker (sin(t*17+seed)) for embers/glass glints.
- **Sorting**: only the lit (alpha-blended) pool sorts, far to near, with insertion sort on squared camera distance. Insertion sort works because order is almost sorted frame to frame. Additive pool is unsorted (commutative).
- **Other pools** (non-particle): debris `$1` (256 InstancedMesh jittered cubes with real gravity, 2-bounce-then-rest, scale-out fade over 0.5s, ); shell casings `Z1` (60 instanced lathe-geometry brass casings with quaternion integration, bounce events, rest 4s then shrink, uses material "brass" metal 1 rough .3, ); decals `j1` (160-quad ring-buffer mesh, ); tracers `q1` (48 ring, ). Light flashes come from a pool of 6 PointLights in the renderer (`lightPool.flash(pos, colour, intensity, distance, ttl)`, ): linear decay, steals the oldest non-persistent light when busy.
- **Persistent emitters**: 24 slots, kinds `steam`, `smolder`, `embers`, `fire` (grabs a persistent point light and flickers `14+6sin(23t)+4sin(37.7t)`), `drip`. Each accumulates `acc += dt*rate` and spawns particles into the same pools.
- **API** (return object ): `update(dt)`, `clear`, `muzzleFlash(pos, dir, {scale,color})`, `tracer(a, b, {color,speed,width,intensity,trail})`, `impact(point, normal, surface, dir, enemy)` (also wired to the `impact` event, ), `sparks(pos, dir, n)`, `smoke(pos,{size,life,rise,color,vel,count,alpha})`, `dust(pos, normal, ...)`, `explosion(pos, size)`, `shell(pos, vel)`, `splash(pos, scale)`, `addEmitter(pos, kind,{ttl,scale})`, `debris(pos,{color|mat,size,speed,count,normal,spread})`, `decal(pos, normal, type, size)`, `wind` vector, `stats`.
- **Events in**: `impact`, `player:step`, `player:land` (puddle footfalls); **out**: `shell:bounce` (for audio), `explosion`.
- Light direction is not queried per frame: sun colour/dir, ambient hi/lo are baked into uniforms at creation from the scene's `Mn` (sun) and `en` (sky) constants.

### Shadow/occlusion trick for smoke ("shade")
`m(pos, normal)` raycasts toward the sun (90 m); if blocked, the particle's `shade` = 0.2, else 1. The result is stored per particle and multiplies the sun term only. Smoke in a shadow of a container looks dim, smoke in open sun is bright, with zero shadow-map cost.

---
## 2. Rain

**Streak geometry.** One `InstancedBufferGeometry`, quad with `position.y` 0..1 along the streak. Each instance has a 4-float seed `aSeed`. Count = `9000 * quality.rain` streaks (test .4 = 3600, low .5 = 4500, medium .8 = 7200, high/ultra 1.0 = 9000, floor at .15) plus 260 "eave drips" (seed.w = -1). Splash instances = `900 * rain`. Additive blending, no depth write, renderOrder 900 (rain) / 890 (splash), frustum culling off with a 1e5 bounding sphere.

**Pure-GPU, stateless.** No CPU per-drop update at all. Position is a closed-form function of `uTime`:
```
p = seed.xyz * uBox + vel * uTime          // uBox = (26,15,26) m, vel = (-2.6,-9.4,1.1) * (0.82..1.18) per drop
p = mod(p - camPos + .5*box, box) - .5*box + camPos   // wraps the box around the camera -> infinite rain, zero CPU
len = 0.03 * |vel|  (~0.29 m: exposure-time motion streak, 1/33 s)
```
Wind is just the horizontal part of `uVel` (`wind: p.uVel.value` is exposed so the FX smoke can share it,  uses a separate `t = (-.8,0,.3)` for smoke).

**Culling by degenerate position.** `kill` sends the vertex to clip (2,2,2,1) instead of branching in a CPU list: drops above the density threshold (`fract(w*7.13+x) > uRain`), drops inside interior boxes, and drops below ground (p.y < 0, or < -1.6 beyond the quay x>30 for the sea). Density tiers therefore need no re-allocation, and `rainLevel` eases to the target at `dt*.8`, so rain fades in/out smoothly (set by weather).

**Interior masking.** Up to 4 interior AABBs (`uBoxMin/Max`, grown by .15 on xz and +.3 y, ) kill drops inside buildings, except inside up to 8 "sky" rectangles (skylights, `uSky`, x,z,halfW,halfD) so rain falls through roof openings into the shed. A second "eave drip" line: 260 drops in a line along the shed's south eave, free-fall `y = 7 - 4.9 t^2` with `T=1.19` s cycle, velocity `-9.81t`, turned on only when the level has interiors (`uDrip`).

**Camera-aware width + lighting.**
```
side  = normalize(cross(dir, toP));  w0 = 5..9 mm
w     = max(w0, dist * uPix * 0.75)         // never thinner than 0.75 px
alpha = (w0/w) * smoothstep(.7, 2.6, dist) * (1 - smoothstep(.38,.5, dist/box.x)) * (.55..1 random)
col   = uAmb + uSunCol * HG(dot(viewRay, sunDir))   // Henyey-Greenstein g=0.72, wPhase
```
The 0.75-px minimum plus `w0/w` alpha compensation is why distant streaks are sub-pixel-stable (no shimmer/aliasing) and still carry correct energy. Near fade (0.7-2.6 m) stops streaks slapping the lens; far fade at 38-50% of the box hides the wrap seam. Colour is **forward-scatter lit**: drops glow when you look toward the low sunset sun (HG g .72, strong peak), are nearly invisible with the sun behind you. `uSunCol = sun colour * 1.9`, `uAmb = fog colour * .15`. Fragment: soft-edge across width, taper both ends.

**Ground splashes**:
- 900*rain quads, each cycles every 0.26-0.40 s; each cycle re-hashes a new position (`sHash(seed.xy*91.7 + cycle*.371)`) in a 30 m box snapped to a 4 m grid under the camera; `rr *= .35 + 1.3*|rr|` concentrates density near the player.
- Placement mask: samples the puddle mask texture (`uMask`, same one that renders puddles). On puddles (mask r < .49) all survive, on dry ground only 30% (`k > .3` killed) so the floor looks wet and rain is visible hitting puddles hardest. Killed inside interior boxes. Puddle splashes are larger (`mix(.65,1,pud)`) and brighter.
- Shape (shader `NR`): a small domed crown arc + core flash that fades with life; width grows `sz*(0.7+1.5*life)`, height `sz*(0.4+1.3*sin(life*pi))`, alpha `(1-life)` with distance fade 11-15 m, colour = ambient*1.4 + sun phase*.8.
- Ripple rings on the puddle surface itself are in the ground shader, not here.

**Other rain-related FX**: `player:step` on a puddle/water surface calls `splash(pos, .4 (.55 sprinting))`; `player:land` on puddle calls `splash(.9)`, otherwise (speed > 5) a ring of 6 dust puffs. Thunder event every 30-60 s. Drip emitter: a falling streak with computed fall time `sqrt(2h/g)`; on landing it spawns a surface ring + 3 droplets (the rain "mist/spray" here is limited to these ring/droplet bursts; there is no volumetric rain mist particle).

---
## 3. Combat effects

All colours are HDR linear (values > 1 drive bloom). Timings are particle lifetimes in s.

**Muzzle flash `j`**, scale `V`, default colour (1,.68,.32), flash positions are nudged forward along the barrel:
1. Two star-burst additive billboards (frames 2/3, random of two seeded burst shapes), life **.045 s** and **.035 s**, size .75V -> 1.15V and .5V -> .85V, HDR **34x** colour (22x on the second).
2. White-hot core glow (frame 0): life .045 s, size .13V->.2V, colour 22 * (colour + .25/.3) so it is whiter than the star.
3. Faint soft halo: life .05 s, size .8V -> 1.1V, intensity only .4 (lens-bloom stand-in).
4. One velocity-stretched cone (frame 7) shooting *backwards* (-dir), life .04 s, stretch .9V, HDR 18x: the "jet".
5. 3 fast sparks (speed 8-22, life .08-.22).
6. One lit smoke puff (size .08V -> .45V, life .5-.9 s, alpha .16, slight forward drift).
7. A pooled PointLight: colour 0xFFA860, intensity **16V**, distance 7V, **.05 s**. The player's weapon code adds its own 0xFFB060 flash at intensity **45**, distance 9, .05 s. Enemy shots use 22/7/.05.
Life is under 3 frames at 60 fps and each layer ends at a different moment; this gives the "flickery, never twice the same" look.

**Tracer `G`**: ring of 48, speed default **260 m/s** (120 for enemy red tracers, colour 0xFF3322), width .024, colour (1,.8,.46)*16. Length = clamp(speed*.022, 2, 7) m. Per frame emits 3 instanced quads: a core streak (width x, frame 5), a wide faint halo (6x width, colour *.04 - effectively a lens glow, frame 5 with mode 28 = additive cap), and a bright head dot (5x width, frame 1) at the leading end. First frame advances only `speed*max(dt,.008)*(.35..0.75)` so the tracer does not pop out at the muzzle. Vertex shader caps on-screen width near the lens and enforces min 1.4 px so tracers stay visible far away, with brightness compensated by `comp = size/w`. For long shots (>2 m, at most every .07 s) 5 faint smoke puffs are dropped along the first 7 m ("trail").

**Impact `C(point, normal, surface, dir, enemy)`**. Reflection vector `J1 = reflect(dir, normal)`. Distance LOD: beyond 55 m (`dist^2 > 3025`) spark count is halved and the detail debris is skipped. If the normal faces up and the XZ is a puddle, surface becomes "water". Per surface:
| Surface | Layers |
|---|---|
| **metal** | 18 hot sparks (speed 6-24, life .1-.38, HDR 40/25/10.5, along reflect + .6 normal), 2-3 big bouncing sparks (ground bounce flag, life .7-1.3), a flash glow (frame 0, life .05, size .25-.45, HDR 16/11/5.5), a spark-star burst (frame 2/3, life .04-.35... size .35-.5), a point light 0xFFC070 intensity 10 distance 5 .05 s (rate limited to once per .09 s), 2 grey smoke wisps, 2 tiny steel debris, decal `bullet_metal` (.25 m with petals and burrs) |
| **concrete (default)** | dust cloud `q` (8 puffs speed 1-4.5 + 2 large slow puffs, colour .52,.5,.47, shaded by sun visibility), 4 pebbles/chips, 4 grey fast streaking dust jets (size 3-9 m/s, gravity -6 = upward lift), 30% chance of 3 sparks, decal `bullet_concrete` (.34 m) |
| **wood** | tan dust (.5,.42,.32) + 7 splinter debris (tan .62,.5,.33) + 30% chance of a small flash if sunlit, decal `bullet_wood` fan, decal rotated only +-.15 rad (wood grain direction) |
| **water** | `splash` (below) |
| **dirt/rubber** | 5 coloured puffs (dirt .3,.25,.19), 3 clods, small soot decal |
| **glass** | 12 stretched glints (speed 1.5-6, HDR 2.6 grey-blue, flicker ramp 3), 4 shards, 1 faint puff, `bullet_glass` star-crack decal |
| **enemy** | 13 orange sparks, 2 bouncing, flash glow + star, point light 0xFFA860 intensity 8, 2 very dark smoke wisps, 35% of the 3 chunks are red (.6,.2,.05) |

**Water splash `T`**: 5 upward cone droplets (lit puffs, life .4-.65 s, size .3-.6, strong upward v 1.6-2.8), 2 slow mist puffs (alpha .14, life .7-1.1 s), 14 additive droplets (stretched, fall to the surface and die: `Xc`), colours computed from `shade` so splashes in shadow are darker, and 2 flat surface-aligned rings (mode 2, frame 4 "ring", life .9 and 1.3 s, size growing to 1.5 and 1.0 m, second one fades in slowly).

**Explosion `K(pos, size)`**, size 0.4-4, `P` = size, `Z` = sqrt(P). Everything below happens in the same frame:
- Lights: 0xFFE2B0 intensity **320P**, distance 10+9P, ttl **.08 s** (a lightning-like pop), plus 0xFF8A30 intensity 55P, distance 8+6P, ttl **.45 s** (afterglow).
- Flash (frame 0, life .055 s, size 1.5P -> 2.3P, HDR 16/13.5/9.5), star (life .05 s, size 2.6P -> 4.2P, HDR 7/5/2.4), faint huge halo (life .3 s, size 3.5P->5.5P).
- 13+5P **fire lobes** in the lit pool (alpha-blended, aMisc.w>=2 emissive mode, shade=2+sunVis), size .85P grows to 1.8-2.7P, life .55-1.05 s, colour ramp 2 (hot yellow-white -> orange -> dark red with R^1.5 black-body fade), HDR (5.8,2.4,.5), drag 4 (fast deceleration), buoyancy grav -2.6, turbulence 1.5. Every 4th uses the fireball-lobe frame 7.
- 5 additive "flame tongue" billboards (frame 5) ramp 2, life .3-.55 s.
- 11+5P **smoke** plumes: half fast shell (speed 4.5-9, size to .8P) and half slow body; colour .04-.1 (near black), life **2.8-4.8 s**, alpha .7-.8, big (2.6-4.2P) with a very short fade-in .025 on the fast half; high drag (3.4) then rising (grav -.8..-1.7).
- `X(.. "smolder")` emitter for 1.3+.3P seconds after the blast (dark smoke rising at 9/s).
- 34P (max 90) **sparks** (speed 6-26, life .5-1.5, HDR 40/23/8, drag 1.4, ground-bounce).
- 10P slow **embers** (ramp 3 flicker, upward turbulent).
- If within 1.4P of the ground: a flat **shockwave ring** (frame 4, life .32 s, grows to 9P m), 12+3P flat dust ripples shooting radially at 5-10 m/s, and a big `scorch` decal (2.3P m, alpha .92). Plus 13+6P chunk debris (dark, speed 4-13Z).
- Emits `explosion` event so audio, camera shake and damage can respond. Total 100-250 particles per big explosion; 24 slots of cap headroom.

**Smoke `O` / dust `q` / sparks `H`**: `smoke` spawns `count` (default 3) lit puffs (colour .32,.32,.33, alpha .4, life 2.5 s * .75-1.2, size 0.3P -> 1..1.5P, rise .6) used for weapon heat haze, damaged enemy trails, etc. `sparks` = 12 hot orange sparks with ground bounce + 1 flash glow.

**Shells**: brass lathe mesh .052 m tall (profile of a real 5.56 case, ), spin with random angular velocity, up to 4 bounces with restitution .32-.48, `shell:bounce` event fires on the first two bounces for audio; ground height raycast once at spawn and again after the first bounce; rests flat (euler PI/2) 4 s, shrinks over .7 s.

---
## 4. Soft particles, lighting, blending

- **Soft particles**: both fragment shaders call `softFade`: sample a depth texture, linearise `zs = near*far / ((far-near)*d - far)`, `fade = clamp((particleViewZ - zs) / vSoftD, 0, 1)` with `vSoftD = clamp(size*.4, .04, .7)`. Soft range scales with particle size (a 2.7 m smoke puff fades over .7 m, a spark over .04 m). The depth texture is the main render target's depth (`render.depthTexture`), enabled in `onBeforeRender` only when drawing the main camera (not the viewmodel camera or reflection pass) and can be killed by `?fxsoft=0`. Pixel size is passed as `uPx` (derived from projection matrix and drawing-buffer height) so billboard stretch can enforce a min screen width.
- **Lens fade** `smoothstep(.2,.9,-viewZ)` so a particle that passes through the camera fades rather than pops.
- **Lit particle shading**: smoke is fake-3D. Normal = sphere normal (from billboard offset) *.55 + flipbook billow normal (tangent frame `vT`,`vB` passed per mode). Sun term = wrap-lighting `((N.L + .45)/1.45)^2 * .85` + a back-scatter term `pow(dot(-V, L), 5) * (0.15 + 1.3*thin)` where `thin = 1 - thickness*alpha` (thin edges glow when looking toward the sun, like real smoke). Ambient = hemispheric mix(uAmbLo, uAmbHi, N.y) darkened in thick cores (1 - .35*thickness). Final = color * (amb + sun * shadeFlag). Edge erosion: `smoothstep(age*.45, ... , texAlpha)` so puffs dissolve into wisps as they age.
- **Fire in the lit (alpha) pool**: when aMisc.w >= 1.5 the shader outputs `soot*(amb+sun) + fire` where `fire = color * (.10 + 1.7*core) * (.45 + 1.1*lump)`, `core = thickness^2 * smoothstep(.15,.9,alpha)`. Because the fire is alpha-blended (not additive), overlapping lobes keep their silhouettes and smoke particles drawn in front of them correctly occlude the flame. This is the trick that makes the explosion read as a volumetric fireball instead of a white blob.
- **Blending**: custom pre-multiplied. Lit: src ONE, dst ONE_MINUS_SRC_ALPHA; additive: src ONE, dst ONE. Both set blendSrcAlpha = ZERO, blendDstAlpha = ONE, so the framebuffer alpha channel is left untouched for post; colour is premultiplied in the shader after tonemapping (`rgb *= a`, ). Additive: src ONE dst ONE, with `rgb*k` and alpha 1, so intensity is the HDR colour. Both include `<tonemapping_fragment>`/`<colorspace_fragment>` so the particle HDR range is tonemapped by the same curve as the scene, which is why 34x colours bloom naturally. `fog: false` (fog is a separate post/volumetric pass).
- **Ordering**: additive pass (renderOrder 20) drawn after lit alpha pass (10), so sparks/flashes are on top of smoke. Decals have `renderOrder -5` and polygonOffset -4/-4 plus per-slot height offset `.004 + (slot%7)*3e-4` so overlapping holes never z-fight. When the decal ring wraps, the next 14 oldest fade proportionally so old holes fade instead of popping.

---
## 5. Showcase (`JR`, )
URL param `fxshow` = `all|impact|explosion|tracer`; `fxhold=muzzle` freezes two muzzle flashes (scale 1 and 1.6) for screenshot work; `fxt` pre-simulates N seconds before the first frame; `fxsize` forces explosion size; `fxage` via `window.__setShot` re-simulates an explosion at a fixed 1/60 s stepping to a given age and then freezes it (`G(0)`, flag `C`) so you can inspect e.g. "explosion at t = .25 s" in a deterministic screenshot. Scene: a concrete slab, a blue painted metal sheet and a wood pallet with physics boxes tagged `surface: concrete|metal|wood`; fires 8 bullet types in rotation (concrete, metal, wood, dirt, water puddle, enemy, dirt-rubber, glass-ish) via real `physics.raycast` + the real `impact` event path, with tracers from two muzzle points; ambient emitters (steam, fire, drip) loop; explosions of sizes 1/2/3 every 3.4 s (2.4 s in explosion mode, camera pulled back to z 12.5). It exercises the production code path (events + raycast) rather than a fake.

---
## 6. Why it looks good / feels punchy

1. **Layer count with different lifetimes.** A muzzle flash is 7 layers that die between 35 ms and 900 ms. Impacts have 5-7 layers (flash, spark star, sparks, bouncing sparks, smoke, debris, decal, light). Nothing is "one sprite".
2. **HDR everything.** Flash/spark colours are 16-40x and pass through the scene tonemapper + bloom; cores are whiter than rims (`22*(col+.25/.3)`, ). It reads as bright light, not a yellow sprite.
3. **Light pulses with absurd peak, tiny duration.** Explosion light 320P for .08 s then 55P for .45 s; muzzle 45 for .05 s. The environment visibly flashes (wet ground reflects it) so the blast "hits" the scene.
4. **Cheap fake shadows for particles**: one ray to the sun per effect (`m`, ), stored as `shade` 0.2/1.0. Smoke in shade vs. sun is the single biggest "belongs in the world" cue.
5. **Normal-lit smoke with thin-edge forward scatter**: billboards behave like lit volumes, and back-lit edges glow at sunset.
6. **Alpha-blended fire + soot underlay** so smoke occludes fire and lobes keep form; ramp curves cool white->orange->red->black.
7. **Soft particles with size-scaled depth range** remove intersection lines against containers/ground and let a smoke wall hug geometry.
8. **Surface-specific kits**: different counts, colours, decals, rates and light per material; metal gets sparks+light, concrete dust+chips, wood splinters, water splash, enemy red-orange. Plus a distance LOD (>55 m halves sparks, skips debris).
9. **Decals are first-class PBR** with hand-drawn bent-petal metal holes, torn-edge concrete, and an Sobel-derived normal map, with polygon offset and a fade-out ring buffer.
10. **Stretch quads with min-pixel width + energy compensation** keep tracers, sparks and rain readable at distance without aliasing flicker; tracer first frame is advanced only a fraction so it leaves the muzzle visually.
11. **Physics on the cheap**: drag by `1-exp(-k dt)`, wind coupling per particle, curl-ish sin turbulence, ground flag with restitution, spawn-time ground raycast. Debris and shells are instanced meshes with actual rotation, bounce audio events and 4-5 s rest then shrink.
12. **Rain: stateless GPU, scatter-lit, mask-aware**: wraps a box around the camera, brightness driven by the sun's phase function, splashes only where the ground shader shows puddles, interior AABBs and skylights, plus eave drips. It adds zero CPU cost and quality tiers are just a seed count.
13. **Determinism and debugging hooks**: `fxshow/fxhold/fxt/fxage` let the author screenshot exact frames, which is how this much visual tuning is possible in one autonomous run.

---
## Reusable snippets

**A. Stateless GPU rain (wraps around camera, kill by clip-space)**
```glsl
vec3 vel = uVel * (0.82 + 0.36*seed.w);
vec3 p = seed.xyz*uBox + vel*uTime;
p = mod(p - camPos + .5*uBox, uBox) - .5*uBox + camPos;
vec3 dir = normalize(vel), toP = p - camPos; float d = length(toP);
vec3 side = normalize(cross(dir, toP));
float w = max(w0, d*uPix*.75);                 // >= .75px
vec3 wp = p + dir*(0.03*length(vel)*(pos.y-.5)) + side*w*pos.x;
float a = (w0/w) * smoothstep(.7,2.6,d) * (1.-smoothstep(.38,.5,d/uBox.x));
vCol = uAmb + uSunCol * HG(dot(toP/d, sunDir), g=.72);
gl_Position = kill ? vec4(2.,2.,2.,1.) : proj*view*vec4(wp,1.);
```

**B. Soft particle depth fade (size-scaled)**
```glsl
float d  = texture2D(uDepth, gl_FragCoord.xy/uRes).x;
float zs = (n*f)/((f-n)*d - f);                  // linear view z of scene
float soft = clamp((vViewZ - zs) / clamp(size*.4, .04, .7), 0., 1.);
a *= soft * smoothstep(.2,.9,-vViewZ);           // lens fade
```

**C. Normal-lit billboard smoke with thin-edge scatter**
```glsl
vec3 Ns = q + V*(sqrt(1.-dot(q,q))*.9+.05);          // sphere from quad offset
vec3 Nb = T*tn.x + B*tn.y + V*sqrt(1.-dot(tn,tn));    // flipbook billow normal
vec3 N  = normalize(Ns*.55 + Nb);
float wrap = clamp((dot(N,L)+.45)/1.45,0.,1.);
float back = pow(clamp(dot(-V,L),0.,1.),5.);
float thin = 1. - thick*smoothstep(0.,.5,a);
col = albedo * (mix(ambLo,ambHi,N.y*.5+.5)*(1.-.35*thick)
              + sun*(wrap*wrap*.85 + back*(.15+1.3*thin))*shadeFromRay);
```

**D. Layered, short-lived muzzle/impact recipe (pseudo)**
```
flash(star1: life .045, size .75V->1.15V, HDR 34*col)
flash(star2: life .035, ...)           flash(core: life .045, whiter, 22x)
flash(halo: life .05, intensity .4)    cone stretched backwards, life .04, 18x
3 fast sparks (8-22 m/s, .08-.22 s)    1 smoke puff (.5-.9 s, a=.16)
pointLight(0xFFA860, 16V, dist 7V, ttl .05s)   // linear decay in the light pool
```
