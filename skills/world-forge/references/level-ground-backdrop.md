# Case study: Level layout, cover/spawns, backdrop beyond the play area, wet ground and puddles, planar reflection, sea, rain integration

> What the Saltline game (Claude Fable 5.2, one autonomous run, Three.js, zero asset files) does in this area, with its numbers and the reasons it looks or feels good.
> Use it as a **technique catalogue and a quality bar**. Re-implement in your own code for your own world; change the numbers to fit your art bible. Short-form names like "Kit", "getShadow", "wave" are descriptive labels, not APIs to import.

---------------------------------------------------------------------
## 1. LEVEL: how the layout is authored

### 1.1 Authoring style: a tiny "builder DSL" plus hand-placed coordinates
There is no grid, no tilemap, no JSON level file. The level is a long list of hand-typed function calls with literal world coordinates, written on top of a small set of builder helpers:

- `box/slab/cyl/rod/tube/ibeam/quad/decal/label` build primitive geometry into a `level-static` group. `slab(mat, x0,y0,z0, x1,y1,z1)` takes two corners, so walls and floors are written as "from here to there" ranges. Many boxes get a 1-4 cm `bevel` (RoundedBox) so edges catch the light.
- `place(propName, x, z, yaw, opts, y)` instantiates a prop from a separate props library (`i.props.build`), adds it to static or dynamic root, and records `{name,x,y,z,yaw}` in `placed`. The level never knows how a barrel is modelled; it only says where it stands.
- `col(...)` / `i.physics.addBox` registers an AABB collider with a `surface` tag ("metal", "concrete", "wood", "rubber"). Props carry their own collider list in `userData.colliders`; `M` transforms them to world space. If the prop yaw is not axis aligned (`|sin 2yaw| > .2`) the AABB would over-block, so the box is sliced along its long axis into up to 10 pieces and each piece is shrunk 7 percent. Boxes lower than 20 cm and below 30 cm high are dropped (do not trip the player on pallets' feet). This is a cheap, good trick: rotated props get AABB colliders that still feel fair.
- `stack(x, z, [[size,colour,opts],...])` builds a column of shipping containers: sizes 20 ft = 6.06 m, 40 ft = 12.19 m, "hc" = 2.9 m tall (others 2.59 m); each container gets a random yaw jitter of about +-1.3 degrees (0.022 rad) and +-5 cm position jitter, random `wear`, seed, optional `doors` open fraction, `reefer` unit, or `flip`. It stacks vertically (adds heights) and records a footprint rectangle in `metalRects` so the footstep system knows it is metal. One helper call yields a convincing, slightly crooked stack.
- `rv(...)` is a shortcut that adds a collider matching a rotated hand-built prop footprint.

Composition is decomposed into sub-builders called in order from `C1`: `hR` (yard rows plus clutter), `fR` (west gate), `ab` (the shed / warehouse), `cb` (the quay). Each returns a few data points (relay position, extraction position, skylight rectangles, lights).

### 1.2 Play-space size and zones
Four zone rectangles (used for spawn grouping, UI labels, audio probably):

| zone | x range | z range |
|---|---|---|
| gate | -40..-24 | -30..30 |
| yard | -24..16 | -10..30 |
| shed | -24..16 | -30..-10 |
| quay | 16..40 | -30..30 |

So the whole arena is about 70 m (x) by 60 m (z), about 4000 m2, with the world edge fenced, z=-30, z=28, each fence also gets a second invisible `playerOnly` 7 m-high collider so the player cannot jump or climb over, while bullets pass through the visual 2.4 m collider). Fence panels are scaled in x so an arbitrary segment length is tiled with ~3.35 m panels.

Player start: `(-32, 0, 6)`, yaw -PI/2 (looking +x down the main avenue from the gate).

### 1.3 Rough ASCII map (top view, x to the right, z down; 1 char = ~1.7 m wide, ~3 m tall)

```
 x:-40   -24          -12            0            12  16    28 30   40
 z-30 +---+-------------------------------------------+-----+---+
      |   |   SHED  (x -16..12, z -28..-11; roof 7..9.5 m)  |  QUAY  : crane rails x=18.5, 28.5
      | G |  catwalk office (-15..-10,-24..-10, h 2.6)      |  reefer stacks, light masts
 z-10 | A |  RelayB(-2,-19.5) shelf racks, 4 PointLights    |  generator, floodlight
      | T +---------------+----+--------------------------+  |
 z  0 | E   container rows (z=-5, 2, 10, 12, 20, 22)         | RelayC(23,0)
      |  S>  AVENUE z 3.6..8.4 (red edge lines, green        |  jersey barriers, forklift
 z  6 |  START (-32,6) ------> RelayA(1.5,7.5) ------>      | |  mooring bollards x=29.2
      | booth,gate arm  rows 9.9/12.4 w/ stairs+roof (13.5,  | |
 z 14 |  LANE 3 sign    2.59,12.4) = vantage; stairs (-.1,12.4)|  Ka/Qa trucks, tarp cargo
 z 20 |                 rows 20.1/22.6 (40ft x2, hc)          |  EXTRACT (29,0,20) r=2.5 --> ladder
 z 28 +-------------------------------------------------+----+  z=20 over RIB boat (31.5,-1.6,21)
 sea  (x>30, y=-1.6)  moored ship KITTIWAKE x 33..49, z -9..-72;  crane boom reaches x~62
```

The critical structure: a long 5 m wide central avenue (z 3.6..8.4, with red edge lines and a green dashed centre line painted in the marks texture) running from the gate straight to the quay; two container-row "walls" north and south of it with deliberate gaps (x about -9 and x about 5..9) as cross lanes; a shed to the north (the only roofed interior); the quay on the east as an open final area. The player is funnelled by sightline length: from the gate the avenue is ~60 m long, so you see the crane and the sea at the end before you can be shot (the level's `showcase` shot is exactly this view).

### 1.4 Objectives, spawns, cinematic path
- Three relays, one per zone, deliberately increasing in exposure: `relay_a` Yard (1.5, 0, 7.5) in the open avenue; `relay_b` Shed (-2, 0.03, -19.5) inside the building (the shed floor is raised 3 cm, `no.FLOOR=.03`); `relay_c` Quay (23, 0, 0) beside the crane rail. Each objective object is a `relay_node` prop placed with `place(...)`; after merging, the prop's children are stripped and re-parented to `dynRoot` so it can animate/change state independently of the merged static mesh.
- Extraction: `{pos (29,0,20), radius 2.5}`; it sits at the quay ladder (`lb.LADDER_Z = 20`) with the RIB boat (backdrop module) moored below at (31.5, -1.6, 21). The ladder, yellow ladder rails, mooring bollards every ~10 m (z = -22,-12,-2,9,16.4,25.6) and a rubber fender strip make the landmark readable.
- Enemy spawns: 3 lists in one array `y`, each `{pos, zone, type:"ground"|"air"}`. Counts: yard 10 ground + 6 air; shed 8 ground + 5 air; quay 7 ground + 6 air. "air" entries have y between 5 and 13 (drone-like units flying above the container tops, sheds eaves, quay crane); ground spawns sit in alleys, behind cover, deliberately away from the relay (e.g. yard ground spawns at (-19,-1.4), (3.5,-1.6), (14.2,16.4), (6,26)...). All ground spawn points are post-processed by `E`: if the nav grid says the point is not walkable, search 8 directions at radii .5, 1, 1.5, 2 m and snap to the first walkable point. Authors can type rough coordinates and still never spawn an enemy inside a crate.
- `coverPoints`: ~55 hand-listed `Vector3` positions beside barriers, crates and container ends, also nav-snapped. The AI uses them to pick cover; there is no automated cover-point generation.
- `interiorBoxes`: one AABB for the shed `{min(-16,0,-28), max(12, 9.5, -11)}`. Consumers: rain (kill drops inside), puddle logic (no puddles inside), wetness (0.12 inside), audio reverb presumably.
- `skylights` (list of leak holes in the roof, `{x,y,z,w,d}`) and `shedLights` are exported so rain can fall through the holes and the lights can be dimmed/flickered by other systems. `vantage` = stairs foot and a container-roof sniper position (13.5, 2.59, 12.4) reachable via stairs, a designed "high ground" for the player.
- `cinematicPath`: 12 keyframes `{pos, look}`, eye height 1.3-2.5 m, that walk gate -> avenue -> yard -> shed -> quay -> ladder. Used by the title/intro camera; because it is data, the same tour doubles as a smoke test of lighting in every zone.
- `stats`: tris, props, containers, labels atlased; printed so the author can keep a triangle/draw-call budget.

### 1.5 The shed, the one detailed interior
Defined by a data block: `no = {X0:-16, X1:12, Z0:-28, Z1:-11, EAVE:7, RIDGE:9.5, ZR:-19.5, FLOOR:.03}`, bay columns `No = [-16,-11.1,-6.2,-.8,5.6,12]`, a main door `yt {x -6..-1, h 5}` on the south wall and a roller opening `Yt {z -22..-17, h 4.5}` on the east wall. Walls are generated by `D/C` which writes wall strips with a concrete plinth below 1.2 m and corrugated-roof-material cladding above, with louvre windows (`G/j`) per bay between 5.45 and 6.8 m height. A gabled roof is 2 sides x 4 purlin bands x 20 panels; 8 panels are removed on purpose (`iv` list: `["S",1,4], ...`), leaving holes with `leak_stain` decals underneath and exporting the holes as `skylights` so rain really falls into the shed there and the view up shows sky (nice sky bounce). Trusses (I-beams via `ibeam`), tie rods, a rotating extractor fan, 4 pendant lamp heads + 4 PointLights and mezzanine office with catwalk and stairs close the space. All of this is plain box arithmetic, but the density (rivets, hazard stripes, cable runs via `Lr` tubes with sag noise, labels, stencil text) is what makes the walls feel real.

### 1.6 Performance architecture of the level
After building, everything under `level-static` is merged (`By`, a merge-by-material utility) into a few meshes (`level-merged`). Before merging:
1. Meshes flagged `userData.noMerge` (animated parts, relays, fan) are moved to `dynRoot`.
2. Materials are swapped for their `vertexColors:true` variants (`i.mats.get(name,{vertexColors:true})`) so per-prop colour variation is baked into vertex colours and still merges. 
3. A **label atlas** (`rb`): every unique stencil/label canvas texture is packed into one 2048-wide canvas atlas with 4 px padding (sorted by height, half-scale), UVs remapped per mesh clone, so all text labels share one material and merge. It re-uploads only if a source texture version changes (e.g. after the font loads), polled during the first 8 s.
4. Shadow flags are set once per mesh (cast unless transparent/basic).

`groundSurfaceAt(x,z)` = `isMetal(x,z) ? "metal" : "concrete"`, where `isMetal` tests the `metalRects` footprint list (container stacks, stairs, catwalks, steel platforms). Footstep surface is therefore an O(rects) list scan, no raycast. Elevation changes of surface type (container roof) are handled because `stack` and `catwalk` push their own rectangles.

### 1.7 Quay module
`lb = {X:30, LADDER_Z:20, RAILS:[18.5,28.5], Z0:-30, Z1:28}`. The quay slab (concrete with yellow edge stripe, steel edge angle), the vertical quay wall with rust-run decals every 6 m, the sea-side skirt, tyre fenders hanging on chains (alternating 1 and 2 tyres), mooring bollards, two crane rails with sleepers and end buffer stops (rails at x = 18.5 and 28.5 so the gantry crane in the backdrop module straddles the play area), an invisible `playerOnly` 8 m high wall at the edge (`a(u+.03,-5,...,"concrete",{playerOnly:true})`) so players can never walk off and enemy bullets can still go over. This is the single most important "boundary without a visible wall" technique: the boundary is a collider that only the player collides with.

---------------------------------------------------------------------
## 2. BACKDROP: how far scenery is built

All created in `Eb`; `only` param lets one sub-scene be built in isolation for showcases ("crane","ship","boat","sky").

### 2.1 Philosophy
Everything beyond the fence is real geometry (no billboards/cubemap skyline), but built through a single `io` mesh-accumulator class: `add(material, geometry, tintRGB)` bakes a vertex-colour into the geometry (`Lc(geo, fn)` with a spatial noise tint `hv`) and `build` merges everything per material. So hundreds of parts become a handful of draw calls (`stats: {tris, drawCalls}` are returned). Because colours live in vertices, a "paint_grey" panel can be blue-grey, dirty, rust-streaked without extra materials. `hv(x,y,z)`: colour *= 1 - s*(0.3 - 0.36*noise3(0.31x,0.23y,0.31z)) plus a rust bias (orange: r*1.45, g*0.7, b*0.4) where a second noise at 1.7 freq > 0.68. Grime without any texture.

### 2.2 The gantry crane "SALTLINE 04"
Hand-built from ~300 boxes/tubes: 4 legs (x 18.5/28.5, z +-5.4), cross-braces via `jt` (oriented box between two points) and `Ke` (cylinder between two points), machinery house, operator cabin with glass, boom (to x=62, lattice truss with sagging catenary tubes: parabola `1.1+0.25 sin` droop), boom hoist trusses, anchor lights (`blink` lamps), railings generated by the helper `ns` (posts every 2.2 m + two rails), logo decal and `SALTLINE 04` stencil text. A separate group `crane-spreader` (hanging container-spreader with 4 cables and a red container) with `noMerge` is swung by two sines (`rotation.x = .012 sin(.52t)+.004 sin(1.31t+1)`) so the huge object feels live. The crane is built TWICE with the same code: near copy (full detail, with colliders for its legs) and far copies for the skyline: `z1(i,e,{into:acc, mat, dz:66})` remaps every material into one flat vertex-colour material via a colour table (`R = Map(uuid -> [r,g,b])`) and drops any part smaller than 2.6 m (`minSize`) - an automatic LOD. Then `mb` is a simplified 8-box crane silhouette repeated 8 times at z = -132...-336 and 128...330 (scale 1.15..1.45, tinted per distance, with a blinking red lamp at the jib tip) to make the container terminal extend into the haze to the north and south.

### 2.3 Ship "KITTIWAKE"
Moored at x=41 (`rt`), length `qn = 63` m, beam 16 m (`vR = 8` half beam), z from -9 to -72. The hull is a **parametric surface**, not a modelled mesh:
- `fn(i, e, t)` maps (station i along length, height e, side t=+-1) to a 3D point. Half-width is `0.2 + (8-0.2)*c` where `c = sin(l*PI/2)^.72` and `l = i/a` with a = 17 - 8.5 r^1.3 (bow shape lengthens at the keel, shortens at deck), with stern taper `u *= 1 - .24 h^2(1-.6r)`. Bow sheer is a quadratic bump (`yR`) and bulwark `Tf`.
- `ha` computes normals by central finite differences of `fn`; this gives smooth shading on a quad grid of 13+ stations x 10 rows. Plates: 2 sub-meshes (red antifouling below, paint above, split at row 3), per-quad random brightness `0.58..0.94` (`hl` hash) so every plating panel catches light differently, darker waterline, and extra vertex-colour streaks. Quad normals are nudged inward by 0.075 at quad centres to fake plate seams.
- Details: rivet strakes, scuppers, cargo containers on the foredeck (random palette of 8 colours, hash-picked), accommodation block (5 decks with railings and windows lit/dark by hash), bridge wing, mast with radar (rotating at 1.9 rad/s), anchor, gangway, bollards and mooring lines (catenary tubes via `ua` = parabola sag) and fenders (tyre torus shapes). Name decal "KITTIWAKE" on bow, hull both sides, via the label system.
- Colliders: 4 hull boxes `metal` so bullets and grenades hit the ship; no nav.

### 2.4 The RIB boat
Extraction vehicle. Hull tube = `TubeGeometry` along a CatmullRom spline (11 control points, radius .27, 12 sides) giving a soft pontoon; deck from hand-triangulated sparse triangles with auto-flipped winding (`M` function orients each triangle away from a reference point). It has seats, console, engine pods, roll bar, fuel tanks, a nav light. Position (31.5, -1.6, 21). Animation: y bob `.05 sin(1.15t) + .025 sin(2.3t+1.3)`, pitch `.05 sin(.9t+.4)+.016 sin(2.1t)`, roll `.02 sin(1.3t+2)`; two mooring ropes to the quay with parabola sag.

### 2.5 Container-port skyline and far city, the main "scale seller"
Layout (all in world coordinates west/east): the playable fenced area is only 70 m, the skyline extends to about +-600 m:
1. **Stacked container blocks** with `y`: for each stack column (x list `b`: -48.6, -61.2, ... -144.6; `m`: 6.3..-31.5) and rows every 2.62 m, a 5-in-8 pattern `$ % 8 >= 1 && <= 5` leaves aisles every 8th slot (roads). The stack height per cell = `round(.2 + 5.4*noise + random(-1.2,1.2))` clamped 0..5, 7 percent random holes. For each container the code emits **only visible faces** (`k` string "TSNEW": top, south, north, east, west) by testing whether the neighbour at that height exists: this is hidden-face culling by hand and halves the triangle count. Colours from an 18-entry palette `yb` (scaled relative to a reference light grey `dv` so they respect the scene colour), brightness 0.6..1.0, and distance fade `bb(x,z) = 1 - .6*smoothstep(38,160,hypot(x+5,z))`: **darkening toward the horizon is baked into vertex colour**, so far objects match the fog and haze without per-pixel cost. Near blocks within 55 m also get corrugation ribs (`ribs`, real extruded ribs 5.75 cm wide) and door details on end faces; far blocks are flat boxes.
2. 5 RTG/straddle gantries `S` at hand-picked positions with ladders and cabs lit by point-like blinking lamps.
3. 16 tall high-mast floodlight poles 26-34 m with 4 lamp heads each (blink material, constant amplitude 3.1 .. HDR).
4. 3 lattice pylons, 4 big warehouse blocks, 8 more gantry cranes, a far shoreline/pier ground slab `c(Ee(-230,-1.6,-384, 30,-.12,425))`, a far-shore quay strip with simple coloured warehouses (`q`) at x 34..62 (z 140..345 and -360..-205) and further at x 470..626.
5. Breakwater rocks: boxes at x = 398 +- 14 sin, random yaw: a long dark band along the horizon.
6. Lighthouse at (399,-72): stacked cylinders, rotating beam lamp with `Bn` light of colour [16,15,11] (HDR).
7. The far city across the bay at z about -430..-520 centred x=300: a 660 m wide dark slab (`[.16,.17,.18]`), 8 silo/tank cylinders, 2 chimneys with red beacon bands, 6 factory blocks, and 26 random window lights as blink lamps at random heights. The detail level is deliberately low; they are 15-30 m wide primitives. The extreme depth (500 m behind a 70 m playfield) is what produces the awe.

Triangle budget is tracked (`t.tris`). I estimate tens of thousands of triangles, built once and never touched.

### 2.6 Lights on distant objects: the blink lamp material
A single `MeshBasicMaterial({vertexColors:true, fog:false})` patched with `onBeforeCompile` (shared by the whole backdrop). Every lamp is a tiny octahedron (`Bn`: OctahedronGeometry radius .12-.9, detail 0 = 8 triangles) with vertex attributes `color` (RGB can be well above 1 for bloom, e.g. [9,.5,.25] red, [5,4.6,3.8] warm white, [16,15,11] lighthouse) and `blink = (period, phase, duty)`. Vertex shader:
```
float ph = fract(uTime / max(blink.x, 1e-3) + blink.y);     // 0..1 cycle, individual phase
vBlink = blink.x <= 0.0 ? 1.0                              // period 0 = steady lamp
       : mix(0.02, 1.0, smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(blink.z, blink.z + 0.12, ph)));
// fragment: diffuseColor.rgb *= vBlink;   (fog disabled so lamps stay visible through haze)
```
All lamps in the backdrop (hundreds) merge into **one draw call** and blink without CPU work. The distant red aircraft beacons on cranes and chimneys (period 2.2-3.5 s, offset by index) are what makes the horizon feel alive in the rain. HDR colour multipliers feed the bloom pass.

### 2.7 Gulls
12 gulls as one mesh (6 vertices each: two wing triangles + body) animated purely in the vertex shader: each bird has orbit centre, radius, angular speed, flap frequency; `glide = smoothstep(-.2,.5, sin(t*.31+phase))` mixes wing-flap amplitude .12 -> .55; wing tips lift `gl.y += wingFlag * flap * |z|` and fold `gl.z *= mix(1,.86, |flap|)`; pitch the body into the turn. No CPU per-frame cost; `frustumCulled=false`. They orbit around the quay and crane, so the eye catches the one moving organic thing in the sky.

### 2.8 Backdrop colliders and animation
`addBox` for crane legs and ship hull so shots at them sound/spark properly (`surface:"metal", tag:"backdrop"`), plus a rubber collider for the boat. Update cost is trivial: spreader sway, radar rotation, boat bob, one uniform time.

---------------------------------------------------------------------
## 3. GROUND: asphalt, puddles, wetness, markings, rain

Entry `O1`. It creates: apron mesh (`Ib`), sea mesh (`kb`), rain + splash (`Nb`), planar reflection pre-pass (`zb`), and the CPU query API.

### 3.1 Data textures (all procedural, generated at load in JS)
- **Mask map** `Rb(n)` (n = 1024, or 512 on low quality), covering the rectangle `Li = {x0:-44, z0:-40, size:80}` m (so about 8 cm per texel at 1024): RGBA8 where
  - R = puddle water-level field. `SR(x,z)`: base 0.5 + low-frequency fBm (scale 8.5 m, and 2.4 m detail) times small amplitudes, then **26 hand-placed elliptical depressions** `[cx, cz, rx, rz, depth]` subtracted with `exp(-a^2)` where `a = ((x-cx)/rx)^2 + ((z-cz)/rz)^2` (a sharp-edged super-Gaussian); plus two tyre-rut grooves (gaussians in z at 4.9, 7.1 and 15.4, 17.2, modulated by noise along x, active between x -37..29, only west of x ~ 14) so the avenue has linear puddles in the wheel tracks; plus quay lip lift `+.25*smoothstep(28.6,29.8,x)` so water drains toward the avenue instead of pooling at the quay edge. Stored as `0.5 + (h - 0.385)*2.5`.
  - G = "dryness" fBm (damp vs drier patches).
  - B = oil stain (thresholded product of two fBm).
  - A = wear (anisotropic noise stretched along x for traffic-polished lanes).
- **Detail map** `Cb(n)` (512) tileable, 4 channels: R grain, G low-frequency variation, B ridged noise for cracks (`1-|2n-1|` warped), A aggregate blobs; plus a **detail normal map** with 2 slopes (fine and coarse, derived by central differences of the height fields) packed into rg and ba. Tileable by wrapping the noise lattice (`n` period argument).
- **Marks map** `Pb(2048)` (canvas 2D, covering x -40..30, z -30..60... `fa = {x0:-40,z0:-30,w:70,h:60}`), drawn with additive compositing (`globalCompositeOperation = "lighter"`) in separate channels: R = yellow paint, G = white paint, B = tyre rubber streaks (blue strokes of 2 tracks each with random quadratic curves, 46 along lanes + 12 turning arcs + 60 random scuffs). Content: lane edge lines, dashed centre line, arrows, "SLOW 10" roundel text, hatched "KEEP CLEAR" boxes, bay rectangles for container slots with labels "A0..D0", pedestrian-style "BERTH 4" text, quay berth numbers every 9 m along x=26.9, stencil letters with gaps cut out (`fillRect` black bars 4.5 units wide through letters) for the stencil look. It waits up to 350 ms for the "Big Shoulders Display" webfont to load before drawing.

Authoring lesson: the entire painted yard is data in canvases and tables of line segments. The author draws like in a 2D vector program with world coordinates (`ctx.setTransform` maps metres to pixels), which is quick to iterate.

### 3.2 Apron shader
The ground is one `MeshStandardMaterial` on a single 190 x 320 m plane at x -160..30, patched with `onBeforeCompile` (hooks: `map_fragment`, `roughnessmap_fragment`, `normal_fragment_maps`, `lights_physical_fragment`, `lights_fragment_maps`, `lights_fragment_end`). One draw call; PBR lighting from the scene is reused, only albedo/roughness/normal and the radiance (reflection) are overridden. Key stages (from `AR`):

1. **World-space sampling**: everything is keyed to `vGWorld.xz`, so layers stay locked to the world regardless of mesh UVs. Mask via a custom 4-tap **B-spline bicubic** function `gBicubic` on the low-res mask; the comment says "no texel edge of a data map can ever show, however close the camera is".
2. **Slab joints**: expansion joints every 6 m: `sf = (0.5 - |fract(xz/6) - 0.5|)*6` -> distance to nearest joint `jd`; a tar-sealed line `tarW = .022+.03*detail.g` with analytic anti-aliasing from `fwidth(jd)`; groove; each 6 m slab gets a random brightness `sh`. 
3. **Cracks**: threshold of the ridged channel (`smoothstep(.955-cfw, .975, d1.b)`) only in areas where wear (alpha) plus slab hash is high; some cracks sealed with tar (`seal`).
4. **Albedo**: asphalt (0.125 grey) mixed to concrete (0.22) for x > 16 (`conc = smoothstep(15.6,16.6,x + noise)`), multiplied by grain, aggregate speckles, polish where traffic, black for tar/crack, `*= 1-.62*oil`.
5. **Paint**: sample marks texture; if magnified, bicubic; **procedural chipping** with 3 octaves of world value-noise (17, 57, 181 cycles/m, with the finer ones faded by distance `cf2/cf3`) so paint edges are crisp at 2 cm scale even though the source texel is ~3.4 cm: `keep = smoothstep(wt-.045, wt+.045, chip)` with `wt` from wear (more wear -> more chipped). Yellow = (0.52,0.34,0.035), white = (0.47,0.47,0.44), faded by variation.
6. **Water field**, the core:

```
depth  = 0.5 - mask.r + (sn - .5)*0.11 + (detail.g-.5)*.03 + (grain-.5)*.012 + groove*.04 + crack*.02   // + organic shoreline noise sn (40/15/5 cm)
puddle = smoothstep(0, .035, depth) * uWet            // mirror weight, ~5 cm ramp
deep   = smoothstep(0, .22, depth)                    // 0 at rim -> 1 hand-deep
soak   = smoothstep(-bandW, 0, depth) * uWet          // saturated band 10-30 cm wide around every puddle
fringe = smoothstep(-.65, -.02, depth)                // ~1 m damp halo
dry    = 1 - smoothstep(.2,.42, mask.g + fringe*.55 + noise)
damp   = (1-dry)*uWet;   wet = .7*damp + .3*soak
film   = soak * (1 - smoothstep(.35,.95, grain + (1-soak)*.6)) + groove*.5     // thin water film in the micro-pits
```
   Then albedo darkens (`*= mix(.95, mix(.7,.54), damp)`, `*= mix(1,.5,soak)`), puddle water albedo gets murkier with depth (`alb*mix(.85,.4,deep)`), never a black cut-out.
7. **Roughness ramp**: dry 0.74 -> damp 0.42 -> soaked 0.2 -> film 0.13 -> puddle 0.055, all smooth interpolations (so there is one continuous gradient from bone-dry to mirror).
8. **Normals** (as xz slopes in world space): grain normal * mix(2.1, .7, film) fades to 0 as `puddle` rises (water surface is flat) + ripple slopes + slowly drifting wind-wobble from the detail normal map. Final: `normal = normalize(mat3(viewMatrix)*normalize(vec3(-nxz.x, 1, -nxz.y)))` - the author bypasses `normal_fragment_maps` and writes the view-space normal directly from the world slope.
9. `material.specularColor` for puddles forced to 0.075 and `directSpecular` clamped to 40 (prevents firefly sun spec on water).

### 3.3 Rain ripples
One layer of ripples = a jittered cell grid; each cell spawns a drop per life cycle; output = radial slope (a derivative-of-gaussian ring profile) that is later added to the puddle normal:

```
vec2 gRipple(vec2 p, float t, float cell, float seed){
  vec2 q = p/cell + seed*17.3, id = floor(q), f = fract(q);
  float tt = t*(.5+.55*hash(id).x) + hash(id).y*9.;      // per-cell clock and phase
  float cyc = floor(tt), life = fract(tt);
  vec3 h = hash3(id + cyc*7.31);                         // new random drop each cycle
  float on   = step(h.z, .16 + .5*uRain);                // fewer drops in light rain
  float rmax = mix(.1, .36, h.x*h.x);                    // random max radius (fraction of cell)
  vec2  c    = mix(vec2(rmax+.05), vec2(.95-rmax), hash(id.yx+cyc).xy);   // random centre, ring stays inside the cell
  vec2  dv = (f - c)*cell;  float d = length(dv);
  float x = (d - life*rmax*cell) / (.005 + .02*life);    // ring thickens with age
  float ring = x*exp(-x*x)*2.3;                          // oscillating crest
  float amp = (1-life)*(1-life)*on*mix(.3,1.,h.y)*smoothstep(0.,.06,life);
  return normalize(dv)*ring*amp;                         // radial slope
}
```
Three layers are summed at cell sizes 0.83 m, 1.31 m (domain rotated by atan 0.75, time x .87) and 0.57 m (axes swapped, time x1.13) so the lattice repetition is invisible; the sum is faded with distance (`1 - smoothstep(10,34,dist)`) and scaled by rain intensity (`.3+.7*uRain`) and by depth (`smoothstep(0,.08,depth)`, so no ripples on the shore). Everything is applied as normal perturbation, then amplified by the reflection tilt (below), so the mirror image of the sky/lamps visibly shivers where a drop lands.

### 3.4 Planar reflection
- A pre-pass (`i.render.addPrePass(y.pass)`) renders the world a second time with a **mirrored camera** (position y -> -y, up vector flipped, same projection) into a WebGLRenderTarget at `quality.planar` x screen size (rounded to 16/8 px), mipmapped, half-float. An **oblique near-plane clip** (the Lengyel trick: modifies projection matrix rows [2],[6],[10],[14] with the clip plane y = .01) discards anything below the ground (e.g. the sea quay skirt) without a clip-plane uniform. Skipped when the camera is below y=.03. The apron, sea, rain and splash meshes are hidden during that pass (the passed array). The matrix `uReflMatrix = bias * proj * viewInverse` is uploaded so the apron shader projects `(x,0,z)` to reflection UV; `uReflLod = log2(height/270)` offsets blur so the resolution does not change the look.
- In the shader (`RR`, injected at `lights_fragment_maps`, i.e. it replaces `radiance`, the IBL specular): the reflection UV is shifted by a **tilt** of the water normal, scaled by `dk = (puddle + .15 film + .03) / (1 + dist*.07)` and clamped to +-.12, so ripples distort the image and far water distorts less. LOD (blur) = puddle: `r*9.5-.45 + .9` (soft mirror); damp asphalt: blurry `3 + r*6.5 - 3.4*grazing^5` clamps to 2..7.5 and is sampled with 3 taps offset along the view direction (`st = (0, r*.11 + (1-puddle)*.05)`: vertical smear) so wet road shows long streaky light reflections instead of a second mirror. Weight `pw = mix(1 - smoothstep(.55,.9,r), 1, max(puddle, soak))`, applied `radiance = mix(radiance, pr, pw)`; `pr` clamped at 48 to avoid fireflies from HDR lamps. Roughness (not a mask) decides how reflective a pixel is: that is why the transition is continuous.

### 3.5 Ground is a CPU API too
The same mask data `s` (kept in a JS Uint8Array) is sampled on the CPU with bilinear `U1`:
```
puddleDepth(x,z) = (x > quayX || outsideMask || insideShed) ? -.2 : .5 - maskR(x,z)
isPuddle  = puddleDepth > .015
wetnessAt = x>quayX ? 1 : insideShed ? .12 : outsideMask ? .6
          : puddle? 1 : .25 + (1-dryness)*.4 + soakBand*.3        // mirrors the shader's damp formula, max .95
```
Consumers in game.js: footstep/impact surface (`isPuddle(x,z)` and player y<.05 -> "water" surface: a bullet hitting the ground with normal.y>.7 at y<.08 on a puddle becomes a "water" impact), enemy footsteps (20261), and others. Order of precedence for the footstep surface: puddle -> "water"; else collider tag (e.g. "metal" from standing on a container, "wood" crate); else `level.groundSurfaceAt` -> "metal" if inside a metal rect else "concrete". Because shader and CPU share the exact same field, the player hears a splash exactly where the puddle looks wet. Tiny detail: shader `depth` includes added noise (`sn*0.11`) while the CPU version does not, hence the CPU threshold `.015` slightly above the visible rim.

### 3.6 Rain particles and splashes
- **Streaks**: instanced quads (9000 x quality, + 260 "eave drip" instances). Positions are computed in the vertex shader from a seed and time, wrapped into a 26 x 15 x 26 m box that follows the camera via `mod(p - cam + .5*box, box) - .5*box + cam`. No CPU per-drop work. Each drop is a camera-facing-around-velocity ribbon: length `0.03*|vel|`, width `max(w0, dist*uPix*.75)` (pixel-minimum width so distant drops don't alias) with alpha `*= w0/w` compensation so energy is preserved; colour = ambient + sun colour * Henyey-Greenstein phase (g=.72) of the angle to the sun (`wPhase`): drops glow when you look toward the sun (sunset!). Wind vector `uVel = (-2.6,-9.4,1.1)` gives slanted rain. Drops are culled by moving them off-screen (`gl_Position = vec4(2)`): when under the shed (4 uniform AABBs `uBoxMin/Max`, unless inside a roof opening `uSky[8]` passed from the level's skylights), below ground (y<0, y<-1.6 beyond the quay), or beyond the rain intensity fraction `fract(seed*7.13+x) > uRain`. Rain intensity eases (`b += (m-b)*dt*.8`), so it can be ramped.
- **Eave drips** (aSeed.w < 0 instances): fall freely from the shed eave (y=7 m, z=-10.72, x from -16..12): `y = 7 - 4.9 t^2` with period 1.19 s, speed `-9.81 t - .3`, length from speed, killed when no interior. A sheet of drips along the roof edge is a cheap, very readable "it is raining on a building" cue.
- **Splashes**: 900 x quality instances; each cycles (period .26-.40 s) to a new random position near the camera (snapped to a 4 m grid so they do not swim, denser near the player via `rr *= .35 + 1.3|rr|`); 70 percent are discarded unless the mask says "puddle" (`textureLod(uMask,...).r <= .49`), so splash crowns cluster on puddles; excluded inside the shed or over the sea. Fragment makes a crown (rim arc) + core + thrown droplets procedurally.
- **Thunder**: `Nb.update` fires `events.emit("thunder", {intensity})` every 30-60 s.

---------------------------------------------------------------------
## 4. Sea shader

- **Geometry**: a graded grid of 3 + 1 patches: x from the quay edge 27.5 to 880 with step starting .75 m growing 7.5 percent per step (`gv`, capped at 120 m); z from -880..880 with step .9 m near the player (inside |z|<48) growing 8.5 percent outward; plus 3 flat quads to fill the far field to +-880 m. Density is concentrated where the camera looks, triangle count low (maybe 12-15k). Bounding sphere is forced (1300), `frustumCulled=false`.
- **Vertex**: 4 Gerstner-like waves `[dirx, dirz, wavelength, amplitude]` = (-.92,.39, 9.5, .06), (-.75,-.66, 5.7, .04), (-.99,.12, 3.3, .026), (-.5,.87, 2, .016); `k = 2PI/L`, `omega = sqrt(9.81 k)` (deep-water dispersion, physically right speeds). Generated as unrolled GLSL via JS template strings with the constants baked in. Horizontal displacement `dir * .6*A*cos(phase)` gives the crest sharpening. Amplitude is faded with distance from the quay centre: `vSAmp = 1 - smoothstep(50, 220, dist((x,z),(30,0)))`, so far water is flat (cheaper, less aliasing, and reads as a distant horizon).
- **CPU mirror**: `seaHeight(x,z)` evaluates the same 4 waves (with `n = 1 - smoothstep(50,220, hypot(x-30,z))` envelope) so the boat/objects/splashes can ride the same surface.
- **Fragment normal**: analytic slope = sum of 4 big waves * vSAmp + 7 small waves (wavelengths 1.31 -> .21 m, amplitudes .02 -> .0035, `Db`) * nearB (`1 - smoothstep(25,110,d)`) + 3 scrolling taps of the detail normal map at different scales/speeds (0.113, 0.031, 0.39 cycles/m). Wind structure: `gust = smoothstep(.38,.62, ...)` cat's-paw patches (rougher x1.5, darker x.6, slope x1.35) vs calm slicks (x.4); a long swell term `sin(dot(xz, (-.118,.05)) - .55t + noise)`, a global bias slope along the sun azimuth.
- **Foam/scum**: distance field to the quay wall (`dq = x - 30`) and to a rounded box approximating the ship hull (`dh`, box centre (41,-34.5) half-size (4,21.5) minus 4) -> `band = 1 - smoothstep(0, .2 + fn2.g^2*2.2, de)`; foam = band thresholded by two noise samples (fn.a, fn.r, fn2.g) so it breaks up; scum (greenish debris tint) within 5 m. Foam albedo (.3,.32,.3), roughness .65.
- **Albedo** (.0045,.013,.017): almost black, teal; the colour is all reflection. Roughness: `mix(.1, .32, smoothstep(12,380,dist)) * mix(.62,1.5,gust)`: far water glossier at the horizon? no: rougher with distance (blurs the sun glitter), calmer-looking.
- **Sun glitter**: `directSpecular = min(spec, 40) * gSpark * mix(.3, 1, az^3)` where `az = max(dot(view_xz, sun_xz),0)`: strongest on the sun's azimuth, so you get the classic glitter road toward the sunset; `gSpark = mix(.55,1,swell)*mix(1,.6,gust)`.
- **Ambient occlusion by quay**: `gOcc = mix(.3,1, smoothstep(0, 8, de))*mix(.8,1.05,swell)` multiplied into radiance and IBL irradiance: dark water in the shadow of the quay wall and hull (cheap fake AO).
- **Haze**: `outgoingLight = mix(outgoingLight, haze, smoothstep(220, 860, dist)*.8)` where `haze = mix(uHazeA, uHazeB, pow(cos(angle to sun),3))`: warm toward the sun, cool away, an extra atmospheric-perspective layer beyond the standard fog.
- No sea reflection pass: the sea relies on the scene's environment map (IBL) for reflection of the sunset sky (which is why the colour is simple and roughness drives its look).
- `quaySkirt`: a 320 x 4.4 m dark plane at x=29.88, y=-2.18, the quay wall face below the waterline line (hides the gap).

---------------------------------------------------------------------
## 5. Showcase functions
These are isolated dev scenes launched by URL params (e.g. `bshow`); each builds only its module and returns a camera.
- Level `mR`: builds the level and returns `cam [-32,1.7,6]`, `target [0,2.4,6.4]`: standing at the gate at eye height looking straight down the avenue.
- Backdrop `MR`: param `bshow` chooses `crane` (cam [0,1.7,27] looking at [33,13,0]: from the yard up at the crane), `ship` (cam [24,1.7,-2] -> [38,9,-24]), `boat` (cam [19.5,1.7,11.5] -> [24,.9,15]), `sky` (cam [-32,1.7,6] -> [30,9,0]: gate view of whole skyline). The boat is placed at (24,.34,15) (above the ground) in showcase and `stats` printed to console. All cameras at 1.7 m eye height: the showcase tests the true player's view, not a flattering aerial view.
- Ground `BR`: removes the default 80 m plane, builds the ground, adds a test set (red/blue/teal containers, a yellow 40 ft, drums (plastic blue, rusty), a steel pole, emissive bars in red/cyan/warm/lime, a hot lamp (emissive 12), a dark crate), and sets `cam [-9,1.65,5.6]`, `target [14,.4,5]`: a low grazing view across the avenue's puddles toward the emissive lights so reflection, ripples and glitter are tested in one frame. The props contain emissive colours of different hues specifically to see coloured reflections.

---------------------------------------------------------------------
## 6. Why it looks good and plays well: 12 concrete decisions

1. **One long axis, designed first view.** The player starts at the gate looking down a 60 m avenue that terminates in the crane and sea; the level showcase uses the same shot. The best composition is the first thing seen, and it doubles as the navigation cue (crane = extraction side).
2. **Spawn/cover data is authored, then repaired automatically.** Rough coordinates are snapped to the nav grid so authors can place 50+ points quickly without any being illegal; spawns have type air/ground per zone.
3. **Invisible player-only walls** bound the map without visual clutter, and still let bullets and enemies cross; fence is visually 2.4 m but physically 7 m for the player only.
4. **Crooked stacks.** Random +-1.3 degree yaw, +-5 cm offsets and per-container wear in `stack` avoid the CAD look at essentially zero cost; combined with vertex-colour grime (`hv`).
5. **Rotated-collider slicing** keeps AABB physics while props sit at any angle, with 7 percent shrink, so movement near props feels smooth.
6. **Leaking roof with consistent consequences.** 8 removed roof panels produce stains, light shafts, rain into the shed (uSky uniforms), eave drips: the same data drives geometry, decals and rain culling. The rain culls drops under cover (`wInside`) so you stay dry in the shed yet see rain beyond the doors; this teaches the player the interior/exterior boundary by sight.
7. **Baked atmospheric perspective.** In the skyline every vertex colour is multiplied by `bb(x,z) = 1 - .6*smoothstep(38,160,dist)` and given a palette scaled to the scene's light grey so the backdrop already matches fog. Far crane silhouettes (`dz:66`, `minSize 2.6`) are the same code in lower detail, which keeps the style identical at any distance.
8. **Culling by construction.** Skyline containers emit only exposed faces; lamps are 8-triangle octahedra in one blink-shader draw call; gulls are 6-vertex animated in the shader; sea mesh is a graded grid with amplitude fading by distance. The heavy-looking horizon costs few draw calls.
9. **Water is a continuous gradient, not a decal.** Puddle -> soaked band -> damp halo -> dry is one set of smoothsteps driven by one signed depth field with 3 octaves of organic shoreline noise; roughness goes .74 -> .055 across it. Wet asphalt reflects blurred, vertically smeared light, puddles reflect sharply: this single idea is most of the "rainy port at sunset" look.
10. **Reflection is one mirrored pass reused for everything wet**, quality-scaled (`quality.planar`), with oblique clipping and mipmapped LOD from roughness, plus normal tilt from ripples so reflections shimmer.
11. **Shader and gameplay share one field.** The puddle mask lives in a JS array and in a texture; `isPuddle` drives footstep/impact audio and splash particles exactly where water is drawn. Splash particles even sample the mask in the vertex shader to bias toward puddles.
12. **Detail that survives close-up.** World-space procedural noise for chips (17/57/181 cycles per m, faded by distance), analytic anti-aliased joints via `fwidth`, bicubic sampling of low-res data maps: the 1024 mask never shows its pixels at head height; this is the difference between "textured plane" and "ground".
13. **Cheap but readable interior lighting.** Only 4 PointLights in the whole shed, without shadows; the rest are emissive meshes (HDR colours up to 12-16) feeding bloom, and warm (0xFFD58A) vs cool (the dusk sky) contrast. Light is placed where the player will want to look.
14. **Rain with phase-function lighting**: streaks brighten when facing the setting sun, with pixel-minimum width and alpha compensation: looks right at any distance and resolution.

---------------------------------------------------------------------
## 7. Reusable techniques (summary pseudo-code)

### A. Wet-ground gradient from one signed field (use anywhere with rain)
```
depth  = waterLevel - ground + noise(40cm,15cm,5cm)        // + at puddle centre, - outside
puddle = smoothstep(0,.035,depth);  soak = smoothstep(-band,0,depth)
damp   = (1 - dryNoise(depth_fringe)) ;  film = soak * (1 - grainThreshold)
albedo *= mix(1,.5,soak) * damp_darkening;   rough = lerp(.74,.42,damp) -> .2(soak) -> .13(film) -> .055(puddle)
normal.xz = bumpNormal * (1-puddle) + ripples * puddle
cpu: same field sampled bilinear -> isPuddle(x,z), wetnessAt(x,z) for audio/particles
```

### B. Planar reflection feeding PBR radiance, blur by roughness
```
reflRT = render(mirroredCamera(y -> -y), obliqueClip(plane y=0), size = screen*q)   // mipmapped
in shader (lights_fragment_maps):  uv = proj(worldXZ) + tilt(normal.xz)*smallK
lod = puddle ? rough*9.5 : (3 + rough*6.5 - 3.4*graze^5);  3 taps offset in uv.y (smear)
radiance = mix(radiance, clamp(sample, 0, 48), weight(roughness, puddle, soak))
```

### C. Skyline from procedural stacks with baked haze (cheap scale)
```
for stack (x,z) in noise-height grid with roads every 8th slot:
   h = round(noise*5.4 + rand);  for level in 0..h: emit only faces whose neighbour is empty
   colour = palette[rand] * rand(.6,1) * (1 - .6*smoothstep(38,160,dist))     // distance darkening baked
   far objects: reuse near-object builders through a "remap material + drop parts < 2.6 m" accumulator
merge by material; lamps: octahedra with attribute (period, phase, duty), blink in VS, HDR colour for bloom
```

### D. Ripple layer in a fragment shader
(See section 3.3, 14 lines.) The pattern "cell grid + per-cell cycle + derivative-of-Gaussian ring + 3 incommensurate layers" is portable to water, glass, window rain.

---------------------------------------------------------------------
## 8. Quick facts and numbers

- Arena about 70 x 60 m; shed 28 x 17 m, 7 m eave, 9.5 m ridge; quay at x=30, sea -1.6 m; crane legs 10 m x 10.8 m, 24 m tall, boom to x=62; ship 63 m long; skyline out to x about +-600 m, far city at z -430..-520.
- Container: 20 ft 6.06 x 2.44 x 2.59; 40 ft 12.19 long; hc 2.9 high; stack columns jitter +-1.3 degrees.
- Mask texture 1024 (512 low) over 80 m; detail 512 (256); marks 2048 (1024); rain 9000 x q streaks + 900 x q splashes + 260 eave drops.
- 26 hand-placed puddle ellipses; 8 roof holes; 4 shed lights; 55 cover points; 3 relays; 3 zones + gate; 12 cinematic keyframes; 12 gulls; ~16 sky poles, 8 distant cranes; 4+7 sea waves.
- Sea mesh x step .75 m * 1.075^n (cap 120 m); central z step .9 m; haze begins at 220 m.
