// Quality tiers. Every expensive feature reads its budget from ctx.quality,
// so a slow machine still gets the same composition, just cheaper.
// tex = texture size of the GPU-baked material sets (src/modules/mats.js).
export const TIERS = {
  // "test" = quick smoke shots (?q=test). Review shots use "high" so they show what the player sees.
  // ao = GTAO pass (re-renders the scene, ~3x frame time): ultra only. detail scales tree/prop density (your code reads it).
  test:   { name: 'test', pixels: 1.2e6,   scale: 1.0,  msaa: 0, shadow: 1024, tex: 256,  ao: false, bloom: true, particles: 0.4, detail: 0.5 },
  low:    { name: 'low', pixels: 0.9e6,    scale: 0.7,  msaa: 0, shadow: 1024, tex: 512,  ao: false, bloom: true, particles: 0.5, detail: 0.5 },
  medium: { name: 'medium', pixels: 1.5e6, scale: 0.85, msaa: 2, shadow: 2048, tex: 1024, ao: false, bloom: true, particles: 0.8, detail: 0.75 },
  high:   { name: 'high', pixels: 2.3e6,   scale: 1.0,  msaa: 2,   /* msaa 4 on the half-float target doubled frame time (62 vs 29 ms, night-metro) */ shadow: 2048, tex: 1024, ao: false, bloom: true, particles: 1.0, detail: 1.0 },
  ultra:  { name: 'ultra', pixels: 3.7e6,  scale: 1.0,  msaa: 4, shadow: 4096, tex: 2048, ao: true,  bloom: true, particles: 1.0, detail: 1.0 },
};

// Pick a tier from the URL (?q=) or from the GPU string.
export function pickQuality(name) {
  if (name && TIERS[name]) return { ...TIERS[name] };
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
  if (mobile) return { ...TIERS.low };
  let gpu = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {}
  const weak = /SwiftShader|llvmpipe|Software|Mali|Adreno|PowerVR/i.test(gpu) || (/Intel/i.test(gpu) && !/Arc/i.test(gpu));
  return { ...(weak ? TIERS.medium : TIERS.high), gpu };
}
