// TIME OF DAY: lerp between light "keys" and move every shared light object in place.
//   import { makeTOD } from '../lib/tod.js';
//   const tod = makeTOD(ctx, [
//     { at: 0, zenith: [.03,.055,.12], horizon: [1.25,.62,.36], away: [.1,.14,.24], sun: [1,.62,.48], sunI: 1.1, sunDir: [-.94,.16,.3],
//       hemiSky: [.3,.38,.6], hemiGround: [.1,.1,.13], hemiI: .4, env: .4, exposure: .62, fogDensity: .013, fogGlow: .5 },
//     { at: 1, zenith: [.006,.011,.03], horizon: [.16,.15,.22], away: [.03,.045,.085], sun: [.62,.74,1], sunI: 1.5, sunDir: [-.62,.5,.6],
//       hemiSky: [.16,.22,.42], hemiI: .17, env: .14, exposure: .8, stars: 1, moon: 1, rim: [.2,.26,.4] },
//   ]);
//   tod.set(k)   // every frame or whenever k changes; k in [0, 1]
// Keys may leave fields out: a missing field keeps the previous key's value (and art.js for the first key).
// What it moves: SKY.zenith/horizon/horizonAway and SUN.color/dir in place (sky dome, height fog and snow
// sparkle hold these objects by reference), the sun light, the hemisphere light, environment intensity,
// exposure, fog density/glow, stars, the sun-or-moon disc, the foliage rim, and it re-captures the
// environment map when the sky has changed enough (a few ms, throttled).
import * as THREE from 'three';
import { SUN, SKY, AMBIENT, GRADE } from '../art.js';
import { FOLIAGE_RIM } from './vegetation.js';

const COLS = ['zenith', 'horizon', 'away', 'sun', 'hemiSky', 'hemiGround', 'rim', 'fogTint'];
const NUMS = ['sunI', 'hemiI', 'env', 'exposure', 'fogDensity', 'fogGlow', 'stars', 'disc', 'moon'];

export function makeTOD(ctx, keys) {
  const base = {
    zenith: SKY.zenith.toArray(), horizon: SKY.horizon.toArray(), away: SKY.horizonAway.toArray(), sun: SUN.color.toArray(), sunDir: SUN.dir.toArray(),
    hemiSky: AMBIENT.sky.toArray(), hemiGround: AMBIENT.ground.toArray(), rim: FOLIAGE_RIM.value.toArray(), fogTint: [1, 1, 1],
    sunI: SUN.intensity, hemiI: AMBIENT.intensity, env: AMBIENT.env ?? 1, exposure: GRADE.exposure, fogDensity: SKY.fogDensity, fogGlow: SKY.fogGlow ?? 1.2, stars: 0, disc: 1, moon: 0,
  };
  // fill each key from the one before, so every key is complete
  const full = []; let prev = base;
  for (const k of [...keys].sort((a, b) => a.at - b.at)) { const f = { ...prev, ...k }; full.push(f); prev = f; }
  const r = ctx.render, A = new THREE.Color(), B = new THREE.Color(), dA = new THREE.Vector3(), dB = new THREE.Vector3();
  let envAt = -1, now = -1;
  const api = {
    get k() { return now; },
    set(k) {
      k = THREE.MathUtils.clamp(k, 0, 1); now = k;
      let i = 0; while (i < full.length - 2 && k > full[i + 1].at) i++;
      const a = full[i], b = full[Math.min(i + 1, full.length - 1)];
      const t = b === a || b.at === a.at ? 0 : THREE.MathUtils.smoothstep(k, a.at, b.at);
      const col = (name, out) => out.copy(A.fromArray(a[name])).lerp(B.fromArray(b[name]), t);
      const num = (name) => a[name] + (b[name] - a[name]) * t;
      col('zenith', SKY.zenith); col('horizon', SKY.horizon); col('away', SKY.horizonAway); col('sun', SUN.color);
      SUN.dir.copy(dA.fromArray(a.sunDir).normalize()).lerp(dB.fromArray(b.sunDir).normalize(), t).normalize();
      if (r.sun) { r.sun.color.copy(SUN.color); r.sun.intensity = num('sunI'); }
      if (r.hemi) { col('hemiSky', r.hemi.color); col('hemiGround', r.hemi.groundColor); r.hemi.intensity = num('hemiI'); }
      col('rim', FOLIAGE_RIM.value);
      r.scene.environmentIntensity = num('env');
      r.setExposure(num('exposure'));
      if (r.scene.fog) { r.scene.fog.density = num('fogDensity'); col('fogTint', r.scene.fog.color); }
      SKY.fogGlow = num('fogGlow'); r.syncFogParams?.();
      const su = r.sky?.material?.uniforms; if (su) { su.stars.value = num('stars'); su.disc.value = num('disc'); su.moon.value = num('moon'); }
      if (Math.abs(k - envAt) > 0.04 || envAt < 0) { envAt = k; r.refreshEnv?.(); }
      r.updateShadows?.();
      return api;
    },
  };
  return api;
}
