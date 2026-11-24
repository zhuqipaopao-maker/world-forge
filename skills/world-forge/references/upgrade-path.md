# Upgrade path: from the template renderer to a Saltline-class image

The template's `render.js` is a deliberately small baseline (EffectComposer, stock fog, one sun, bloom, grade). Saltline's renderer (see `render-and-materials.md`) is a custom HDR pipeline. You do not need all of it. Climb this ladder **in order**, re-shooting after each rung; stop when the quality bar is met for your world. Each rung says what it buys, how to do it inside the template, and how to verify it.

## Contents
1. Environment lighting from your own sky (PMREM)
2. Height fog with sun glow (patch three's fog chunks)
3. Shadow quality: stable fit, half-rate updates, softer filter
4. Light pool and emissives (no runtime light add/remove)
5. Ambient occlusion
6. Planar or cheap reflections for wet / icy / water surfaces
7. Volumetric light (god rays / lamp cones)
8. Auto-exposure
9. Better tone map and grade
10. Material shader patches (wetness, snow, macro variation)
11. When to leave EffectComposer

---

## 1. Environment lighting from your own sky — biggest single win
Without an environment map, PBR metals and glossy surfaces look black and dead.
- Render the sky dome alone into a scene, then `pmrem.fromScene(skyScene, 0, 0.1, 1000)` and set `scene.environment = rt.texture`. Clamp the sky's HDR (the sun disc) while capturing, e.g. `min(col, 6.0)`, to avoid fireflies in the PMREM.
- `scene.environmentIntensity` ≈ 0.6–2 (three r163+). Lower at night.
- Interiors: capture a second probe with `CubeCamera` (128 px, HalfFloat) inside the room and assign it to interior materials (`material.envMap`), so rooms do not reflect the bright sky.
- Verify: `?show=mats` — metals and glossy spheres show the sky gradient and a sun highlight.

## 2. Height fog with sun glow
Stock `FogExp2` is uniform grey. Real air is denser low down and glows toward the sun.
- Patch `ShaderChunk.fog_fragment` (or per material with `onBeforeCompile`): pass world position in a varying, and compute
  `density(h) = d0 * (0.3 + 0.7 * exp(-h / H))`, `fogF = 1 - exp(-density * dist)`, and
  `fogColor = mix(horizonAway, horizonTowardSun, pow(max(dot(viewDir, sunDir), 0.), 6.))`.
- Keep the sky shader's horizon colours and the fog colours the same source (`art.js`), so far objects melt into the sky gradient of their direction.
- Verify: `overview` shows depth layers getting lighter/warmer toward the sun; luma `p95-p5` stays ≥ 0.3 (fog not too thick).

## 3. Shadow quality
- Fit the shadow camera once to the play area (template default). Spend resolution there: an 80 m area at 4096 is ~2 cm/texel; no cascades needed.
- `renderer.shadowMap.autoUpdate = false`; set `needsUpdate = true` every other frame, and on any scene change (level ready, door opened). Static worlds can update even less.
- `bias` small negative (-0.0001 … -0.0005) plus `normalBias` 0.02–0.04; raise normalBias first if you see acne.
- Softer, contact-hardening shadows: replace `getShadow` in `ShaderChunk.shadowmap_pars_fragment` (receiver-plane bias + Vogel disk + blocker search). Check the chunk layout with `indexOf` before splicing and keep the stock chunk as a fallback (see render-and-materials §3.1).
- Verify: close shot of a prop on the ground — crisp contact, softer away from it, no acne stripes.

## 4. Light pool and emissives
- Never add/remove lights after the first frame (every change recompiles every material). Create a fixed pool (e.g. 6 point lights) at boot; fade intensities; move them where needed.
- Most "lights" should be emissive meshes at HDR intensity (4–30) feeding bloom; only the few that must light surfaces get a real light, and only the key light casts shadows (spot-light shadows are expensive).
- Every real light needs a visible emitter.

## 5. Ambient occlusion
- Cheapest: vertex-colour AO baked in props (contact darkening, valleys) — already in the template's `tint()`.
- Screen-space: three's `GTAOPass` (r160+) or `SAOPass` at half resolution. Apply AO mostly to ambient-lit areas: sunlit pixels should not get dark halos (Saltline fades AO by pixel brightness).
- Verify: corners and contacts darken; no grey halos around objects against the sky.

## 6. Reflections for wet, icy or water surfaces
- `Reflector`-style mirrored camera into a half-resolution render target, sampled by the ground shader with the screen-space UV, blurred by roughness (mip level) and perturbed by the normal map. Render it every frame only if `quality.planar > 0`.
- Cheap alternative: rely on the PMREM environment plus a strong roughness contrast (0.05 in puddles vs 0.75 dry).

## 7. Volumetric light
- Cheap: additive cone meshes under lamps with a soft gradient, fading with view angle and depth (soft particle fade). Good for lamp cones in snow/fog.
- Full: half-res raymarch in a post pass, sampling the real shadow map for sun visibility, Henyey–Greenstein phase, jittered start + bilateral blur (render-and-materials §1.3 "Volumetric fog"). This is the signature of Saltline's look and the most expensive rung.

## 8. Auto-exposure
- Measure log-average luminance from a small mip (or a 1×1 render target), adapt with `1 - exp(-dt / 1.5)`, apply partially: `E = key / avg` raised to ~0.85 and clamped 0.6–2. Interiors stay a bit darker; stepping outside dazzles briefly.
- If you skip it, set exposure per view by hand and check with the luma numbers from `shot.mjs`.

## 9. Tone map and grade
- ACES alone hue-skews bright oranges; AgX alone is flat. Saltline blends 75% ACES (with a 1.3 pre-gain) + 25% AgX. With three you can set `toneMapping = THREE.NoToneMapping` on the renderer and do it in your own final pass.
- Split-tone (cool shadows, warm highlights), slight lifted blacks, grain *after* the grade, 1/255 dither against sky banding.

## 10. Material shader patches
`material.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace('#include <roughnessmap_fragment>', ...) }`
- Set `material.customProgramCacheKey = () => 'wet1'` so all materials with the same patch share one program.
- `Material.clone()` drops `onBeforeCompile` — copy it explicitly (the template's `kit.finish` does).
- Typical patches: world-space macro variation (breaks tiling), wetness (darker + more saturated + glossier on sky-facing surfaces), snow accumulation by `normal.y`, Toksvig-style roughness from normal-map length (stops specular shimmer).

## 11. When to leave EffectComposer
Move to your own pass chain when you need: depth shared between passes (soft particles, fog, AO), half-resolution passes with bilateral upsampling, or a weapon / view-model drawn in a separate depth slice. Pattern: one HalfFloat MSAA render target with a `DepthTexture`, a shared fullscreen triangle, a list of `ShaderMaterial` passes, and a self-test render at boot that falls back to plain forward rendering if any pass fails.
