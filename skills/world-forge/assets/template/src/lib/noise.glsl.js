// GLSL noise toolkit for GPU texture baking. Every function is TILEABLE: lattice
// coordinates wrap with mod(cell, period), so a texture made from them repeats with no seam
// as long as every frequency used is an integer.
export const NOISE_GLSL = /* glsl */ `
uint pcg(uint v) { uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float h21(vec2 p, float seed) { uvec2 q = uvec2(ivec2(floor(p)) + 32768); return float(pcg(q.x + pcg(q.y + pcg(uint(seed * 977.0))))) / 4294967295.0; }
vec2 h22(vec2 p, float seed) { return vec2(h21(p, seed), h21(p, seed + 17.31)); }

// gradient noise in [0,1], period P (integer, in cells)
float gnoise(vec2 x, vec2 P, float seed) {
  vec2 i = floor(x), f = fract(x), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  #define G(o) (dot(h22(mod(i + o, P), seed) * 2.0 - 1.0, f - o))
  float a = G(vec2(0,0)), b = G(vec2(1,0)), c = G(vec2(0,1)), d = G(vec2(1,1));
  #undef G
  return 0.5 + 0.7 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// fbm over uv in [0,1): base frequency F (integer or vec2 of integers), octaves N
float fbm(vec2 uv, vec2 F, int N, float seed) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int k = 0; k < 8; k++) { if (k >= N) break; s += a * gnoise(uv * F, F, seed + float(k) * 13.7); n += a; a *= 0.5; F *= 2.0; }
  return s / n;
}
float fbm(vec2 uv, float F, int N, float seed) { return fbm(uv, vec2(F), N, seed); }
// ridged fbm (cracks, veins)
float ridged(vec2 uv, float F, int N, float seed) { float s = 0.0, a = 0.5, n = 0.0; vec2 f = vec2(F);
  for (int k = 0; k < 8; k++) { if (k >= N) break; s += a * (1.0 - abs(gnoise(uv * f, f, seed + float(k)) * 2.0 - 1.0)); n += a; a *= 0.5; f *= 2.0; } return s / n; }

// Worley / Voronoi: returns (F1, F2, cell random, cell random 2). Tileable with period F.
vec4 voronoi(vec2 uv, float F, float seed) {
  vec2 x = uv * F, i = floor(x), f = fract(x); float d1 = 9.0, d2 = 9.0; vec2 id = vec2(0);
  for (int y = -1; y <= 1; y++) for (int xx = -1; xx <= 1; xx++) {
    vec2 o = vec2(xx, y), c = mod(i + o, vec2(F)), p = o + h22(c, seed) - f; float d = length(p);
    if (d < d1) { d2 = d1; d1 = d; id = c; } else if (d < d2) d2 = d;
  }
  return vec4(d1, d2, h21(id, seed + 3.1), h21(id, seed + 9.7));
}
// random straight scratches: density per cell, angle spread around a base angle
float scratches(vec2 uv, float F, float density, float baseAngle, float spread, float seed) {
  vec2 x = uv * F, i = floor(x); float s = 0.0;
  for (int y = -1; y <= 1; y++) for (int xx = -1; xx <= 1; xx++) {
    vec2 c = mod(i + vec2(xx, y), vec2(F)); if (h21(c, seed) > density) continue;
    vec2 p = i + vec2(xx, y) + h22(c, seed + 5.0); float a = baseAngle + (h21(c, seed + 7.0) - 0.5) * spread;
    vec2 d = vec2(cos(a), sin(a)), r = x - p; float along = dot(r, d), across = abs(dot(r, vec2(-d.y, d.x)));
    float len = 0.3 + 0.6 * h21(c, seed + 11.0);
    s = max(s, (1.0 - smoothstep(0.0, 0.012, across)) * (1.0 - smoothstep(len * 0.6, len, abs(along))));
  }
  return s;
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 hex(float r, float g, float b) { return pow(vec3(r, g, b) / 255.0, vec3(2.2)); } // sRGB swatch -> linear
`;
