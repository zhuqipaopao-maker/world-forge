// ART BIBLE IN CODE — the one place that fixes the look.
// Fill this from BRIEF.md before writing any module. Every module reads colours,
// light and scale from here; nothing else hard-codes a palette.
import * as THREE from 'three';

const C = (r, g, b) => new THREE.Color(r, g, b); // linear-ish floats, 0..1+

// Playable bounds (metres). Keep it small: one dense place beats a big empty one.
export const WORLD = {
  min: new THREE.Vector3(-30, 0, -30),
  max: new THREE.Vector3(30, 20, 30),
  groundY: 0,
};

// Key light. One dominant light direction + one colour story (warm key vs cool fill).
export const SUN = {
  dir: new THREE.Vector3(0.8, 0.25, 0.4).normalize(), // low sun = long shadows, rim light
  color: C(1.0, 0.72, 0.45),
  intensity: 5,
};

export const SKY = {
  zenith: C(0.16, 0.24, 0.38),
  horizon: C(1.6, 0.95, 0.55),      // horizon toward the sun (HDR > 1 is fine: it blooms)
  horizonAway: C(0.42, 0.5, 0.62),  // horizon opposite the sun
  fog: C(0.5, 0.55, 0.62),      // only used as a background fallback; fog colour = horizon colour per direction
  fogDensity: 0.006,             // extinction per metre at ground level (height fog, see render.js)
  fogStart: 0,                   // metres of clear air before the haze starts (overcast/rain: 10-15 keeps the near walls contrasty)
  fogHeight: 10,                 // metres over which fog density falls to 1/e
  fogBase: 0,                    // height where density = fogDensity
  fogGlow: 1.2,                  // sun glow inside the fog when looking toward the sun
};

// hemisphere fill + environment-map strength. Check the luma numbers from tools/shot.mjs (target mean ~0.29, p95 ~0.69).
export const AMBIENT = { sky: C(0.45, 0.52, 0.65), ground: C(0.16, 0.13, 0.11), intensity: 0.7, env: 1.0 };

// Weather: 'rain' | 'snow' | 'none'; amount 0..1. Also set SURFACE.wet / SURFACE.snow (mats.js) for the ground.
export const WEATHER = { type: 'rain', amount: 1 };

// Accent colours used sparingly (signage, objectives, danger). 2–3 max.
export const ACCENT = { objective: C(0.2, 0.9, 1.0), danger: C(1.0, 0.25, 0.15), lamp: C(1.0, 0.62, 0.3) };

export const PLAYER = { eye: 1.68, crouchEye: 1.05, radius: 0.32, height: 1.8, fov: 72 };

// Post: grade numbers live here so the look is tuned in one file.
export const GRADE = {
  exposure: 0.72,                // applied before tone mapping (final pass); tune with shot.mjs luma
  agx: 0.25,                     // 0 = pure ACES (punchy), 1 = pure AgX (soft highlights)
  split: 1.0,                    // split-tone strength: teal shadows / warm highlights
  ao: 0.85,                      // GTAO blend (quality.ao tiers only)
  bloomStrength: 0.25, bloomRadius: 0.5, bloomThreshold: 1.0,   // HDR threshold: only lights, sun, flashes bloom
  vignette: 0.28, grain: 0.03, saturation: 1.0, contrast: 1.05,
  lift: C(0.0, 0.004, 0.01), gain: C(1.0, 0.99, 0.97),
};
