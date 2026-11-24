# Beyond the port: vegetation, terrain, snow, night, interiors, creatures

The case studies come from one rainy industrial port. This file covers what other worlds need most. These are general techniques, not measured from Saltline. Check every result with screenshots, as always.

## Contents
1. Vegetation (trees, bushes, grass)
2. Terrain
3. Snow and ice
4. Night and low light
5. Interiors
6. Creatures and characters
7. Water other than puddles
8. Overcast and rainy daylight
9. Underground and lit interiors at night (metro, garage, hospital, mall)

---

## 1. Vegetation
Trees decide whether a forest world reads as real or as cardboard. Spend a lot of the time budget here.
- **Silhouette first.** Shoot trees against the sky. A real conifer has a ragged, layered silhouette with gaps you can see light through. A smooth cone, or stacked flat discs, reads as a toy.
- **Build:** a trunk (a tapered tube with bark noise and a slight bend) plus 20–60 branches. Each branch is a few crossed alpha cards ("fronds") with a procedurally drawn needle or leaf texture on a canvas: dense in the middle, sparse at the tips, with a dark interior and lighter tips. Bend the cards down at the tips.
- **Alpha:** use `alphaTest` ≈ 0.4–0.5 together with `alphaToCoverage: true` (when MSAA is on). Use `side: DoubleSide`. Fade the alpha threshold with mip level (as Saltline does for chain-link) so distant trees do not shimmer or thin out.
- **Lighting:** foliage normals point outward from the crown centre (a spherical normal), not along the card normals. Otherwise the cards light up randomly. Add a translucency term (light from behind the leaf brightens the edges) and an occlusion gradient that is dark inside and near the trunk.
- **Variety:** 3–6 tree variants, each built once. Place instances with `InstancedMesh`, with random scale (0.7–1.3), yaw, a lean of ±3° and a colour tint. Mix in dead trees, saplings and broken stumps.
- **Distance:** use full trees near the play area and simpler versions (fewer branches) at 40–100 m. Beyond that use a ring of billboard impostors or a forest-edge silhouette mesh coloured by distance (see the backdrop section in level-ground-backdrop.md).
- **Wind:** a vertex-shader sway whose amplitude grows with height and branch distance from the trunk, with a slow gust term plus a fast flutter. It costs nothing and brings the scene alive.
- **Ground cover:** grass, ferns and snow-covered shrubs as instanced cards near the player only (a radius of 20–30 m), with density from a mask. Ground cover is what removes the "trees standing on a flat plane" look.

## 2. Terrain
- Make a heightfield from fbm noise plus hand-placed shaping: flatten under buildings and paths, raise berms at the edges to close the play area. Expose `level.groundHeight(x, z)` (the template's player reads it) and use the same function for prop placement.
- Blend materials by slope and height (rock on steep slopes, snow or grass on flat ground, mud or dirt on paths), using world-space macro noise.
- Make paths visible: a darker, smoother, slightly sunken strip that leads to the objectives. This guides the player without UI.

## 3. Snow and ice
- **Snow is not white.** Its albedo is about 0.8–0.9, but the colour is defined by light. Shadowed snow takes the sky's blue; sunlit or lamp-lit snow is warm. The shadow side must be clearly blue (cool fill), or the snow reads as grey plaster.
- **Sparkle:** use sparse high-frequency glints (a hash in world space, thresholded) that are visible only near the specular angle and fade with distance by `fwidth`. Keep them subtle.
- **Shape:** snow accumulates on upward faces. A material patch with `smoothstep(0.6, 0.9, worldNormal.y)` mixes in snow. Build snow caps on roofs, rails, branches and fences as real geometry with soft rounded edges (pillows, overhangs, small icicles under the eaves).
- **Ground:** low-frequency drifts (heightfield), wind ripples (anisotropic noise), footprints and tracks (darker, blue-shaded dents), and a snow line against walls.
- **Air:** falling snow uses the stateless camera-wrapped GPU particle approach (fx-weather.md, rain). Use slow, swirling flakes with size variation (soft round sprites, not streaks). In the light of lamps and torches, flakes must glow; this is the signature shot of a snowy night.
- **Ice:** very low roughness, a dark base colour, and a strong environment reflection.

## 4. Night and low light
**Night is not dark pixels.** Game night is a readable blue-hour image with bright accents. Aim for these luma numbers from `shot.mjs`:
- gameplay view mean ≥ 0.12,
- p95 ≥ 0.5 (lamps, lit windows, the moon or sky gap, lit snow),
- p5 ≈ 0.01–0.05 (true blacks only in small areas).

How to get there:
- **Moonlight or sky fill as a real key light:** a cool blue-white directional light at a meaningful intensity. It casts shadows, so shapes still read.
- **Warm practical lights** (lamps, windows, fires) are the warm half of the light story. Each one has a visible emitter, a light pool on the ground, and, in fog, snow or rain, a visible cone.
- **The sky is never black.** Use a deep blue gradient brighter at the horizon, a lit horizon gap, a few stars, and clouds lit from below by town glow if one fits the story.
- **Silhouettes:** place dark shapes against a brighter sky or a lit area. This is how night scenes show depth.
- **Exposure:** raise exposure rather than letting the image sink. Do not crush large areas to black.
- A player torch or flashlight is a spot light with a soft cookie (a canvas texture). It should be the brightest thing in the frame when it is on.

## 5. Interiors
- Use their own environment probe (upgrade-path.md §1) and lower ambient light, so rooms do not glow with sky light.
- Light the room through windows and doors (the sun or sky coming in) plus 1–2 practical lights. A shaft of light through a door or window in dusty air is a strong shot.
- Give the room story clutter: objects that tell who was here (a mug, papers, a coat, a radio, a calendar with a date). Use stencil text and labels as with props.
- Use the room's interior box to switch rain or snow off, add reverb, and remove wetness.

## 6. Creatures and characters
A plain mannequin breaks the illusion faster than anything else. Choose a design the code can deliver.
- **Design for silhouette and a few frames:** in horror, less is more. Show a tall, thin, unnatural shape that is mostly in darkness or fog: wrong proportions (long arms, a small head), a pale face, two eye glints. Short glimpses beat long close-ups.
- **Build:** lathe and tube primitives on a bone hierarchy (THREE.Bone with SkinnedMesh, or parented groups for rigid parts). Use cloth or rags as deformed cards that hang with gravity.
- **Animate in code:** procedural poses driven by springs (audio-feel-ai-flow.md, springs), with idle breathing, a head tilt, sudden stepped motion (lower the update rate of the pose for an uncanny look), and IK-ish foot placement on the ground height.
- **Material:** subsurface-ish skin (wrap lighting plus a reddish tint in thin areas), wet rough cloth, eyes as tiny HDR emissives so they bloom in darkness.
- **Behaviour reads as a character:** telegraph before acting (a sound, a pose change, light flicker), react to the player's light or gaze, and leave traces (footprints, broken branches) before it is first seen.
- **Vehicles** (a train, a car): use real dimensions, a lit interior seen through windows, headlight cones in the air, a rumble and horn in the audio, and camera shake as they pass.

## 7. Water other than puddles
- **Use `lib/water.js` first** (planar mirror + rain rings, puddle mode); see library.md §6. It is what makes a canal or a wet street read as water.
- **Rivers and canals:** use a scrolling normal map from procedural noise in two directions, depth-based colour (shallow is clear and greenish, deep is dark), foam lines where the water meets banks and objects, and reflections (planar or environment map).
- **The sea:** see level-ground-backdrop.md (Gerstner waves, foam from distance, haze).
- **Still ponds:** strong planar reflection, wind ripples in patches, and debris such as leaves or ice floes.

## 8. Overcast and rainy daylight
Learned in test run 3 (江南 water town in the rain, critic 4 → 5/10). The Saltline luma target (mean 0.29) is a sunset; a grey day sits higher. The run fought the numbers and the critic the whole time.
- **Target:** mean 0.30–0.38, p5 ≤ 0.08, p95 0.6–0.75. A grey day is still not a grey picture: the darks come from wet ground, open doorways, under eaves, dark roofs and water. If p5 is above 0.1, the picture is flat.
- **Key and fill:** an overcast sky is a huge soft key from above. Keep a weak directional (sun intensity 1.5–2.5, cool, high, from the brighter part of the sky) for soft shadows under eaves and on one side of each wall. Without it there is no form at all.
- **Water and wet ground are the darkest large areas, not the brightest.** A dark body colour plus a Fresnel reflection: near the camera the water looks down into dark, far away it mirrors the sky. Do not force the reflection everywhere (mixing Fresnel toward 1 makes a canal a white sheet).
- **Haze:** fog must separate depth planes, but the first 10–20 m should keep their contrast: `SKY.fogStart: 10–15`.
- **Old lime walls are not white:** albedo ~0.6, and weathered granite darker still (~0.55). Walls as bright as the sky merge with it.
- **Light the goal:** a warm lantern on the thing the player must reach (the last boat) makes it read from far away through rain.
- **Warm accents:** lanterns, a lit doorway, a red umbrella. In a grey world each warm spot is a focal point; place them where the player should look.
- **Rain must be seen against dark** (doorways, roofs, under eaves) and lit against bright: keep streaks thin and sparse near the camera. Long, bright, dense streaks over the whole screen read as scratches on the lens.
- People in daylight look like mannequins sooner than in the dark: keep them under umbrellas, in doorways, at a distance, or use an external model (external-models.md). Set `eyeGlow: 0` for daytime people.

## 9. Underground and lit interiors at night
Learned in test run 4 (night metro, critic 5 → 4.5 → see PROGRESS). Fluorescent places look fake in two opposite ways: evenly lit (a game level) or murky (a horror cliché). Real photos have bright fixtures, slightly uneven bays, dark corners and reflections everywhere.
- **No sky:** set SKY colours to a dark dust haze, `SUN` = a weak straight-down shadow light (contact shadows under benches and columns), `AMBIENT.ground` > `sky` (the lit floor bounces light onto the ceiling), and capture the environment from inside (`captureEnv`).
- **Fixtures are hero props:** recessed housings, separate tubes, per-tube brightness, one aged green tube, one dead bay, one bay that keeps failing to strike (a flickering pool light under it). Bloom with a lower threshold (~1.1) so the tubes halate the way a phone photo shows them.
- **Light = the light bake** (library, `lib/lightbake.js`): discrete fixtures (1.2 m every 2.4 m, not continuous strips: continuous strips give no pools), wall-washer downlights 0.4-0.5 m off a wall for scallops, emitters 0.1-0.15 m below the ceiling so the ceiling gets hot spots, AO under benches. Carrier: uniform hemisphere + environment probe; 2-4 weak rect lights for sheen. Continuous rect lights alone looked 'flat and even' to the critic four times in a row.
- **Age it on purpose:** replaced panels in a slightly different white, yellowed ones, patched and cracked tiles, missing ceiling slats showing the void, tea-coloured water stains, taped A4 notices on columns, litter, worn tactile strips. A 'new' station is the hardest thing to make look real.
- **Polished floors carry the image:** `lib/gloss.js`, tiles aligned to world 0 (`kit(ctx, seed, { uvOffset: false })`), grime that kills the reflection (gum, edge dirt, mop blotches), one leak with drips and a puddle film.
- **Wear the critic always asks for:** water streaks from ceiling joints, service pipes and cable trays, oil and rust in track beds, litter blown off the platform, boarding markings, wet-floor signs, fire boxes, speakers and smoke detectors on the ceiling.
- **The local script:** Chinese signage is half the realism (station name + pinyin, line colour band, 安全出口, 小心地滑, 上车/下车 arrows). Draw it on canvases with a CJK font stack.
- **People in good light are still mannequins:** keep the figure far away, faceless (no eye dots: two dots read as a cartoon), in a long coat with a cap, and show it close only for a fraction of a second in stuttering light.


## Choosing a world that suits this method (a wrong call in run 5)
In run 5 I chose "a rainy-night fuel station in a forest" as the scene that would show the method at its best, because its rain, wet ground, fog and lamp light are the template's strongest parts. Those parts did score well. But the station scored lowest of all the runs (4-5 vs Saltline 7.5), because the frame is full of **manufactured objects people know exactly**: fuel dispensers, a car, a truck, shelves of packaged goods. Code-built versions of these read as "low-poly game assets" at once, and no amount of wear fixes the big shape.
Before you recommend a world, count what fills the frame:
- **Strong:** weather, light, fog, water, terrain, conifers, rough old architecture (concrete, brick, tiles), simple street furniture.
- **Weak:** vehicles, machines, appliances, packaged products, people up close.
A scene where the weak group is a large part of the frame needs hero models (Tripo / n4d, with the user's OK for credits) from the start. Otherwise pick a scene where the strong group dominates. Say this risk to the user when you recommend.
