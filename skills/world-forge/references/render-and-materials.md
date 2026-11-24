# Case study: Render pipeline, lighting, shadows, post, procedural materials, wetness, quality tiers, physics

> What the Saltline game (Claude Fable 5.2, one autonomous run, Three.js, zero asset files) does in this area, with its numbers and the reasons it looks or feels good.
> Use it as a **technique catalogue and a quality bar**. Re-implement in your own code for your own world; change the numbers to fit your art bible. Short-form names like "Kit", "getShadow", "wave" are descriptive labels, not APIs to import.

Architecture in one sentence: a custom WebGLRenderer pipeline (three.js, NOT EffectComposer) renders the scene into one MSAA half-float HDR target with its own depth texture, then a hand-written chain of fullscreen-triangle passes (half-res AO and volumetric fog, bilateral upsample, motion blur, bloom pyramid, auto-exposure, ACES/AgX grade, FXAA+grain) produces the final image. Every texture is generated on the GPU at load time from GLSL (3 MRT outputs per set) and every material is a stock MeshStandardMaterial patched with `onBeforeCompile`. Zero asset files.

---

## 1. Render pipeline (in order)

### 1.0 Renderer setup
- `WebGLRenderer({antialias:false, powerPreference:"high-performance", alpha:false, depth:true, stencil:false})`. Hardware AA is off on the canvas; MSAA lives on the HDR render target (`samples: quality.msaa`, ).
- `outputColorSpace=SRGB`, but `toneMapping=NoToneMapping` and exposure 1 while the post chain is on: tone mapping happens in the grade shader. Forward fallback switches to `ACESFilmicToneMapping` with exposure `0.6*exposure`.
- `autoClear=false`, `info.autoReset=false` (manual stats), `shadowMap.autoUpdate=false` (the shadow map is refreshed manually, see 2.4).
- Two cameras: world camera (FOV 74, near .08, far 900, layer 0, rotation order YXZ) and a **view-model camera** (FOV 54, near .01, far 10, layer 1) for the weapon. Weapon camera copies the world camera's matrix every frame.

### 1.1 Frame order (`j` )
1. Run registered "pre-passes" (planar reflection renders etc. register through `addPrePass`, wrapped in try/catch, error logged once, ).
2. Bind HDR target `m` (RGBA HalfFloat, depthTexture UnsignedInt, linear filter, MSAA), clear colour+depth only.
3. Refresh shadow map only on even frames (`(frameCount & 1)==0`) unless quality is ultra / screenshot mode: **half-rate shadow updates**. Static level, only dynamic casters change.
4. `render(scene, worldCamera)` with the sky mesh included (sky is a mesh with renderOrder -1000).
5. If some module asked for the depth texture (`depthTexture` getter sets flag E), copy depth to a separate non-MSAA target `depthCopy` through a fullscreen pass that writes `gl_FragDepth`. Needed because a resolved MSAA depth buffer cannot be sampled by materials in the same pass (soft particles, water).
6. **Weapon pass trick**: `gl.depthRange(0, 0.05)` then render scene with the view camera (layer 1 only). The weapon is drawn into the same HDR target but squeezed into the nearest 5% of the depth range, so it always wins the depth test without clearing depth (and the post chain can still tell weapon pixels from world: `d < 0.05` is treated as "weapon / no AO / no fog / no motion blur", constants `n1=Zy="0.05"`, ). `depthRange(0,1)` is restored in a `finally`. During the weapon pass, `scene.environment` is swapped for the interior probe if the camera is inside the shed, and `environmentIntensity` is multiplied by `viewFill 1.35` so the gun doesn't look dead in dark spots.
7. `post.run(...)` (below).

### 1.2 Render targets
| name | format | size | purpose |
|---|---|---|---|
| scene (HDR) | RGBA HalfFloat, MSAA 0/2/4 | full * adaptive scale | main colour + depth texture |
| depthHalf | R Float (if EXT_color_buffer_float) else RGBA half, NEAREST | half | linear view-space z |
| aoA/aoB | RGBA8 NEAREST | half | AO + ping-pong blur |
| volA/volB | RGBA HalfFloat NEAREST | half | fog: rgb = in-scatter, a = transmittance |
| scene2 (`y.scene`) | RGBA HalfFloat | full | composite output (colour * T + inscatter, AO applied) |
| motion | RGBA HalfFloat | full | motion-blur output |
| down[6], up[5] | HalfFloat linear | half, then /2 each level (min 2px) | bloom pyramid |
| streakA/B | HalfFloat | size of down[2] | anamorphic streak |
| adapt[2] | HalfFloat 1x1, ping-pong | 1x1 | auto-exposure luminance (r) + sun visibility (g) |
| dirt | RGBA8 | 512x288 | procedural lens-dirt, rendered once |
| ldr | RGBA8 | full | graded result (alpha = luma for FXAA) |

All post passes are `ShaderMaterial` with a shared 3-vertex fullscreen triangle and an orthographic camera. Each material gets a `// SALTLINE_POST <name>` comment so the shader-error hook can identify the failing pass.

### 1.3 Pass details

**Depth-half**: `texelFetch` at `fragCoord*2` (explicitly *not* a filtered sample: comment says sampling at a texel corner banded the AO on grazing floors). Converts hardware depth to linear z: `z = near*far/(far - d*(far-near))`; weapon pixels (d<.05) get a 0.01 sentinel so every downstream pass can skip them.

**AO**: custom half-res "SAO-like" volume AO, 8/12/16 taps (low/medium/ultra), NOT SSAO from three. Method:
```
P  = viewPos(uv, z0); n = cross(dx,dy) from the closer of left/right and down/up neighbours (hides depth-edge artefacts)
R  = radius * (0.6 + 0.4*clamp(z0/12,0,1))     // radius 0.9m, shrinks up close
rUV = clamp(R / (2*z0*tanHalfY), 3 texels, 0.14)
rot = interleavedGradientNoise(fragCoord)*2pi  // per pixel rotation
for taps: spiral offset (3 turns), v = viewPos(sample) - P
   f = max(R^2 - v.v, 0);  sum += f^3 * max((v.n - (0.015+0.004*z0)) / (v.v + 0.004), 0)
ao = 1 - intensity(1.6) * sum*5 / (R^6 * taps);  fade to 1 between 70 and 140 m
```
Followed by a separable 7-tap **depth-aware** blur (weights drop when |dz| > 4% of z; `BLUR_TOL` define, ), then a bilateral upsample in composite.

**Volumetric fog / god rays, the signature effect**: a half-res raymarch per pixel from camera to scene depth (capped at 170 m, sky capped at 0.55 of that), `VOL_STEPS` 10-40 by quality.
- Step distribution `t = maxD * f * (0.35 + 0.65 f)` (denser near the eye); the start of each step jittered with interleaved gradient noise (`ign`), then bilateral-blurred.
- Extinction `sigma = 0.0034 * shape(y)` with `shape(h) = 0.30 + 0.70*exp(-h/5.5)`: height fog, ground-hugging mist.
- In-scatter = sunRadiance * phase * sunVisibility(p) + ambient. Sun visibility = **look up the real shadow map** at the sample point (decoding the packed RGBA depth by hand, bias 0.0006), so shafts are cast by actual geometry.
- Phase = two-lobe Henyey-Greenstein: `0.55*HG(mu,0.78) + 0.45*HG(mu,0.25)`, clamped <=1.15. Tight lobe = gold glow towards the sun, wide lobe = side-lit shafts still visible.
- Art-direction cheats: `nearW = mix(2.3, 0.55, smoothstep(4,85,dist))` boosts beams near the eye, far field is a restrained veil.
- Interior dust box: if inside the shed AABB (`level.interiorBoxes[0]`), extinction is multiplied by `1 + 6*inBox`, sun scatter weighting goes to 1.6 and sky ambient is cut to 22%, so shafts through doors/louvres read.
- Analytic continuation past 170 m for far geometry (ship, cranes, skyline): closed-form transmittance toward the *horizon colour of that direction*, so far objects melt into the sunset gradient without marching.
- Tuning: `volSunScale .85, volAmbient .2 (x(1+1.5*thunder)), volSigma .0034, volMaxDist 170, volFarHaze .42, volInteriorDust 6`.

**Composite**: for each full-res pixel, joint bilateral upsample of AO and fog from the 4 nearest half-res texels (weight `bilinear * 1/(0.015 + |zHalf-z|/z)`), then
- AO is applied only to **ambient-ish** pixels: `lit = smoothstep(.16,.85, luma(col)*exposure); a = mix(1, ao, strength .95*(1-.8*lit))`. Sunlit surfaces never get dirty halos. Slightly cool occlusion tint `(a, a*, a)` mixed with 3%/7% on G/B.
- Fog: `col = col*T + inscatter`. Applied to the HDR colour before tone mapping, so fog in sun glows.
- Skip entirely for weapon pixels.

**Motion blur**: camera-only, reconstructs world pos from depth, reprojects with previous VP, velocity scaled by shutter = `min(.5, 1/190/dt)` (about a 1/190 s shutter independent of fps), max blur length 1.8% of screen (`vel *= min(1, .018/len)`), 9 jittered taps, taps landing on weapon pixels (depth<.05) get weight 0, <0.75 px blur is skipped.

**Bloom**: 6-level dual-filter pyramid: first downsample is a 13-tap Call-of-Duty/Jimenez filter with **partial Karis average** (weight `1/(1+luma*.08)`) to kill fireflies, inputs clamped to 400; later levels plain; upsample is a 9-tap tent that does `mix(high, low, 0.62)` at each level (energy-conserving, "bloomMix"). Final strength is small and mixed, not added: `col = mix(col, bloom, 0.065)` so it is a haze, not a glow-everything effect. Plus `col += bloom * lensDirt * 0.1`.

**Anamorphic streak**: 15-tap horizontal gaussian on down[2] with a threshold of `2.2 / exposure` (so only the sun, lamps, tracers), run twice at x1.5 and x5 texel spacing; tinted `(0.45,.62,1.0)` blue, strength 0.03.

**Lens dirt**: generated once into a 512x288 target: 70 hash-placed soft discs, fbm smudge, vertical streaks, vignetted weighting. Only visible where bloom is bright.

**Auto-exposure + sun visibility**: 1x1 ping-pong target. Luma log-average of a 7x5 grid sampled from the *smallest bloom mip* (free blur), centre-weighted (`1 - .75*smoothstep(.1,.55,r)`), clamped 0.002-40. Same pass measures **sun visibility**: 12 Vogel taps of radius 1.1% around the sun's screen UV, count the taps whose depth == far (>0.99999) or off-screen. Adaptation rate `1-exp(-dt/1.5)` (tau 1.5 s), visibility rate `1-exp(-dt/.12)`; NaN guards: `if(!(a>0)||a>1e4) a=avg`. Exposure formula: `E = manual * mix(1, clamp((key/avg)^0.85, 0.6, 2.0), auto)` with key 0.12. The exponent 0.85 means exposure only partially compensates, retaining the feel of dark interiors vs bright sky. Bloom threshold in the streak pass is also divided by exposure.

**Grade/tone shader, the "look" pass**, in order:
1. Radial chromatic aberration (`uCA .0013`, `+0.006*damage`), R and B shifted along radial direction scaled by r^2.
2. ADS depth-of-field cheat: periphery mixes toward down[1] (half-blur) by `ads*.75*smoothstep(.22,.85,r2)`.
3. Bloom mix, lens-dirt add, streak add.
4. Sun glare + lens flare, all analytic: veil `0.02/(r^2*9+0.01) + 0.1 exp(-3.2r)`, 3- and 4-fold diffraction spikes `pow(|cos(3 ang)|,24)`, 5 ghost discs along the sun-center axis in teal/orange/blue/gold, and a faint halo ring opposite the sun. Multiplied by the occlusion-tested sun visibility from the adapt pass and by `1+1.5*dirt`. Strength 0.16.
5. Exposure, plus optional additive flash (`uFlash*2.5`).
6. Tone map: `mix(ACES_Hill(c*1.3), AgX(c), 0.25)`. ACES gives "punch and burning oranges", 25% AgX pulls highlights toward white instead of hue-skewing. The AgX is the three.js/Filament fit with a custom "punchy" look: `pow(c, 1.18)` and saturation 1.22 inside the log space.
7. Grade in display-linear: split-tone (shadows `*(0.80,1.01,1.13)` teal, highlights `*(1.07,1.0,0.90)` warm, blended by `smoothstep(.03,.55,luma)`), 22% S-curve, lifted slightly teal blacks `col*.988 + (.006,.0085,.011)`.
8. Gameplay-driven saturation (drops with low health/damage), vignette base .3 (+.55 low health, +.22 ADS), red-edged damage pulse, fade-to-black, manual sRGB encode. Alpha channel = luma for FXAA.

**Final pass**: FXAA-style edge detection using the luma stored in alpha (a 4-neighbour + dirReduce variant, contrast threshold `max(.0312, lMax*.1)`), light unsharp mask (0.3) backed off on strong edges, animated luminance-weighted film grain (0.02; strongest in mid-darks, 30% in highlights, 35% in pure black), and 1/255 triangular dither against banding in sky gradients. Writes to the canvas (`setRenderTarget(null)`).

### 1.4 What is NOT in the chain
No SSR, no TAA, no screen-space GI. Reflections come from the PMREM env map + a per-quality "planar" pre-pass (puddles/windows; implemented in other parts, `quality.planar` 0/.5/1). Rain, volumetric light and bloom do most of the atmosphere.

---

## 2. Lighting

### 2.1 Constants
- Sun: `dir=(.916,.225,.331)` normalized: elevation ~13 deg above the horizon, from the +X (sea/quay) side, color `(1,.72,.42)`, intensity 9.
- Sky palette: zenith `(.055,.085,.13)`, horizon `(.95,.55,.28)`, horizonAway `(.16,.22,.30)`, fog `(.42,.47,.52)`.
- Quay at x=30, sea at y=-1.6, world AABB (-40..40, 0..30, -30..30).

### 2.2 Procedural sky
A single fragment shader on an inside-out box (2x2x2, `gl_Position = p.xyww` so it sits at far plane; fog false, toneMapped false, depthWrite false). Components:
- Shared 256x256 random RGBA8 DataTexture (xorshift, REPEAT, NEAREST) used as value noise via manual smoothstep interpolation: `n2(p)`, `fbm5`, `fbm3`. All cloud noise is texture lookups = cheap.
- `skyToSun(d)`: azimuth proximity to sun `dot(normalize(d.xz),normalize(sunDir.xz))*.5+.5`; `horizonColor` blends: away colour -> warm 1.25x -> `uHor*(1.9,1.55,1.2)` at pow(ts,6) -> hot orange `(1,.6,.24)*3.4` at pow(ts,34): colour gradient only in azimuth, no analytic Rayleigh.
- Mie glow around the sun: 4 stacked power lobes `s^8*.14 + s^64*.55 + s^600*2.2 + s^6000*14`.
- Cloud deck: planar projection `d.xz/(h+.10)`, domain-warped fbm (warp fbm3 shifts the fbm5 lookup by 1.3), rippled underside (ridged fbm3 faded with `smoothstep(.03,.25,h)` to avoid horizon aliasing), coverage `smoothstep(.31,.50, body)`.
- **Art-directed composition**: the deck *ends* above the sun horizon (`edge = mix(.03,.285,pow(ts,1.7))`) leaving a burning gap; a ragged hole `smoothstep(.972,.9985,mu + noise)` guarantees the sun is never hidden by solid cloud; scud drifts in the gap.
- Self-shadowed cloud lighting without raymarching: sample density again offset toward the sun, `relief = clamp((dens - densS)*4.5+.5)`; slate base colour `(.155,.195,.255)` darkening where thick, warm underside `uHor*(1.3,.66,.4) * nearSun * relief^3 * 2.2`, burning rim `cov*(1-cov)*4` near the gap.
- Sheet lightning: `uFlash * pow(dot(d, flashDir),5)` adds blue-white light inside the deck. Random direction per thunder event.
- Aerial perspective on far clouds: blend to `horizon*.55 + cloud*.45` with `exp(-h*11)`.
- Sun disk `disk*110*veil*(1-uEnv)`: HDR 110 so it blooms; excluded from the environment capture (the directional light is the sun there).
- `uEnv` mode: below horizon uses dark ground colour and `col = min(col, 6)` to keep PMREM free of fireflies.

### 2.3 Environment / PMREM / interior probe
- Outdoor env: render the sky material (uEnv=1) into a scene and `PMREMGenerator.fromScene(scene, 0, .1, 100)`. `scene.environment` = result, `environmentIntensity = 2`.
- **Interior probe**: for the shed (first `level.interiorBoxes` entry), a 128px HalfFloat `CubeCamera` placed at the box centre, `y = min.y + min(2.4, 40% of height)`, layer 0 only, rendered with sky in `uEnv` mode and shadow map refreshed, then `pmrem.fromCubemap`. Materials flagged `userData.interior` get `envMap = probe`, `envMapIntensity = 1`. During rendering the weapon camera swaps `scene.environment` to the probe when the player is inside the box (x/z in the AABB and y < max.y), scaling intensity `1/2`. Result: gun and interior reflections go dark inside the shed instead of reflecting the bright sky through the roof.
- 6 pooled PointLights (`distance 12, decay 2`) for muzzle flashes/explosions with ttl and linear fade; `acquire` lets persistent emitters (lamps) claim one. Avoids shader recompiles by never adding/removing lights.

### 2.4 Shadows
- One directional light, `castShadow`, **map 4096 (high/ultra), 2048 (low/medium), 1024 (test)**, clamped to maxTextureSize. `bias -0.00012`, `normalBias .02`, `radius 1`.
- **Fit, not cascades**: `fitShadowCamera` puts the light 200 m from the centre of the world AABB, builds light view matrix, projects the 8 corners of the receiver box (-41..37 x -0.2..32 x -33..31) to light space and sets the ortho frustum (+1 m margin) to the tight bounds; near plane is extended with the caster box corners (ship at -64..72) so tall casters outside the receiver box still cast. Returns frustum width/height/depth in metres, which are **baked into the shader as constants** (`SL_FRUSTUM`, `SL_DEPTH`). The whole 80x62 m port is one map: ~2 cm/texel at 4096 which is why no cascades are needed.
- Shadow map type is `PCFShadowMap` (stock), but its `getShadow` function is **replaced** in `ShaderChunk.shadowmap_pars_fragment` by a PCSS-like filter (see section 3).
- Update policy: `autoUpdate=false`; `needsUpdate = true` every other frame, on level ready, on probe capture.

### 2.5 Fog
No `scene.fog` at all. All fog is the volumetric raymarch plus analytic far-haze, so haze colour is physically linked to sun and sky and respects shadows. `fog:false` on sky.

### 2.6 Exposure
Post chain: `manual (post exposure = 1)` x auto exposure (key .12, clamp .6..2, exponent .85). Fallback: ACES with `0.6*exposure`. Weapon pass is lit with the same exposure since both go into the same HDR buffer.

---

## 3. Shader patching techniques

**3.1 Global ShaderChunk patch (soft shadows)**: `getShadow` replacement spliced between markers in the stock chunk, with a **sanity check**: find indices of `"float getShadow("` and `"vec2 cubeToUV"`, bail out (and log) if the layout changed. Original chunk is saved so it can be restored.
```
function getShadow(map, size, intensity, bias, radius, coord):
  sc = coord.xyz / coord.w; if outside -> 1
  dz = receiver-plane depth gradient from dFdx/dFdy(sc)      // solves 2x2 system
  dz = clamp(dz, +-0.003/texel)                              // never bias > ~0.6 m
  zr = sc.z + bias - (|dz.x|*texel.x + |dz.y|*texel.y)*0.35
  phi = IGN(gl_FragCoord) * 2pi                              // per-pixel rotation
  // blocker search: 8 Vogel taps radius 0.55*radius metres
  avg = mean(d for taps where d < zr + dot(o,dz)); if none -> 1
  // penumbra grows with blocker distance
  pen = clamp((zr-avg)*SL_DEPTH * 0.022 * radius, .012*radius, .60*radius)   // metres
  filt = max(pen/SL_FRUSTUM, texel*1.25)
  lit = mean over 16 Vogel taps: step(zr + dot(o,dz), unpack(depth))
  fade to lit within 2% of the map edge; return mix(1, lit, intensity)
```
Why it looks good: contact-hardening shadows (crisp under containers, soft under tall masts), no acne from slope-scaled receiver-plane bias, no banding because Vogel + IGN noise is temporally stable and cheap, and no visible frustum border. Taps: 16/8 (10/8 on low).

**3.2 Per-material `onBeforeCompile` chunk replacement** (`applyPatch`, ): for every material, string-`replace` the following includes with custom GLSL blocks:
| three chunk | replaced by |
|---|---|
| `#include <common>` (vertex) | varyings `vSlPos` (+triplanar ones) |
| `#include <project_vertex>` | append: world position (or object-space pos + axis vectors for triplanar) |
| `#include <common>` (fragment) | uniforms, value-noise hash `slN3`, helper globals |
| `<map_fragment>` | texture fetch (UV scale or triplanar), macro-variation, wetness, tint mode, alpha-cut |
| `<roughnessmap_fragment>` | roughness from packed ORM.g + macro + wet + beads |
| `<metalnessmap_fragment>` | metalness from ORM.b |
| `<normal_fragment_maps>` | triplanar whiteout normals or wet-attenuated tangent-space normal |
| `<aomap_fragment>` | stock chunk with `texture2D(aoMap, vAoMapUv).r` replaced by cached `slORM.r` (one texture read for AO/rough/metal) |
`material.defines` choose variants (`SL_TINT` 0-3, `SL_TRIPLANAR`, `SL_FX`, `SL_ACUT`), and `customProgramCacheKey` is set to a string of the same flags, so programs are shared across materials with different uniforms. Uniforms live on a per-material object and are shared by reference with the global `wet` uniform.

**3.3 Tint modes** (`SL_TINT`, ): the albedo texture's alpha channel is a *tint mask*, which is what makes one painted-metal texture work for 8 container colours:
- 0 plain multiply.
- 1 `rgb = texRGB + material.color * texA` (paint shows through chips where alpha=0 and the texture holds bare steel/rust, damage layers are texture, base colour is a uniform). Used by all `paint_*`, gunmetal, plastics.
- 2 luma-normalised blend toward material colour (painted concrete keeps concrete shading).
- 3 `diffuseColor *= sample` (glass: alpha is real opacity).

**3.4 Triplanar**: for organic/weapon meshes with bad UVs (`triplanar:true`): weights `pow(|n|,6)` normalized, three samples on yz/xz/xy of the *object-space* position times scale. Normal map blended with a whiteout-style approach and re-based on view-space axes passed from the vertex shader (the `vSlAx/vSlAy` are object x/y axes transformed with skin/instance matrices and modelView). Object-space triplanar means the texture moves with the weapon, not the world.

**3.5 Alpha-tested chain link** (`SL_ACUT`, ): threshold shrinks with mip level (`0.5*exp2(-clamp(lod-1,0,4))`) so wires stay ~1 px, and beyond lod 3.5-5.5 it dissolves into an IGN dither at ~1/3 coverage, with the colour dimmed to 45% for sub-pixel wires (no white sheets in the sun). Solves the notorious fence shimmer.

**3.6 Vertex-colour/UV conventions** in helper geometry: box UVs are generated in *world metres* per face by dropping the dominant normal axis, so a texture `tile` of N metres is consistent on any box regardless of size; `Wi` rounded box (bevelled edges give specular catch-lights, "0.02-0.03 m"); cylinders get circumference-based UVs. Textures are authored with `texture.repeat = 1/tileMetres`, so `UV = metres`.

---

## 4. Materials

### 4.1 Procedural texture generation
Everything is generated **on the GPU at runtime**, lazily per texture *set* (`getSet`, ). One fragment shader per set (`e3` common library + `Tn[fn]` surface function), rendered into a `WebGLRenderTarget` with **3 colour attachments (MRT, GLSL3)**:
- `o0`: albedo (stored `sqrt(rgb)` for 8-bit precision in darks, alpha = tint mask / opacity),
- `o1`: ORM = `(AO, roughness (min .03), metalness)`,
- `o2`: height packed in 16 bit over R+G (`floor(h*255)/255`, fractional remainder).
Then copy passes: albedo is squared back and written to an sRGB-tagged mipmapped target; ORM copied to a linear target; a **Sobel-like 8-neighbour gradient** pass converts the height to a tangent-space normal map: `n = normalize(-gx*K.x, -gy*K.y, 1)` with `K = bump*.001*size/tileMetres`, so bump strength is in physical units. Final textures: RGBA8, REPEAT, trilinear mipmaps, anisotropy min(8, max). Source MRT is freed 4 s after last use (`update`, ).

Sizes: `tex` quality 256 (test) / 512 / 1024 / 2048; each set has a `size` factor (1, .5, .25): hero sets (asphalt, concrete, paint) full, most .5, weapon micro-detail .25. Asphalt on ultra uses 2048. Per-set world `tile` in metres (asphalt 2m, concrete 3m, container paint 2.5m, corrugated [.762,2.286] = real sheet profile, tire [.5,.3], carbon .05 m...).

Noise toolkit in `e3`:
- `pcg3` integer hash (3x uint), seamless: lattice coords wrapped with `mod(cell, period)` so **every noise is exactly tileable at any integer frequency**.
- `gn`: gradient (Perlin) noise with quintic fade; `fbm(uv, freq, octaves, seed)` returns ~0..1; frequency may be anisotropic (`vec2(120,1)` = long streaks, `vec2(2,300)` = brushed lines).
- `vor`: 3x3 Worley-style Voronoi returning F1, F2, cell id randoms: used for aggregate stones, pores, chips, drops, flakes.
- `scr`: randomly oriented straight **scratches** per cell (width, base angle + spread, density).
- Rust: `rustMask` = fbm patches thresholded + grainy high-frequency fbm modulating coverage.
- `OV(color, k)` macro: "overlay layer" - `nt = mix(nt, color, k); ta = mix(ta, 0, k)`, i.e. layer a colour and punch a hole in the tint mask (so painted layers over metal work with tint mode 1).

Recipes (all are **layered damage models**, not one noise):
- **asphalt**: two Voronoi stone layers (freq 110, 230) with random stone colours (grey/tan/brown), jagged edge noise, base tar `(.13)` modulated by fbm, patch wear, tar-sealed crack bands (`|fbm-.5|<.016` narrow isolines, with height flattened and roughness .36), oil stains (darker + roughness .5). Roughness .93 base, .74 on exposed stones.
- **concrete**: big/mid/fine fbm, form-work streaks (anisotropic fbm 2x7), Voronoi pores (70, 260), warped Voronoi F2-F1 hairline cracks, spalled chips exposing aggregate (Voronoi stones), 1 m expansion joints with edge stain (`uv` borders), efflorescence, water-stain patches. Outputs `alpha = paint-patch mask` (so painted concrete tint mode 2 only tints some patches).
- **paint / hazard / armor**: `paintDmg` computes `chip` (vertically stretched Voronoi flakes at 2 scales + wear-band noise + scratches that break up with `sbreak`), `stain` (oxide halo around chips) and `run` (rust runs downhill: sample the chip field at 4 offsets of +0.034 in V and fade, masked by vertical streak noise). `n3` then stacks: chalking, dirt film with fine and broad **vertical wash streaks**, rain-cleaned lighter streaks, rust stain, primer (pale pink grey), bare steel (`rustC`), fresh bright metal. Damage is clustered in zones (`zone = smoothstep(.58,.82,fbm)`) so "most of the panel is clean". Height encodes layers (paint .62, primer .5, steel .36+rust). Metalness: fresh steel .95, rusty steel .15.
- **hull**: riveted/welded plate rows with bead height + ripple, rust weeping streaks down from seams, salt crust.
- **galv, metal, brushed, rust, diamond, corrugated, chainlink, gunmetal, polymer, carbon, fabric, wood, plastic, tarp, cardboard, rope, tire, glass, water, brick, epoxy**: each is 15-30 lines of the same toolkit. Notables: diamond plate = rotated lozenge SDF with height + grime in valleys; corrugated = cosine wave profile (height *and* AO *and* metalness), lap-joint zone + rust at drip end, screw/washer positions every 5th corrugation; chainlink = analytic woven wire (over/under per cell) with alpha; tire = tread grooves (zig, lateral, sipe), sidewall ribs; wood = ring pattern from warped `fract`, knots from Voronoi, saw marks, grey weathering, cracks; epoxy floor = sealer gloss mask, worn traffic lanes, tire marks as sine-curved bands * tread.

### 4.2 Material library
`c3` = texture sets (fn, size factor, tile metres, bump strength, params, seed). `l1` = ~55 named materials = set + tint mode + base colour + roughness/metal multipliers + `wet` vec4 + `macro` vec4. Reuse is by parameterisation: `anodized` is `gunmetal` with `p=[.2], seed 11`; `glass_dirty` is `glass` with p=1 seed 40; all `paint_*` share one set and differ only in `color` (tint 1) and `wet=kc`.

Colours (hex in code, sRGB) e.g. paint_red `0x7D2219`, blue `0x1F3A66`, green `0x2C5E44`, yellow `0xB98A1C`, orange `0xB3481A`: **desaturated, low-value** real-world container colours.

Typical wet vec4 `[darkening, roughMultiplier, exposure(streak) factor, beadAmount]`: concrete `[.42,.38,.5,0]`, painted `[.05,.62,.65,.7]`, metals `[0,.7,.55,.5]`, asphalt `[.45,.3,.5,0]`, epoxy `[.04,.75,.4,0]`. macro vec4 = `[colour variation, roughness variation, world-noise frequency, grime]`.

Material factory (`get`, ): cache key from name+options (vertexColors, triplanar scale, doubleSide, interior, colour override). Creates `MeshStandardMaterial` with `map`, `normalMap`, and **the same ORM texture assigned to roughness, metalness and ao maps** (patched so it is read once). Glass: `transparent`, `depthWrite=false`, `envMapIntensity 1.4`. If texture generation throws, **fallback** to a flat grey `MeshStandardMaterial` and log once.

Emissives are `MeshBasicMaterial` with `color * intensity` (4-30 in code): HDR colours feeding bloom (e.g. lamp 14, red beacon 30), `toneMapped:true`.

### 4.3 Wetness, puddles, rain streaks on surfaces
All in the `<map_fragment>` replacement; driven by a single global `uSlWet` (0..1, tuned by `?wet=`), per-material `uSlWetP` and `uSlX.x` (interior materials only .12 wet, ).
```
macroNoise  = 3D value noise at worldPos*freq (two octaves)   // breaks up tiling
albedo *= 1 + macroVar * (macro-.5)*2;   grime blotches darken (35%)
up     = smoothstep(.15,.85, worldNormal.y);  exposure = smoothstep(-.4,-.05, worldNormal.y)   // undersides stay dry
streak = N3(x+z along a diagonal, y*.55) * N3(finer) -> thresholded, masked by a slow noise   // vertical run-off, non-triplanar only
wetK   = wet*exposure * mix(wetP.z*(.55+.9*streak), .75+.5*macro, up)  // vertical: streaky, horizontal: broad pools
wetK  += low band (y<.5, vertical faces) * .6                           // splash zone at the base of walls
albedo: gain saturation +25%*wetK*wetP.x*2 then *= (1 - wetP.x*wetK)     // wet = darker AND more saturated
rough  = mix(rough, rough*wetP.y, wetK)                                  // wet = glossier
bead   = 3D noise at 170/410 cycles/m thresholded -> water droplets; rough -> .05;  fades with fwidth(pos)*120 so no sparkle at distance
normal strength *= (1 - .45*wetK*up)                                     // water fills micro bumps on horizontal faces
roughness += macro rough variation; tiny-normal-length trick: rough = sqrt(r^2 + (1-|n|)*.6)   // Toksvig-style specular antialiasing from normal map mip shortening
```
The Toksvig line is a key anti-shimmer technique: when the normal map mips average toward zero length, roughness is increased so specular doesn't sparkle.

Puddles on the ground themselves are in the ground module (not in these parts: `ground.wetness(x,z)`, `isPuddle`, see stub at ) and use the `quality.planar` reflection pre-pass. Rain itself is in FX (quality.rain 0.4-1).

### 4.4 Decals
- **Canvas 2D** generation (not GPU): ~20 named decals (hazard signs, arrows, shipping-line logos with custom stencil text, "BERTH 4", caution stripes, grime streak, rust run, oil stain, leak stain, bullet holes on metal/concrete, scorch, crack, graffiti tag, CSC plate with fake legal text, digits 0-9).
- Each is a `MeshStandardMaterial` with `map` (sRGB, mipmaps, anisotropy 4), `transparent`, `depthWrite=false`, **`polygonOffsetFactor -2, Units -2`** (kills z-fighting on the wall), roughness/metalness per decal.
- Universal look tools: `Ks` **distress function** erases the art with `destination-out`: random polygonal chips (`ra` = jittered-radius polygon), long thin scratches, 1-2 px speckle, and large soft radial gradients; the amount param (0.25-0.6) controls wear. `bleed` fills the canvas at 1.2% alpha with the decal colour so mip-mapped edges don't halo against dark backgrounds (premultiplied-alpha fringe fix, ).
- `qa` stencil text: letters drawn in a font stack (Big Shoulders Display / Barlow Condensed / IBM Plex Mono, fallbacks to Arial Narrow/Impact), measured, scaled to fit, with **stencil bridges** (vertical gap cut in the middle of each glyph, `destination-out`) except for narrow glyphs.
- Fonts load async; `document.fonts.load` -> re-run the text decals after 120 ms and set `needsUpdate`.
- Dynamic runtime labels (`label(text,{color,distress,font})`, cached by key), numbers via UV offset in a 0-9 atlas (`repeat .1`).
- `decal(name)` of unknown name falls back to `grime_streak` and warns once.

---

## 5. Quality tiers, adaptive quality, fallbacks

### 5.1 Tiers
| | scale | MSAA | shadow | tex | volSteps | AO | planar | motionBlur | rain |
|---|---|---|---|---|---|---|---|---|---|
| test | 1 | 0 | 1024 | 256 | 10 | yes | .5 | no | .4 |
| low | .7 | 0 | 2048 | 512 | 12 | no | 0 | no | .5 |
| medium | .85 | 2 | 2048 | 1024 | 16 | yes | .5 | no | .8 |
| high | 1 | 4 | 4096 | 1024 | 24 | yes | .5 | yes | 1 |
| ultra | 1 | 4 | 4096 | 2048 | 40 | yes | 1 | yes | 1 |
Additional derived: AO taps 8/12/16, soft-shadow taps 10 or 16, pixel budget cap per tier (`low 1.0 MP, medium 1.5, high 2.3, ultra 3.7 MP`, ) that downscales the internal resolution by `sqrt(budget/pixels)` on big/retina displays; DPR capped at 2.

### 5.2 Auto-detect
`?quality=` param, else mobile UA / small touch device -> low; else read `WEBGL_debug_renderer_info` from a throwaway context (and `WEBGL_lose_context` it), software GL or integrated-class strings (`SwiftShader|llvmpipe|Software|Mali|Adreno|PowerVR|Intel(non-Arc)`) -> medium, else high.

### 5.3 Dynamic resolution
Frame-time average over >=45 frames (or 900 ms): >21.5 ms -> scale down by .1 (or .2 if >30 ms, straight to .6 if >45), upscale +.1 after <17.4 ms and a cooldown `upWait`, with exponential back-off (`upDelay` doubles up to 60 s) to prevent oscillation. Floors at .6; after two consecutive floor hits with >26 ms, **drops a whole quality tier** (ultra->high->medium->low) and emits `quality:auto`. Ignores frames >1500 ms (tab switches), 3.5 s settle after level load / quality change. Scale changes call `resize` which rebuilds RT sizes only (cheap).

### 5.4 Self test & fallback chain
- `debug.onShaderError` classifies which program failed via marker comments in the source (`SALTLINE_POST name`, `SALTLINE_SKY`, `SALTLINE_SHADOW`) and sets flags.
- At boot a unit cube is rendered once with the full pipeline in try/catch. If a post shader fails -> `advanced=false` -> forward rendering with built-in ACES tone mapping. If the *soft shadow chunk* is flagged by the driver -> restore stock chunk, `PCFSoftShadowMap`, `radius 2`, re-run the test with fresh materials.
- At runtime any exception in the post pipeline (try/catch around `j`) permanently falls back to forward rendering and logs once, restoring `depthRange(0,1)` and the render target.
- `compileAsync` of the scene against the HDR target on level ready (avoids first-frame hitches), also compiles with the interior env to pre-build both program variants.
- A `dr` table of stub modules so the game boots with any module missing/failed.

---

## 6. Physics

Deliberately simple, deterministic, allocation-light. No physics engine.
- **World = list of AABBs** (`boxes`), each with `surface` (footstep/impact material: concrete, metal, wood...), `tag`, and flags `noNav`, `bulletOnly`, `playerOnly`. Props register boxes (`PROP_SIZES` table gives each prop a footprint + visual material + surface type, ). Ground plane at y=0 for x <= quayX(30), sea at y=-1.6 beyond (so the quay edge is a drop into water: falling off = "water" surface).
- **Raycast**: ray vs ground/sea plane first, then slab test per AABB with face normal reconstruction (axis + sign), returns `{dist, point, normal, surface, box}`; `lineOfSight` = `!raycast(a, dir, len-.05)`. Linear scan over all boxes (OK for hundreds). `playerOnly` boxes are skipped by rays (invisible player walls).
- **Character capsule vs boxes** (`moveCapsule`, ):
  1. Horizontal: split movement into substeps of `<= 0.6*radius`, so no tunnelling.
  2. Per substep up to 3 resolve iterations: for each box overlapping the capsule's vertical extent (boxes whose top is below feet+stepHeight (0.42 m) or bottom above head are ignored: free **step-up**), find closest point on box rectangle to the XZ centre, push out along that direction by `r - dist`, and remove the velocity component into the wall (so you slide). Degenerate case (centre inside box) pushes out along the smallest-penetration axis.
  3. Vertical afterwards: find ground = highest box top <= feet+step within the capsule's footprint (shrunk to 0.7 r) and ceiling = lowest box bottom above the head; resolve ceiling hit, landing, and **ground snapping** when descending less than step height (stairs/curbs, no hopping) -> returns `{onGround, hitWall, hitCeil, surface}`.
  4. Quay edge: ground exists only for `x <= quayX + 0.7r`; beyond is -50.
- **Nav**: 0.5 m grid over the world rect from boxes (inflated by 0.5 m, skipping low/high/noNav boxes), A* with octile heuristic, binary heap with parallel arrays and **generation counters** (`g`) instead of clearing arrays, 9000-node cap, corner-cutting prevented, **string-pulling** (greedy line-of-sight shortcuts with a Bresenham grid test), nearest-free-cell snap for blocked endpoints (ring search up to 12), random point sampling. Rebuilt lazily when the box list is dirty.

---

## 7. Why it looks good: the 14 decisions that matter

1. **A strong, art-directed single light situation**: low sun (13 deg) + intense (9) + saturated gold against a cold slate deck, with the cloud gap composed on purpose. The sky shader encodes composition rules (hole at the sun, deck edge, rim light), not physical correctness. Fix colour contrast first; everything else amplifies it.
2. **Volumetric light shafts that read the actual shadow map**: shadow-tested raymarch at half res with IGN jitter + bilateral blur. This single pass supplies fog, depth cues, god rays and atmospheric perspective. Plus near-eye boost and analytic far continuation.
3. **HDR everything, tone map late**: half-float target, emissives at 4-30x, sun disk 110x, flare, bloom via Karis-averaged pyramid with only 6.5% mix. Highlights roll off through a 75/25 ACES+AgX blend instead of clipping.
4. **Split-tone grade + lifted teal blacks + vignette**: teal shadows / amber highlights is the cinematic complementary pair; the grade is part of the art direction, not a toggle.
5. **Auto-exposure with partial compensation (^0.85) and a centre-weighted log average**, plus sun visibility test for flare occlusion. Eyes adapt coming out of the shed.
6. **Contact-hardening soft shadows with receiver-plane bias and tight fitted frustum**: kills acne and adds believable penumbra; the shadow resolution is spent where the action is.
7. **Compositional AO that is faded on sunlit pixels**: avoids dirty halos, stays only in ambient-lit regions; depth-aware blur and bilateral upsample keep edges clean at half-res cost.
8. **Material authoring as layered damage with a physical-unit pipeline**: every surface has paint, chips, primer, rust, dirt, streak wash, scratches; metres-per-tile are real; bump strength is in tile-relative units; ORM packing; roughness is *varied by noise* not constant. Damage is clustered (zones), so surfaces have clean areas and dirty areas (contrast).
9. **Tint-mask albedo alpha**: one texture, many colours, with chips revealing bare metal in true colour.
10. **Rain-wet shading as a physical model**: darker + more saturated + glossier + droplet beads, scaled by surface orientation and exposure, streaks on verticals, splash band at the base. Wet roughness is what makes the env map/sun glints appear.
11. **Real reflections for the sunset**: env PMREM of the same sky at intensity 2, `glass` envMapIntensity 1.4; interior probe so dark rooms stay dark.
12. **Specular antialiasing and mip-correct alpha tests**: Toksvig-style roughness, chainlink mip-threshold plus dither, bead fade by `fwidth`, `bleed` in decals. The image is stable in motion, which is what high end games feel like.
13. **Cheap but cinematic camera**: dirt masks bloom, anamorphic streak (blue), 5-ghost flare with occlusion test, 0.13% CA, grain luminance-weighted, dither, sharpen. Each at low strength, with the damage/ADS states reusing the same pass.
14. **Geometry hygiene**: beveled boxes (`Wi`, ) for specular edge catch-lights; world-metre box UVs; `mergeGeometry` per material so draw calls stay low and the instanced content count is high.
15. **Weapon rendered in a separate camera and depth slice**: no clipping, separate FOV 54, boosted env fill 1.35, own probe.

---

## 8. Pitfalls and defensive code worth copying

- **Shader failures must be survivable**: marker comments in every custom shader, `onShaderError` to classify, self-test render at boot, runtime try/catch fallback to forward pipeline.
- **Patching the ShaderChunk is brittle across three.js versions**: verify chunk layout with `indexOf`, keep the original for restore, fall back to stock PCFSoft on any doubt.
- **Depth texture + MSAA**: never read the MSAA depth in the same pass; copy depth into a non-MSAA RT. `EXT_color_buffer_float` is probed with an RGBA half fallback for the half-res depth.
- **`texelFetch` for depth downsample** (not bilinear), to avoid banding.
- **NaN/Inf guards**: adapt luminance `!(a>0) || a>1e4`, visibility `!(v>=0)`, bloom input clamped to 400, `max(col,0)` after fog, `min(col, 6)` for env capture, `Number.isFinite(post.saturation)`, `max(pc.w,1e-4)` in reprojection, AO denominators `+.004`.
- **Interleaved gradient noise instead of blue-noise textures**; same function reused in shadows, AO, volumetrics, dither, so no extra assets.
- **depthRange for the weapon pass must be restored in `finally`**, as must scene.environment/intensity.
- **No light add/remove at runtime** (would recompile every shader): fixed 6-light pool with intensities faded.
- **Tab hiccups**: frame deltas >1.5 s ignored by dynamic resolution; settle windows after load.
- **Software GL / mobile detection** by renderer string and conservative default of medium for integrated Intel.
- **Procedural textures generated only when requested** (lazy `getSet`), memory accounted (`bytes`), source MRTs disposed after 4 s idle; texture-set failure -> flat grey material fallback.
- **Async fonts** for canvas text: rebuild text decals after `document.fonts.load` resolves.
- **Program cache keys** set manually on patched materials so one patched shader serves all instances, and defines rather than uniforms for static branches.
- **Interior wetness is reduced to 12%** because there is no rain indoors: per-material exposure uniform, not a global hack.
- **Pixel budget cap** per tier on large/hi-DPI displays: protects fill-rate heavy post chain.
- **Shadow map `autoUpdate=false` and half-rate updates** to hit budget; requires manual `needsUpdate` after any context-changing event (level ready, probe capture, quality change which also disposes the map).
