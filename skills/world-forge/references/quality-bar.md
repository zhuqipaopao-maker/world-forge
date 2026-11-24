# Quality bar: what to look for in every screenshot review

Use this when you look at `shots/<iter>/_sheet.png`. Pick the **worst** visible failure, fix it, re-shoot. Do not try to fix ten things at once: one fix per loop keeps cause and effect clear.

Each item says what to check, and why it matters. The numbers come from a study of Saltline and from the world-forge test runs; treat them as starting points, not laws.

**The target, as pictures:** `../assets/reference/` holds review sheets from finished world-forge runs, each scored blind against Saltline in the same round: `street-sheet.jpg` (rainy night street, 7 vs Saltline 6), `metro-sheet.jpg` (metro station, 6 vs Saltline 7), `pine-halt-sheet.jpg` (snowy forest halt, 6 vs Saltline 6). Saltline itself scored 6-7.5 on this scale across rounds. Look at them once before the first review and again whenever you think "this is good enough". Compare *qualities* (value structure, light story, edge highlights, ground detail, density of small parts, atmosphere), not content — your world is not a port.

**Measured budget of that target** (headless Chrome, Apple M4, 1600×900, `high`): ~2.9 M triangles and ~500 draw calls in the gameplay view, ~116 shader programs, 22 fps headless (it runs much faster in a real browser window). So: millions of triangles are fine; draw calls in the hundreds are fine; do not starve the scene of geometry to save performance before `bench` says you must.

## Contents
1. Light and composition (check first: everything else amplifies it)
2. Colour and grade
3. Geometry
4. Materials and surfaces
5. Ground
6. Atmosphere and depth
7. Effects
8. Motion and feel (needs a short clip or several frames)
9. Sound (cannot be screenshot — check the design, ask the user to listen)
10. Robustness and performance
11. How to write the critique

---

## 1. Light and composition
- **One dominant light story.** One key light with a clear direction (often a low sun, 8–20° elevation) and one complementary fill colour (warm key vs cool sky, or cold moon vs warm lamps). If a shot is lit "evenly from everywhere", it will look like a prototype no matter how good the models are.
- **The first view is designed.** The player-start view should be the best composition in the game: a long axis toward a landmark, a light source or bright sky gap near the end of it, foreground detail at 1–3 m, mid-ground shapes, and a silhouette on the horizon. Same view = the title screen = the `start` view.
- **Value structure, measured.** `shot.mjs` prints luma numbers per view. Target (Saltline gameplay): mean ≈ 0.29, p5 ≈ 0.11, p95 ≈ 0.69. Night or horror worlds: mean ≥ 0.12 and p95 ≥ 0.5 (other-worlds §4). Overcast or rainy daylight: mean 0.30–0.38 with p5 ≤ 0.08 (other-worlds §8). Trust the numbers over your impression of 'moody'.
- **Value structure, seen.** Squint at the thumbnail. You should still read 3–4 clear value masses (dark foreground, mid ground, bright sky/light). A flat grey thumbnail means fog, exposure or palette are wrong.
- **Shadows are present and believable.** Contact shadows under objects (no "floating" props), soft penumbra that widens away from the contact point, no acne stripes, no shadow box edge visible.
- **Light sources are visible.** Every light in the scene has a visible emitter (lamp lens, window, screen) that blooms. Unmotivated light reads as fake.

## 2. Colour and grade
- **Restrained palette.** Real-world colours are desaturated and low in value (paint red ≈ #7D2219, blue ≈ #1F3A66). Saturated primaries on large areas look like a toy.
- **Accent colour used sparingly**: objectives, danger, signage. 2–3 accents max, small areas.
- **Tone mapping does the highlight roll-off**, HDR values above 1 exist (sun disc ~100×, lamps 4–30×, flashes 16–40×). If nothing in the frame blooms, emissives are not bright enough.
- **The grade is part of the art direction**: split-tone (cool shadows, warm highlights), slightly lifted blacks, light vignette, fine grain. Each at low strength. If you can *notice* the grade, it is too strong.

## 3. Geometry
- **No unbevelled boxes at player distance.** ~1 cm edge radius on everything the player can walk up to; edges must catch a thin highlight.
- **Real-world scale.** Doors ~2.1 m, eye at 1.6–1.7 m, steps ~0.17 m, containers 2.44 m wide. Take dimensions from a size table.
- **The signature feature is real geometry**, not a normal map (corrugation, roof tiles, planks, bricks at the edges).
- **Second-scale detail**: bolts, hinges, trims, cables, labels at real spacing on every hero prop. Look at the 1–3 m shots: if a surface is a plain plane at that distance, add detail.
- **Imperfection**: nothing identical is identical. ±1–2° yaw, ±1–5 cm offsets, per-instance tint and wear, a few broken/open/ajar variants.
- **Soft things are not boxes**: sandbags, bags, cloth, tarps are deformed with welded normals.

## 4. Materials and surfaces
- **Layered damage, clustered**: base + paint + chips + primer + rust + dirt + streaks + scratches. Damage clustered in zones so most of a surface is clean and some is badly worn (contrast).
- **Roughness varies.** A constant roughness looks plastic. Vary it with noise and with wear.
- **Texel density is uniform** (UVs in metres). Stretched or giant noise blobs = UV scale bug.
- **No visible tiling** at 10–30 m: macro variation (low-frequency world-space noise) over every tiled texture.
- **Ground contact**: every object darker and warmer in the bottom ~20 cm (dirt band), downward faces darker, upward faces slightly brighter.
- **Text that means something**: stencils, IDs, signs with plausible content. One readable label tells the place's story better than any colour.
- **Wet means**: darker + more saturated + glossier + beads, only on surfaces exposed to the sky; streaks on vertical faces, pools on horizontal ones; dry under cover.

## 5. Ground
- The ground is ~40% of most frames. It must hold detail at head height (world-space noise at 3 frequencies, anti-aliased joints and cracks) and must not show texture pixels.
- **Wetness is a gradient**, not a decal: dry → damp → soaked → puddle; roughness from ~0.75 to ~0.05.
- Puddles reflect sharply, wet asphalt reflects blurred and vertically smeared. Lights and the sky should appear in reflections.
- Gameplay agrees with visuals: footsteps splash exactly where puddles are drawn (same data drives both).

## 6. Atmosphere and depth
- **Aerial perspective**: far objects fade toward the horizon colour of *their direction*, not to one flat fog grey.
- **Light shafts / height fog** where the sun or lamps cut through (volumetric or faked), denser near the ground.
- **A backdrop beyond the play area** (skyline, cranes, mountains, ships, trees) built cheaply: low detail, vertex-colour darkened with distance, emissive dots. An empty horizon kills scale.
- Weather fills the air in every outdoor shot (rain streaks, snow, dust motes, mist). Interiors are visibly drier/quieter.

## 7. Effects
- **Layers with different lifetimes** (flash core 35–50 ms, glow, sparks 80–220 ms, smoke 0.5–1 s, decal persists). Never a single sprite.
- **A short, very bright light pulse** with every flash/explosion so the environment reacts.
- Smoke is lit (in sun vs in shade), soft particles have no hard intersection lines.
- Impacts differ by surface (metal sparks, concrete dust, water splash, wood splinters).
- Thin effects (tracers, rain, sparks) keep a minimum width of ~0.75 px and fade alpha instead.

## 8. Motion and feel
Needs a sequence: shoot frames at `?dt=0.016` with increasing `t`, or use `tools/shot.mjs` with several `t=` values.
- Acceleration and friction, not instant velocity. Bob tied to distance walked; landing dip; no bob while still.
- Every action has feedback in several channels in the same frame (sound + shake + light + particle + UI).
- Kicks are impulses into springs (overshoot and settle), not keyframed offsets.
- Enemies telegraph before acting (light, sound, pose) and the player can read and dodge.

## 9. Sound (design check)
- Ambience bed always running, with layers (high hiss, mid, low rumble) and occasional distant one-shots.
- Every gameplay sound has 2–3 layers (transient, body, tail); tail changes indoors/outdoors.
- Master compressor/limiter; music ducks under loud events.
- You cannot hear the result. Say so to the user and ask them to listen at the end.

## 10. Robustness and performance
- `shot.mjs` reports **0 errors** for every view. A loud magenta material = unknown material name.
- `bench.mjs` at `high`: p99 frame time under ~25 ms on the target machine. Draw calls a few hundred at most (merge static geometry by material).
- Quality tiers degrade cost, not composition: `low` should still look like the same game.

## 11. How to write the critique (each loop)
Write three lines into PROGRESS.md before touching code:
```
iter 12 — views: start, cover, overview, interior, fx
worst: ground at 1–3 m reads as flat grey (no wetness gradient, no detail)  [§5]
fix:   add world-noise chips + damp/soaked bands; expect roughness contrast in 'start' and 'cover'
```
After the fix, re-shoot the same views and compare to the previous sheet. If the fix did not show up in the image, it did not happen — find out why before moving on.
