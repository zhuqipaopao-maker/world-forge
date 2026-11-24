// Material recipes, baked on the GPU. Each recipe writes:
//   alb (linear albedo), rough, metal, ao, h (height 0..1, for the normal map), mask (paint/tint mask 0..1)
// Rules that make them read as real (see references/render-and-materials.md §4):
//   * layered damage, not one noise: base -> wear -> dirt -> streaks -> scratches
//   * damage clustered in zones (most of the surface clean, some badly worn)
//   * roughness varies with every layer; height encodes the layers
//   * colours are desaturated real-world values
// Add a recipe: write S_<name>(...) here and an entry in RECIPES in src/modules/mats.js.
export const RECIPES_GLSL = /* glsl */ `
#define ARGS vec2 uv, inout vec3 alb, inout float rough, inout float metal, inout float ao, inout float h, inout float mask

void S_concrete(ARGS) {
  float big = fbm(uv, 3.0, 5, 1.0), mid = fbm(uv, 12.0, 4, 2.0), fine = fbm(uv, 64.0, 3, 3.0);
  vec4 pores = voronoi(uv, 90.0, 4.0); float pore = 1.0 - smoothstep(0.0, 0.12, pores.x);
  float form = fbm(uv, vec2(2.0, 14.0), 3, 5.0);                       // form-work streaks
  float crack = 1.0 - smoothstep(0.0, 0.006, abs(fbm(uv + 0.05 * vec2(fbm(uv, 6.0, 3, 6.0)), 3.0, 5, 7.0) - 0.5)); // hairline isolines
  crack *= smoothstep(0.62, 0.72, fbm(uv, 2.0, 3, 8.0));              // cracks only in a few zones
  float stain = smoothstep(0.5, 0.8, fbm(uv, 2.0, 5, 9.0));
  vec3 base = vec3(0.42, 0.41, 0.39) * (0.82 + 0.35 * big + 0.12 * mid + 0.08 * form);
  alb = base * (1.0 - 0.35 * stain * vec3(0.9, 1.0, 1.1)) * (1.0 - 0.4 * pore) * (1.0 - 0.5 * crack);
  rough = 0.86 - 0.12 * stain + 0.08 * fine; ao = 1.0 - 0.5 * pore - 0.4 * crack;
  h = 0.5 + 0.12 * mid + 0.05 * fine - 0.25 * pore - 0.3 * crack;
}

void S_asphalt(ARGS) {
  vec4 s1 = voronoi(uv, 110.0, 11.0), s2 = voronoi(uv, 230.0, 12.0);
  float stone = smoothstep(0.42, 0.18, s1.x) * step(0.35, s1.z), stone2 = smoothstep(0.4, 0.2, s2.x) * step(0.5, s2.z);
  float tar = 0.11 + 0.04 * fbm(uv, 8.0, 4, 13.0);
  vec3 sc = mix(vec3(0.32, 0.31, 0.3), vec3(0.4, 0.36, 0.3), s1.w);
  float wear = smoothstep(0.45, 0.75, fbm(uv, 3.0, 4, 14.0));             // worn patches show more stones
  alb = mix(vec3(tar), sc, max(stone * (0.35 + 0.65 * wear), stone2 * 0.5));
  float sealed = 1.0 - smoothstep(0.0, 0.012, abs(fbm(uv, 4.0, 4, 15.0) - 0.5)); // tar-sealed crack lines
  float oil = smoothstep(0.62, 0.8, fbm(uv, 2.0, 4, 16.0));
  alb *= (1.0 - 0.5 * sealed) * (1.0 - 0.45 * oil);
  rough = mix(0.93, 0.74, stone) - 0.4 * sealed - 0.35 * oil; ao = 1.0 - 0.3 * (1.0 - stone) * fbm(uv, 64.0, 2, 17.0);
  h = 0.4 + 0.45 * stone + 0.2 * stone2 - 0.15 * sealed;
}

// paint over steel: mask=1 where paint survives (tinted by material colour), bare/rust where chipped
void S_painted_metal(ARGS) {
  float zone = smoothstep(0.55, 0.8, fbm(uv, 3.0, 4, 21.0));                 // damage is clustered
  // chips: irregular flakes = warped noise threshold, denser in damage zones (not round voronoi dots)
  vec2 wq = uv + 0.02 * vec2(fbm(uv, 24.0, 3, 30.0), fbm(uv, 24.0, 3, 31.0)) - 0.01;
  float chipN = fbm(wq * vec2(1.0, 0.7), 18.0, 5, 22.0);
  float chip = smoothstep(0.66 - 0.12 * zone, 0.69 - 0.12 * zone, chipN) * (0.25 + 0.75 * zone);
  float edgeWear = smoothstep(0.62, 0.8, fbm(uv, 20.0, 3, 23.0)) * zone;
  float sc = scratches(uv, 9.0, 0.6, 0.3, 1.2, 24.0) * (0.3 + zone);
  float bare = clamp(chip + edgeWear + sc, 0.0, 1.0);
  float run = 0.0; for (int k = 1; k <= 5; k++) run += smoothstep(0.64, 0.7, fbm((wq + vec2(0.0, 0.02 * float(k))) * vec2(1.0, 0.7), 18.0, 5, 22.0)) * (1.0 - float(k) * 0.17);
  run *= smoothstep(0.4, 0.7, fbm(uv, vec2(48.0, 3.0), 3, 25.0)) * zone;      // rust runs downhill from chips
  float dirt = fbm(uv, vec2(2.0, 8.0), 4, 26.0), streak = fbm(uv, vec2(30.0, 1.0), 3, 27.0);
  vec3 steel = vec3(0.38, 0.37, 0.36), rust = vec3(0.24, 0.12, 0.06);
  vec3 under = mix(steel, rust, smoothstep(0.3, 0.7, fbm(uv, 16.0, 4, 28.0)));
  float shade = 0.42 + 0.08 * fbm(uv, 6.0, 3, 29.0) - 0.22 * smoothstep(0.4, 0.8, dirt) * smoothstep(0.35, 0.75, streak);  // x2 paint tint in the material => ~0.85 x paint colour
  alb = mix(vec3(shade), under, bare); alb = mix(alb, rust * 0.9, clamp(run * 0.8, 0.0, 0.7));
  mask = (1.0 - bare) * (1.0 - clamp(run * 0.8, 0.0, 0.7));
  rough = mix(0.42 + 0.2 * dirt, 0.75, bare); metal = bare * (1.0 - smoothstep(0.3, 0.7, fbm(uv, 16.0, 4, 28.0))) * 0.9;
  h = 0.62 - 0.26 * bare; ao = 1.0 - 0.2 * bare;
}

void S_rust(ARGS) {
  float a = fbm(uv, 6.0, 5, 31.0), b = fbm(uv, 40.0, 3, 32.0); vec4 v = voronoi(uv, 30.0, 33.0);
  vec3 c1 = vec3(0.22, 0.1, 0.05), c2 = vec3(0.42, 0.2, 0.08), c3 = vec3(0.12, 0.08, 0.06);
  alb = mix(mix(c1, c2, a), c3, smoothstep(0.6, 0.85, b)) * (0.85 + 0.3 * v.z);
  rough = 0.82 + 0.12 * b; metal = 0.15 * (1.0 - a); h = 0.5 + 0.3 * a + 0.2 * b - 0.2 * smoothstep(0.1, 0.0, v.x); ao = 0.8 + 0.2 * a;
}

// planks: 6 boards per tile along v, grain runs along u (long and fine, never blotchy)
void S_wood_planks(ARGS) {
  float boards = 6.0, row = floor(uv.y * boards), fy = fract(uv.y * boards);
  float rnd = h21(vec2(row, 1.0), 41.0);
  vec2 g = vec2(uv.x + rnd * 0.37, fy);                                      // board-local coords
  float warp = fbm(vec2(g.x, uv.y), vec2(3.0, 6.0), 3, 42.0 + row);          // slow wander of the grain
  float lines = fbm(vec2(g.x, uv.y + warp * 0.08), vec2(2.0, 110.0), 3, 45.0 + row); // fine lines across v (180 aliased into moire at 1024 px)
  float rings = smoothstep(0.3, 0.7, sin((uv.y * boards * 14.0 + warp * 2.5 + rnd * 9.0) * 3.14159) * 0.5 + 0.5);   // fine, gently wandering growth rings (wide, wavy bands read as cartoon wood)
  vec4 kv = voronoi(vec2(g.x * 3.0, uv.y), 3.0, 43.0 + row);
  float knot = smoothstep(0.06, 0.0, kv.x * vec2(1.0, 3.0).x) * step(0.82, kv.z);
  float gap = smoothstep(0.0, 0.025, fy) * smoothstep(1.0, 0.975, fy);
  float endJoint = smoothstep(0.0, 0.004, abs(fract(g.x * 1.0 + rnd) - 0.5) - 0.497);  // butt joints
  float weather = smoothstep(0.45, 0.8, fbm(uv, 4.0, 4, 44.0));
  vec3 light = vec3(0.52, 0.36, 0.22), dark = vec3(0.3, 0.18, 0.1);
  vec3 wood = mix(dark, light, 0.4 + 0.25 * lines + 0.15 * rings + 0.2 * warp) * (0.82 + 0.3 * rnd);   // grain is subtle: high-contrast fine lines read as stripes/moire
  wood = mix(wood, vec3(0.44, 0.42, 0.39) * (0.8 + 0.3 * lines), weather * 0.65);   // silver-grey weathering
  alb = wood * mix(0.22, 1.0, gap) * (1.0 - 0.55 * knot) * (1.0 - 0.6 * (1.0 - endJoint));
  rough = 0.68 + 0.18 * weather + 0.1 * lines; ao = mix(0.3, 1.0, gap);
  h = 0.45 + 0.25 * gap + 0.04 * lines * weather - 0.1 * knot;   // grain stays out of the normal map: at grazing lamp light it turns into hard stripes
}

void S_bark(ARGS) {
  float ridge = ridged(uv * vec2(1.0, 0.25), 8.0, 4, 51.0);
  float plates = voronoi(uv * vec2(1.0, 0.35), 10.0, 52.0).x;
  float moss = smoothstep(0.55, 0.75, fbm(uv, 3.0, 4, 53.0));
  vec3 c = mix(vec3(0.05, 0.04, 0.035), vec3(0.19, 0.16, 0.135), ridge);   // bark is darker than it seems
  alb = mix(c, vec3(0.16, 0.2, 0.08), moss * 0.7);
  rough = 0.9; ao = 0.5 + 0.5 * ridge; h = ridge * 0.8 + plates * 0.2;
}

void S_rock(ARGS) {
  float a = fbm(uv, 4.0, 6, 61.0), r = ridged(uv, 6.0, 5, 62.0); vec4 v = voronoi(uv, 6.0, 63.0);
  float facet = mix(1.0, smoothstep(0.0, 0.08, v.y - v.x), 0.35);   // faint fracture lines, not outlines
  float lichen = smoothstep(0.62, 0.72, fbm(uv, 8.0, 4, 64.0));
  vec3 c = mix(vec3(0.3, 0.29, 0.27), vec3(0.48, 0.46, 0.42), a) * (0.8 + 0.3 * v.z);
  alb = mix(c, vec3(0.45, 0.47, 0.3), lichen * 0.5) * facet;
  rough = 0.8 + 0.1 * a; ao = 0.75 + 0.25 * facet; h = 0.55 * a + 0.4 * r + 0.05 * facet;
}

// snow: near-white albedo, sparkle is added in the material patch (view-dependent)
void S_snow(ARGS) {
  float dune = fbm(uv, 2.0, 5, 71.0), ripple = fbm(uv * vec2(1.0, 3.0), vec2(6.0, 30.0), 3, 72.0), grain = fbm(uv, 128.0, 2, 73.0);
  alb = vec3(0.86, 0.88, 0.92) * (0.94 + 0.06 * dune);
  rough = 0.62 + 0.15 * grain; ao = 1.0; h = 0.85 * dune + 0.05 * ripple * smoothstep(0.45, 0.75, fbm(uv, 3.0, 3, 74.0)) + 0.04 * grain;   // smooth drifts, faint grain  // ripples only in wind-swept patches
}

// smooth factory or emulsion paint: no peel, no pits; the paint colour comes from the material's paint tint
void S_smooth(ARGS) {
  float a = fbm(uv, 3.0, 4, 61.0), b = fbm(uv, 24.0, 3, 62.0);
  // years outdoors: faint vertical rain streaks, speckled grime, a few scuffs (the paint tint still applies through mask)
  float st = smoothstep(0.55, 0.85, fbm(uv, vec2(26.0, 1.2), 4, 63.0)) * (0.6 + 0.4 * fbm(uv, vec2(3.0, 0.8), 3, 64.0));
  float sp = smoothstep(0.7, 0.85, fbm(uv, 40.0, 3, 65.0)), sc = smoothstep(0.82, 0.9, fbm(uv, vec2(14.0, 60.0), 3, 66.0));
  alb = vec3(0.8) * (0.94 + 0.08 * a) * (1.0 - 0.38 * st - 0.16 * sp - 0.14 * sc);
  alb = mix(alb, alb * vec3(0.96, 0.9, 0.8), st * 0.6);
  mask = 1.0; rough = 0.72 + 0.1 * b + 0.1 * st; ao = 1.0; h = 0.5 + 0.03 * b - 0.05 * sc;
}

void S_plaster(ARGS) {
  float a = fbm(uv, 3.0, 5, 81.0), b = fbm(uv, 48.0, 3, 82.0);
  float peel = smoothstep(0.66, 0.7, fbm(uv, 5.0, 5, 83.0));
  float damp = smoothstep(0.3, 0.0, uv.y) * fbm(uv, vec2(12.0, 2.0), 3, 84.0);   // rising damp at the bottom
  alb = mix(vec3(0.78, 0.74, 0.66) * (0.9 + 0.15 * a), hex(120.0, 95.0, 80.0), peel) * (1.0 - 0.35 * damp);
  mask = 1.0 - peel; rough = 0.9 - 0.1 * b; ao = 1.0 - 0.3 * peel; h = 0.5 + 0.15 * b + 0.2 * (1.0 - peel);
}

void S_roof_tiles(ARGS) {
  float rows = 8.0, cols = 6.0, r = floor(uv.y * rows); vec2 c = vec2(uv.x * cols + 0.5 * mod(r, 2.0), uv.y * rows);
  vec2 f = fract(c), id = floor(c); float rnd = h21(id + vec2(0.0, 7.0), 91.0);
  float curve = sin(f.x * 3.14159); float overlap = smoothstep(0.0, 0.15, f.y);
  float moss = smoothstep(0.6, 0.8, fbm(uv, 4.0, 4, 92.0)) * (1.0 - f.y);
  vec3 base = mix(vec3(0.22, 0.2, 0.2), vec3(0.3, 0.27, 0.25), rnd);
  alb = mix(base * (0.7 + 0.3 * curve), vec3(0.2, 0.24, 0.1), moss * 0.6) * mix(0.35, 1.0, overlap);
  rough = 0.75 + 0.1 * rnd; ao = mix(0.35, 1.0, overlap); h = curve * 0.6 * overlap + f.y * 0.3;
}

void S_dirt(ARGS) {
  float a = fbm(uv, 4.0, 5, 101.0), b = fbm(uv, 32.0, 3, 102.0); vec4 peb = voronoi(uv, 60.0, 103.0);
  float pebble = smoothstep(0.35, 0.15, peb.x) * step(0.7, peb.z);
  float wet = smoothstep(0.55, 0.75, fbm(uv, 3.0, 4, 104.0));
  alb = mix(vec3(0.2, 0.15, 0.1), vec3(0.32, 0.26, 0.19), a) * (1.0 - 0.35 * wet);
  alb = mix(alb, vec3(0.4, 0.38, 0.35), pebble);
  rough = 0.92 - 0.35 * wet; ao = 1.0 - 0.3 * (1.0 - pebble) * b; h = 0.4 * a + 0.2 * b + 0.4 * pebble;
}

void S_fabric(ARGS) {
  // weave: 64 cells per tile = 8 px per cell at 512 px (finer aliases into a plaid moire); slubs = uneven threads
  vec2 w = fract(uv * 64.0); float warp = step(0.5, w.x), weft = step(0.5, w.y);
  float weave = mix(sin(w.x * 6.283) , sin(w.y * 6.283), warp == weft ? 0.0 : 1.0) * 0.5 + 0.5;
  weave = mix(weave, 0.5, 0.65) + 0.15 * (fbm(uv * vec2(1.0, 0.1), vec2(64.0, 2.0), 2, 112.0) - 0.5);
  float stain = smoothstep(0.55, 0.8, fbm(uv, 3.0, 4, 111.0));
  alb = vec3(0.5) * (0.93 + 0.07 * weave) * (1.0 - 0.3 * stain); mask = 1.0;
  rough = 0.95; ao = 0.94 + 0.06 * weave; h = weave * 0.15 + 0.3;   // weave reads only up close; from 1-2 m canvas looks even
}

// railway ballast: packed angular granite stones, two sizes, dark gaps, rust-brown staining near the rails
void S_ballast(ARGS) {
  vec4 a = voronoi(uv, 34.0, 121.0), b = voronoi(uv + 0.37, 71.0, 122.0);
  float sa = smoothstep(0.0, 0.16, a.y - a.x), sb = smoothstep(0.0, 0.12, b.y - b.x);
  float facet = fbm(uv, 140.0, 2, 123.0);
  float stain = smoothstep(0.45, 0.8, fbm(uv, 3.0, 4, 124.0));
  vec3 stone = mix(vec3(0.27, 0.26, 0.25), vec3(0.45, 0.43, 0.4), a.z) * (0.8 + 0.35 * facet);
  stone = mix(stone, vec3(0.24, 0.15, 0.09), stain * 0.55);
  float gap = sa * mix(1.0, sb, 0.45);
  alb = stone * mix(0.12, 1.0, gap);
  rough = 0.86 - 0.08 * facet; ao = mix(0.25, 1.0, gap); h = 0.15 + 0.65 * sa * (0.6 + 0.4 * a.z) + 0.2 * sb;
}
// board-and-batten timber wall: vertical boards along u, ox-red paint (mask) peeling to grey wood
void S_timber(ARGS) {
  float boards = 8.0, col = floor(uv.x * boards), fx = fract(uv.x * boards), rnd = h21(vec2(col, 3.0), 131.0);
  float grain = fbm(vec2(fx * 0.3 + rnd, uv.y), vec2(3.0, 40.0), 3, 132.0) ;
  float lines = fbm(vec2(uv.x * 2.0 + rnd, uv.y * 0.1), vec2(160.0, 4.0), 3, 133.0 + col);
  float batten = smoothstep(0.0, 0.03, fx) * smoothstep(1.0, 0.97, fx);
  float peelN = fbm(uv + vec2(rnd, 0.0), vec2(24.0, 10.0), 5, 134.0);
  float zone = smoothstep(0.5, 0.75, fbm(uv, 2.0, 4, 135.0)) + 0.5 * smoothstep(0.35, 0.0, uv.y);   // worse low down
  float peel = smoothstep(0.69 - 0.12 * zone, 0.7 - 0.12 * zone, peelN);
  float dirt = smoothstep(0.4, 0.8, fbm(uv, vec2(6.0, 1.5), 3, 136.0));
  vec3 wood = mix(vec3(0.28, 0.26, 0.23), vec3(0.42, 0.39, 0.34), lines) * (0.85 + 0.25 * rnd);
  float shade = 0.44 + 0.06 * grain - 0.1 * dirt;
  alb = mix(wood, vec3(shade), 1.0 - peel) * mix(0.25, 1.0, batten);
  mask = (1.0 - peel) * batten;
  rough = mix(0.62 + 0.1 * dirt, 0.85, peel); ao = mix(0.35, 1.0, batten);
  h = 0.5 + 0.3 * batten + 0.08 * (1.0 - peel) + 0.04 * lines * peel;
}
// bituminous roof felt with lap seams every 0.9 m and gritty surface
void S_tarpaper(ARGS) {
  float rows = 3.0, fy = fract(uv.y * rows), seam = smoothstep(0.0, 0.02, fy) * (1.0 - 0.5 * smoothstep(0.9, 1.0, fy));
  float grit = fbm(uv, 200.0, 2, 141.0), patchy = fbm(uv, 4.0, 4, 142.0);
  alb = vec3(0.07, 0.07, 0.075) * (0.8 + 0.4 * grit + 0.3 * patchy);
  rough = 0.82 + 0.1 * grit; ao = mix(0.5, 1.0, seam); h = 0.4 + 0.3 * seam + 0.15 * grit;
}
// linear aluminium strip ceiling (fuel canopies, walkways): 100 mm strips with dark 15 mm gaps along u, water stains, dust
void S_strips(ARGS) {
  float u = uv.x * 12.0, f = fract(u), id = floor(u);
  float gap = smoothstep(0.0, 0.03, f) * smoothstep(1.0, 0.85, f);
  float rid = h21(vec2(id, 3.0), 71.0), dust = fbm(uv, 4.0, 4, 72.0), stain = smoothstep(0.62, 0.8, fbm(uv, vec2(2.0, 6.0), 5, 73.0));
  alb = vec3(0.78, 0.78, 0.76) * (0.93 + 0.07 * rid) * mix(1.0, 0.35, 1.0 - gap) * (1.0 - 0.2 * stain) * (0.95 + 0.1 * dust);
  alb = mix(alb, alb * vec3(0.95, 0.85, 0.7), stain * 0.5);
  rough = 0.45 + 0.2 * dust + 0.2 * stain; metal = 0.0; ao = mix(0.5, 1.0, gap); h = 0.5 + 0.4 * gap * sin(f * 3.14159); mask = 0.0;
}
// rolled steel (rail, bolts): grey metal, rust bloom on lower faces is added via vertex colour
void S_steel(ARGS) {
  float a = fbm(uv, vec2(40.0, 3.0), 4, 151.0), b = fbm(uv, 24.0, 4, 152.0);
  float rust = smoothstep(0.5, 0.75, b);
  alb = mix(vec3(0.42, 0.42, 0.42) * (0.85 + 0.2 * a), vec3(0.25, 0.13, 0.07), rust);
  metal = 1.0 - rust; rough = mix(0.32 + 0.12 * a, 0.85, rust); ao = 1.0; h = 0.5 + 0.1 * a - 0.15 * rust;
}
`;
