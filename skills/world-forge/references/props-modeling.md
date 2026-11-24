# Case study: Procedural props: builder contract, kit/merge, bevels, corrugation, vertex-colour grime, decals, deformation

> What the Saltline game (Claude Fable 5.2, one autonomous run, Three.js, zero asset files) does in this area, with its numbers and the reasons it looks or feels good.
> Use it as a **technique catalogue and a quality bar**. Re-implement in your own code for your own world; change the numbers to fit your art bible. Short-form names like "Kit", "getShadow", "wave" are descriptive labels, not APIs to import.

---

## 1. Architecture

### Registry and builder signature
- A central size table `Gi` maps `propName -> [w, h, d, defaultMaterialName, surfaceType]`. It has 36 entries. Example: `container40: [12.19, 2.59, 2.44, "paint_blue", "metal"]`. It is the single source of truth for footprint, for the fallback box and for the physics surface.
- `register(name, builder)` just stores `Xg[name] = builder` (`_i`). Builders are registered at the end of each section by short `register(...)` calls.
- Builder signature: `(G, opts) => THREE.Group`. `G` is the game context (`G.mats` = material library, `G.physics`...). `opts` is a small bag: `seed`, `color`, `lying`, `open`, `doors`, `wear`, `on`, `lean`, `posts`, `rails`, `forksUp`, `label`, and so on.
- `props.build(name, opts)` wraps the builder in try/catch. If it throws or the name is unknown, it logs and returns a plain grey-ish box from the `Gi` row, with a collider. **A bad prop never crashes the level.** It also stamps `userData.prop = name`.
- Every builder ends with the same contract on the returned group:
  - `userData.size = [w,h,d]`
  - `userData.colliders = [{min:[x,y,z], max:[x,y,z], surface:"metal"|"wood"|"concrete"|"rubber"|"dirt", bulletOnly?}]` in local space
  - optional `userData.lamps = [{pos, dir, color}]` for light-casting props (light_mast, floodlight_stand, guard_booth) so the level can spawn real lights from them
  - optional `userData.update(dt)` / `setState` (relay_node, a game-logic prop)
  - `userData.noMerge = true` on animated sub-groups (relay_dynamic) so the static merger skips them.

### Two builder frameworks (the code was clearly written in two passes)
1. **Builder A (`jn`)** is used for the old "architectural" props (containers, barriers, booths, racks). It has a matrix stack (`push/pop`) and primitive helpers: `box` (bevelled by default, radius 0 gives a plain box), `cyl` (with `seg`, `open`, `flat` shading), `tube` (CatmullRom), `bar` (cylinder between 2 points, optionally tapered via `r2`), `beam` (box between 2 points), `decal`. Everything is accumulated into **buckets keyed by material** and merged at the end: `parts` returns one merged geometry per material, `group` builds one Mesh per material.
2. **Kit B (`Kn`)** is used for clutter and vehicles. Same bucket idea, but:
   - Keyed by material uuid plus a cast-shadow flag.
   - `add(matOrName, geometry, {p,r,s}, tint)`: transform is applied to the geometry on the CPU (matrix stack), then **vertex colour is multiplied by a tint**. The tint is a number, an `[r,g,b]`, or a function `(x,y,z)=>[r,g,b]`. Colour is baked into vertices, so one material serves many looks.
   - Has its own seeded rng (`rng`, with `.range(a,b)`), derived from `seed` and the prop name.
   - `decal`, `label` and `cdecal` (cylindrical decal that wraps a curved surface) are raw non-shadow-casting quads.
   - `finish` runs a **global grime pass over all vertex colours** (see section 3), builds one Mesh per bucket, and attaches size and colliders (defaulting to a centred box from `Gi`).

### Materials
Props never create materials ad hoc. They ask by **name**: `t.M("steel_galv")`, `"paint_yellow"`, `"concrete"`, `"wood_pallet"`, `"rubber"`, `"diamond_plate"`, `"cardboard"`, `"glass"`, `"chainlink"`, `"tarp"`, `"tire"`, `"brass"`, `"aluminium"`, `"polymer_black"` and so on. `G.mats.get(name, {vertexColors:true, doubleSide:true, color:hex})` returns a **cached** material per name+options. This is what lets the merger fuse geometry across props later. Special factories:
- `mats.emissive(hex, intensity)`: light-emitting surfaces (lamp lenses, screens, LEDs).
- `mats.label(text, {color, font:"stencil"|"sans", distress})`: returns `{material, aspect}`. A canvas-text texture with a distress (wear) level, cached by the helper `Mi` under key `"L|"+text+"|"+JSON(opts)`. Falls back to a white paint plane on error.
- `mats.decal(name)`: returns `{material, aspect}` for premade sticker textures: `hazard_general`, `hazard_voltage`, `hazard_flammable`, `no_entry`, `caution_stripes`, `csc_plate`, `berth4`, `arrow`, `logo_a..d`, `rust_run`, `grime_streak`, `leak_stain`, `scorch`, `numbers_0_9`, `bullet_concrete`. Cached by `Jn`.
- Paint colour variation: a prop is built **once with the neutral `paint_white`/default material and vertex colours**, then recoloured at instantiation by swapping the material (`paint_red`, `paint_blue`...), see containers.

### Caching and instancing
- **Per-variant cache of built geometry**: `M3` quantises the options (`seed % 6`, doors to 0.1 steps, wear to 0.5 steps) into a key, builds `zA(...)` once, stores `{parts, colliders}` in a per-material-library Map. A new container is just `Zg(parts, materialMap)` which creates new Mesh objects sharing the cached BufferGeometry, with a different paint material. So a yard with 200 containers builds about 6 x 3 x few variants of geometry.
- Small props use `wf(key, build)`: cache a built Group by key (`barrel|color|lying|open|seed%4`) and return `.clone(true)`. Clone shares geometry and materials, so no extra GPU memory.
- No `InstancedMesh` and no LOD appear in this module. Instead the **level builder calls `mergeStatic` (`By`)** over the whole `staticRoot`: it traverses meshes, groups by `material.uuid + cast + receive + layers`, clones and bakes world matrices, and merges to one mesh per material. Anything with `userData.noMerge`, skinned, instanced or multi-material meshes is skipped and re-attached (kept as dynamic).

### Placement and collision (level code)
- `E(name, x, z, yaw, opts, y, flags)` builds a prop, sets position and `rotation.y`, adds it to `staticRoot` (or `dynRoot` if `dynamic`), updates matrix, registers physics, and pushes `userData.update` into an update list.
- `M(prop, yaw)` registers colliders. Each local AABB is transformed by the world matrix, so for yawed props it grows (AABB). To avoid giant boxes, if the yaw is not axis aligned (`|sin 2yaw| > 0.2`) the long box is **split into up to 10 sub-boxes along its long axis** (slice thickness about max(0.25, short side)) and each is shrunk by 7% on x/z. Colliders thinner than 0.2 m and below 0.3 m high are skipped (so you walk over them). `cR` skips cones and jerry cans (cosmetic only). `bulletOnly` colliders (sign plate, relay top antenna) block bullets but not walking.
- Colliders are **coarse and hand-authored per prop**, not derived from the visual geometry. Container: a single box, or if doors are open, a floor slab plus roof plus 3 walls. Open doors are split into 3 boxes each along the swung door. Stairs: one box per step (12). Forklift: 7 boxes plus mast boxes.
- Props carry `surface` so footsteps/impacts pick the right sound and decal.

### Shadow flags
Merged meshes: `castShadow = !noShadowBucket`, `receiveShadow = true`. Decals, labels and emissive quads are added with `cast:false`/`raw:true` (so they do not enter the shadow map and do not get grime baked in). In Builder A decals use the 4th argument `true` (skip cast). Static level pass later forces `castShadow = !transparent && !MeshBasic`.

---

## 2. Prop list (36 registered, one-line recipes)

Size table values are in metres, real-world scale.

| Prop | Recipe |
|---|---|
| `container20/40/40hc` | The hero asset, about 70 sub-structures. Corrugated side walls by sweeping a trapezoid profile (`Uc`+`la`), corner castings (8, bevelled with oval hole decals), bottom/top rails, door end with 2 locking rods, handles, hinges, seals, 6-7 recessed panels per door; optional 2 swung doors (angle `doors*112deg` and `*100deg`, so they differ), interior with its own corrugation, wood floor, CSC plate, ID stencils with a real check-digit format, logos, rust runs and grime streaks. Dents (2-3 per side), rust streak bands, vertex dirt. |
| `jersey_barrier` (898-974) | One extruded 12-point profile (real Jersey shape) with 17 length sections, end tapering, noise-tinted, 7 chipped patches lightened, optional hazard-stripe overlay, forklift pockets, lifting loops (tube). |
| `light_mast` (1002-1125) | 14 m 3-section octagonal tapering pole (taper function `h(y)`), concrete plinth + 8 anchor bolts, ladder rungs every 0.38 m, hazard sign, conduit tube, 4 lamp heads (`w3` helper: housing, emissive lens, louvres, bracket) on a cross-arm, `userData.lamps`. |
| `fence_panel` (1127-1198) | Chainlink as ONE subdivided plane (6x3) with z noise and a chainlink alpha texture (doubleSide), posts, top rail, tension wires, 3 barbed-wire rows with 17-ish barbs per row each randomly rotated, concrete feet. |
| `guard_booth` (1200-1400) | 2.6x2.2x2.42 m cabin from ~80 boxes: frame posts, glazing (glass boxes), sill, door with glass and handle, AC unit with grille and louvre bars, interior (desk, monitor with emissive screen, chair, floor epoxy), roof overhang, emissive lamp, label decals. |
| `gate_arm` (1402-1480) | Barrier post box, pivoting arm (9 alternating red/white segments, 4.62 m) with `open` param 0..1 rotating via `push`, counter-weight, emissive light, bollard receiver. Collider changes when open. |
| `bollard_mooring` (1483-1537) | Lathe profile (10 points), 6 base bolts (hex heads), horizontal horn cylinder with two end domes. |
| `bollard_post` (1539-1584) | Segmented cylinder with black hazard bands (different vertex colours per ring), dome, base plate, 4 bolts. |
| `sign_post` (1588-1643) | 2.4 m post, brackets, 2 aluminium plates + printed decal + stencilled text, tilt jitter (`n%5-2)*.006`), bolts. |
| `floodlight_stand` (1645-1736) | Telescopic tripod (3 legs), twin lamp heads with emissive lens, louvres, cable tube lying on the ground in a random curve. |
| `stairs_metal` (1740-1849) | 12 diamond-plate treads with yellow nosing, stringers (angled beams), handrails (2 heights, spheres at joints), landing, X-bracing. 12 step colliders. |
| `catwalk` (1851-1896) | Grating from ~30 slats + 30 cross bars, edge frame, optional rails (3 posts, 2 rails). |
| `shelf_rack` (1966-2050) | Blue uprights with perforation decals (0.1 m pitch), cross braces, 2 orange beams per level, wire decking; each bay randomly filled (cartons, wrapped pallet, drums, pallet stack, none) with ~200 sub-boxes. |
| `reefer_unit` (2052-2225) | White panel box, fan guard (spokes + rings), vents, pipework (CatmullRom brass tubes), control box with emissive display, hoses. |
| `relay_node` (2231-2610) | Game-logic prop: concrete plinth, steel cabinet, 3 hatch panels, antenna lattice, dish, hoses, emissive beacon; 3 states (`live`, `cutting`, `cut`) updated per frame (sine pulse, flicker, spring-damped door). Dynamic parts excluded from merging. |
| `barrel` (3152-3221) | Lathe (`us`) profile with 2 rolling hoops (ridges); 2-3 procedural dents (pushed inward by cosine falloff) applied on the vertices, seam normal fix, hazard decal wrapped around via `cdecal`, bung caps. Variants: lying, open (hollow interior), rust. |
| `pallet` (3291-3297, `S1` 3223-3289) | EUR pallet: 3 bottom boards, 9 feet (octagonal extrusions), 3 stringers, 5 top boards, with per-board jitter (position +/-3 mm, yaw), burned "EUR" stamps; optional broken board. |
| `pallet_stack` (3299-3317) | 1-12 pallets, each rotated randomly (+/-2 deg, 30% flipped 180), 20% broken, only top one bevelled. |
| `crate_wood` / `crate_stack` (3319-3513) | Skids, plank walls with UV offset per plank (so grain is different), 4 diagonal braces, corner steel brackets, stencil labels ("FRAGILE", code), crates stacked with rotation and orange strap ribbons. |
| `ibc_tote` (3515-3613) | Steel pallet base, translucent-look plastic bottle via a subdivided bevelled box deformed to bulge, liquid level (colour gradient with noise), 5 horizontal cage bars + verticals as bars, red valve, label plate, leak decal. |
| `cable_reel` (3637-3723) | Two flanges from 9 radial wedge pieces each, hub, 16-wrap cable lathe, loose cable end (Catmull tube), brass tip, ground stands. |
| `tire_stack` (3725-3788) | Lathe with 20 segments, tread grooves with UV for the tyre texture, 1-5 tyres with 2 cm jitter. |
| `jerry_can` (3790-3845) | Bevelled box deformed (sloped shoulder), embossed X frames on both sides, 3 handle bars, cap, flammable decal. |
| `traffic_cone` (3847-3884) | Lathe, 5 coloured bands (red/grey alternating), square base; "lying" variant. |
| `gas_cylinders` (3886-4009) | 3 cylinders (lathe with domed top + valve and cap), scaled randomly (0-5% height), dirt noise bands, frame cart with 19 chain links. |
| `pipe_stack` (4011-4107) | 9 pipes (4,3,2 pyramid) with inner shell (normals flipped via `M1`) so openings look hollow, end rings, 3 bearers, wedge chocks. |
| `tarp_cargo` (4137-4301) | 4 cargo blocks under a **height-field draped tarp**: a 22x14 grid whose height is `max over blocks of (h - 0.95 d - 0.9 d^2)` plus noise and sines; hem skirt of 5 rings; 2 ratchet straps as ribbons; rope on top. |
| `sandbags` (4319-4355) | Each bag = bevelled box deformed (belly bulge, pinched ends, noise) with ties; staggered courses (even rows 6, odd rows 5). |
| `cardboard_boxes` (4467-4518) | 7 boxes via `Oc`, one is crushed (vertex deform), one opened (flaps as ribbons), one damp (colour darkening), tape strips, labels, arrows. |
| `forklift` (4582-5058) | ~200 parts: chassis, counterweight (deformed box), 4 tyres (lathe + yellow rims + 6 bolts), overhead guard (diagonal struts), seat, steering wheel (torus + 3 spokes), levers, LPG tank (lathe), mast with 3-4 channel stages and chain made of alternating links (`zr` boxes), forks (extruded L profile), headlights, hazard stripes, ID numbers. `forksUp` parameter (0-1) raises the carriage 1.5 m. |
| `generator` (5060-5267) | Frame, enclosure, louvres (11 angled slats), control panel with emissive display, gauges (aluminium discs + needle), switches, exhaust pipe with soot scorch decal, fuel cap. |
| `dumpster` (5269-5430) | Extruded cross-section profile with thickness (`Mo`), side ribs, 2 hinged lids (one open at random angle, plastic with dome deformation), trash bags (deformed noise boxes), 4 casters, stencil "B4 WASTE", rust/grime/leak decals. |
| `toolbox_cart` (5432-5566) | Cabinet with 5 drawers (two of them ajar by 5 cm with contents), handle, 4 casters, tray; clutter on top: wrench, spanner, bottle, glove. |

---

## 3. Geometry-detail techniques (the heart of the quality)

### 3.1 Bevelled boxes everywhere
Sharp 90 degree edges are the first thing that reads as "CG primitive". The module has its own bevelled-box generators: `p3` (lines 78-141, 24 vertices with 3 normals per corner, per-face UV) and `Ge`/`eo` (2700-2778). Every `box` call takes `{r: radius}` and the default is `min(0.012, minDim*0.25)`, i.e. about **1 cm** (so a 5 mm light catches every edge). Small details use 0.003-0.008, big shells 0.012-0.04. `r:0` selects a plain box where an edge would never be seen. Interesting points:
- Bevels are applied as a clamp-to-inner-box-then-push-out. Corner vertices sit on a sphere of radius `r`, so normals are smooth (not just chamfered flat).
- The box has **UVs by dominant normal axis**, so world-scale tiling textures (wood, metal) don't stretch.

### 3.2 Corrugation as a swept profile (container)
Instead of normal maps, the real shape is geometry. `CA(x, period, depth, flat, slope)` (233-238) gives the depth of a trapezoid wave at position `x`. `Uc(...)` (240-252) returns sample positions only at the corners of the wave (so a wave costs 4 vertices, not 16), `la(profile, rows, fn)` (171-231) sweeps. Numbers: wall period `0.278 m`, depth `0.036`, flat `0.072`, slope `0.068` (the real ISO corrugation is 76 x 36 mm). Roof uses period `0.209`, depth `0.02`; door ends `0.25 / 0.042`. Rows are split in height into `[0.167, 0.44, 1.25, r-0.5, r-0.06]` so the wave stops before the top/bottom rails. This is the single decision that makes a plain box read as a container.

### 3.3 Vertex-colour AO and dirt baked on the CPU
No bake pass, no AO map. Colour is computed per vertex by a function `(x,y,z)=>[r,g,b]`:
- **Ground-contact darkening**: `0.6 + 0.4*smoothstep(0, 0.3, y)`. Used for concrete plinths, bollards, booth, light base.
- **Corrugation valley AO**: in the container, `J = smoothstep(0.008, 0.034, d - |z|)` (depth within the wave) multiplies colour by `1 - 0.17..0.18*J`. Valleys are darker, so the wave reads even in flat light.
- **Rust streaks hanging from the top**: `oe = smoothstep(r-0.75, y, V)` times streak bands from 9..21 randomly positioned x-intervals (`_` list), colour multiplied `[.62,.38,.24]` (warm brown) with strength `0.45+0.55*wear`.
- **Dent shading**: `fe = dentDepth(x,y)`; when `> 0.004`, colour toward `[.66,.46,.36]` (rust at the dent) (dents themselves are geometry: depth `0.025-0.065`, radius `0.22-0.52`, falloff `(1-t^2)^2`, applied in the sweep callback to the wall z).
- **Large-scale value noise tint**: `1 + (noise(x*0.9, y*1.7) - .5)*.16`. Plus fine noise `0.94 + 0.06*noise(x*6,...)`. Low frequency + high frequency are always combined.
- **Global grime pass (`Kn.finish`, 3084-3099)**: for every non-raw bucket multiply colour by `(0.82+0.18*n1)*(0.92+0.08*n2)*(0.76+0.24*clamp(normal.y*0.6+0.62))` and then a **ground dirt band** `M = clamp(1 - y/0.2)`, `*= 1 - 0.42*M^2*(0.55+0.45*n2)`, with blue and green reduced more than red (`*(1-.05M)`, `*(1-.12M)`) so dirt is warm brown. It gives every prop a "splash line" at the bottom 20 cm and upward-facing surfaces brighter (sky exposure) with downward surfaces darker. `grime` param scales it.
- Tint ranges are consistently **0.6-1.0**, never pure 1.0, and RGB are **not scaled equally**: e.g. wood tint `[v, v*0.93..1, v*0.82..0.95]`, rust `[A*(1-.25M), A*(1-.42M), A*(1-.55M)]`. Warm drift in the shadows is a recurring decision.

### 3.4 Trims, bolts, fasteners and repeated tiny parts
Almost every surface has a second scale of detail:
- Corner castings with oval hole decals; bolt heads as 6-sided cylinders (`seg:6`, radius 0.011-0.014, height 0.012-0.03).
- Hex nuts (`seg:6, flat:true`), washers, rivet rows (0.1 m pitch).
- Hinges and lock rods on doors (cylinders `r=0.0155` with brackets).
- Perforation on shelf uprights: `for y in 0.12..4.15 step 0.1: two 14x34 mm plane decals` (about 80 per upright).
- Barbed wire: 17 barbs per strand, each a 4x32x4 mm box with random rotation `[n*3, 0, .8+n]`.
- Forklift chain: alternating long/short link boxes (`B%2 ? .034 : .022`) every ~0.058 m.
- Mooring bollard: 6 bolts around the base (alternating `.026` radius hex + `.013` stud).
These cost few triangles because each is 6-8 segments but make a big difference at the player's distance (1-5 m).

### 3.5 Decals and stencil text
Text and warning labels are **textured quads 1-2 mm off the surface**, not geometry, with a per-text `distress` value (0.1 clean, 0.2-0.3 normal, 0.5-0.6 heavy wear). Details: container ID has a proper owner prefix + 6 digits + check digit (e.g. `SLTU 482915 7`), ISO type code (22G1/42G1/45G1) and MAX GROSS/TARE/NET/CU.CAP rows with real numbers; guard booth reads "GATE CONTROL"; reefer has "KELVAR MARINE REFRIGERATION"; barrels have "UN 1202"; pipes have "API 5L X52  273.1 x 12.5  HEAT 40719". On corrugated surfaces the decal is **swept on the same corrugated profile** (the `F` function, 790-810: same `Uc`+`la` with an offset of 3 mm and UV generated from profile coordinates), so the text follows the waves. On cylinders `cdecal` wraps around (a section of a cylinder).
Texture size is controlled by passing a target height and a max width; if the text is too wide, scale down (`Pe > Te && (ce *= Te/Pe)`).
Grime and rust-run decals are scattered randomly per side (1-3 for a container, 1.6x for 40 ft), with `rust_run` at 60% and `grime_streak` at 40%, hanging from the roof edge.

### 3.6 Seeded rng and variation without repeated look
- Seed hierarchy: containers `seed%6` -> cached geometry; clutter `seed%2..4` for the clone cache; inside the Kit a per-prop rng `il((seed+1)*7919 + name.length*131)`. `rng.range`, `.int`, `.pick`, `.sign`, `.fork` exist.
- Jitter for every "identical" part: pallet board +/-3 mm in position, +/-0.006 rad in yaw; pallet boards each get a random tint (`.62..1`, with G and B at 0.93 and 0.82 times); box stack position +/-15 mm; pallet stack each pallet rotated +/-0.035 rad and 30% flipped; tire stack rotation random around y and +/-22 mm offset; plank UV offsets (`rand*3`) so grain differs per plank.
- Wear is quantised so cache hits are likely: `wear` rounds to 0, 0.5, 1.
- Placement-level variation comes from the level (seed, yaw, `color` from an 8-colour list `[red, blue, green, yellow, orange, white, grey, teal]` picked by `(seed*7+3)%8`).

### 3.7 Geometry deformation for organic shapes
`to(geo, fn)` (2780) runs a callback over vertices; `gr` (2787) recomputes normals by **welding positions** (so a subdivided box deformed by noise keeps smooth shading). Used for: sandbags (belly bulge `1-0.22*|x|^2.5`, pinched ends, 14 mm noise), crushed cardboard, deformed trash bags, IBC tote bulge, counterweight, rubber seat (cos pattern), jerry can shoulder, tarp. The result is that "soft" objects don't look like cubes. Subdivision counts are low (3x3x3 to 8x6x8).

### 3.8 Lathe profiles with normals
`us(points, seg)` (2652-2698) lathes a 2D profile with **per-vertex normals from the averaged tangent of neighbouring segments** (hard edges are handled by duplicating a point: `[.262,.016],[.262,.016]`, a zero-length segment is skipped). This gives crisp rims on barrels (22 segments), tyres (16-24), cylinders, cones, bollards with only 10-20 profile points, and avoids the faceting of default `CylinderGeometry`. Barrel profile (OA, 3140-3150) includes chine, 2 rolling hoops (`.283-.297`), lid rim.

### 3.9 Hollow things are hollow
Pipes: outer shell + `M1`-flipped inner shell + end rings. Barrels with `open:true` have an interior bowl. Container interior is a separate inward-facing corrugated shell with its own floor. The extruded-polygon helper `Mo` (2862) gives walls with thickness for dumpsters/forklift forks.

---

## 4. Performance

- **Draw calls**: each prop ends as 1 mesh per material, usually 3-8 meshes (container: ~3 meshes: paint with vertex colours, steel, wood plus decals which each have their own material, so about 8-12). The level merge (`By`) then fuses props sharing material+shadow flags into **one mesh per material for the whole yard** (static root). So the draw call count is "number of distinct materials x cast/receive combinations", not number of props. That is why there are only a few dozen materials, all named and cached.
- **Material count is controlled** by vertex colours: a single `paint_*` material carries rust, dirt and colour tint. Level code also swaps flat materials for their `vertexColors:true` twin when all siblings are merged.
- **Geometry caches** (container variants, barrel, pallet, cones, jerry cans via `wf`) mean building cost is paid once; each instance is a clone sharing buffers. Container variants: `6 seeds x doors(0..1 step .1) x wear(3 steps)` but only those requested are built.
- **Triangle budget** (rough): container ~25-35k triangles (corrugation on 6 faces, interior, 8 castings...). It is the heaviest and is mitigated by (a) the trapezoid wave using 4 vertices/period, (b) ~6 cached variants, (c) non-visible faces rarely present (interior only for open doors, `T = doors > .03`: **the interior is built only when the doors open**). Forklift ~15-20k, guard booth ~5k, barrel ~1k, pallet ~1.5k, cone ~600, light mast ~3k. Segment counts used: 5-8 for tiny details, 12-14 for small/medium cylinders, 18-24 for big round things (barrel 22, tyre 16-24, wheel 24).
- **Open-ended cylinders** (`open:true`) used wherever caps are hidden (posts, pipes, rods). `flat:true` uses non-indexed hexagonal flat shading only for nuts.
- Dynamic bits are isolated (`noMerge`) so the merger doesn't bake them.
- Cheap collision: AABBs, not mesh; yawed ones are sliced. 12 stair colliders rather than a ramp.
- Lights are not created in the props: only a `lamps` descriptor is exposed so the level decides how many real shadow-casting lights to spend.

---

## 5. The showcase (`showcase(ctx)`, `AA`, lines 23-42)

A function exported next to `create` and `register` (`export {PROP_SIZES, create, register, showcase}`). Each module in the game has one, and a harness (query string params, e.g. `names=barrel,pallet`) calls it with the scene. Behaviour:
- Takes `params.names` (comma list) or all registered names.
- Builds each with `seed: 7` and `doors: .6` for containers (so the open-door variant is always visible).
- **Row layout**: cursor `x` advances by `size[0] + 1` m; when `x + width > 26` m it wraps to a new row at `z += rowDepth + 1.5`. Everything sits on y = 0.
- Returns `{cam, target}`: camera at `[mid - 4, 2.2, lastRowZ + rowDepth + 6]`, looking at `[mid, 1, z/2]`, i.e. slightly right of centre, at eye height 2.2 m looking at 1 m, which is a three-quarter front view at human scale.
- Fallback size comes from the `PROP_SIZES` table so even missing builders show up as a grey box with the right footprint.
The benefit: one URL shows all 36 props at true scale in the same lighting as the game, which is how the author could screenshot and compare detail quickly.

---

## 6. Why it looks good: concrete decisions

1. **Real-world dimensions from a table** ( `Bc = 2.438`, container table 429-452, `Gi`). Containers 2.438 wide, 20 ft = 6.06, pallet 1.2x1.0x0.144, EUR pallet board counts, cone 0.7 m. Correct scale and proportions make things read as real before any detail is added.
2. **Real geometry for the one signature feature** (corrugation) instead of normal maps, with the ISO pitch and depth.
3. **Everything bevelled** (`p3`, `Ge`) with ~1 cm radius so edges catch the sunset light.
4. **Vertex-colour AO + dirt gradient in every material** (`finish` 3084-3099): contact darkening up to 20 cm, valley AO, top-edge rust streaks, warm-shifted shadows. No bake step, no textures.
5. **Seeded imperfection**: jitter on position/rotation/tint for "identical" parts (pallet boards, box stacks, tires, doors open at different angles `112deg` vs `100deg`, 20% broken boards, tilt jitter on sign plates).
6. **Text that means something**: stencilled IDs with check digits, load ratings, spec stamps. These small readable details communicate "industrial site" more than any colour.
7. **Decals follow the surface** (790-810, `cdecal` 3068): labels are swept along the same corrugation or wrapped around the cylinder, never a floating flat quad.
8. **Story-bearing scatter**: rust runs and grime streaks at the roof edge and under seams (831-839), leak stains under valves, scorch under an exhaust, toolbox with items on top, drawers ajar, a glove, a hose lying curved. Props show use, not just form.
9. **Deformation for soft things** (`to`+`gr` welded normals, 2780-2816): sandbags, trash bags, boxes, tarp draped over blocks using a height-field (4175-4200), so organic objects are not boxes.
10. **Second-scale hardware**: bolts, hinges, locking rods, rivets, chain links (3.4). 4-8 segment details placed at real spacing.
11. **Emissive accents** on a few props (lamp lenses, screen, LED `mats.emissive`) plus `lamps` descriptors, so the dusk lighting has believable sources and bloom hits.
12. **Robustness**: try/catch fallback to a correct-footprint box, caches keyed by quantised params, and fully-named material library make it possible to build 36 props in one session without any crash blocking the rest.

---

## 7. Reusable pseudo-code

### A. Trapezoid-corrugated wall with valley AO (container side)
```
wave(x) = depth(x mod period)   // 0 flat | slope down | -depth valley | slope up
xs = sampleOnlyCorners(x0, x1, period, depth, flatLen, slopeLen)   // 4 per period
rows = [0, 0.167, 0.44, 1.25, H-0.5, H-0.06]                       // stop wave before rails
geo = sweep(xs, rows, (x, y, z) => [x, y, side*(halfW + wave(x) - dents(x,y))])
for v in geo.vertices:
    c = baseNoise(v)                      // low-freq 0.16 + high-freq 0.06
    valley = smoothstep(0.008, 0.034, halfW - abs(v.z))
    c *= 1 - 0.18*valley                  // deeper = darker
    c = lerp(c, c*[.62,.38,.24], streakMask(v.x, v.y) * smoothstep(H-.75, H-.06, v.y))
geo.setColors
```

### B. Kit builder with baked-tint buckets
```
class Kit { stack=[I]; buckets={}  rng=seeded(seed*7919+name.length*131)
  add(matName, geo, {p,r,s}, tint=1):
     geo.apply(stack.top * compose(p,r,s))
     multiplyVertexColor(geo, tint)           // number | [r,g,b] | fn(x,y,z)
     bucket[mat.uuid + castFlag].push(geo)
  finish:  for each bucket: g = merge(geos); grimePass(g); mesh(g, mat); attach size+colliders }
grimePass: c *= (.82+.18*n(p*1.9))*(.92+.08*n(p*9))*(.76+.24*clamp(ny*.6+.62))
           m = clamp(1 - y/0.2);  c.rgb *= 1 - .42*m*m*(.55+.45*n) * [1, .95, .88]
```

### C. Welded-normal deformation for soft objects
```
geo = roundedBox(w,h,l, r, segs=3,3,3)
for v in geo.vertices:
    v.z *= 1 - .22*abs(x/(w/2))^2.5          // pinched ends
    v.y += .016*cos(pi/2*x')*cos(pi/2*z')    // belly bulge
    v += (noise(v*9+seed)-.5) * [.014, .014, .016]
geo.normals = averageNormalsByPosition(geo, quantise=1/2000)   // weld seams
vertexColor = tint * (.85+.15*noise)         // one fabric material, per-bag brightness
```

### D. Cheap prop contract
```
register("name", (G, opts) => {
   kit = Kit(G, "name", opts.seed)
   ...add parts...
   return kit.finish({size, colliders:[{min,max,surface}]})
})
cache heavy ones by quantised(opts) key; clone(true) per instance
level: build -> position -> add colliders (slice yawed long boxes) -> mergeStatic(by material)
```

---
