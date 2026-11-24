// FX: one CPU-simulated particle pool drawn with a single InstancedMesh per blend mode,
// plus stateless GPU weather (rain) that costs nothing on the CPU.
// Grow toward references/fx-weather.md: lit smoke with soft depth fade, layered flashes,
// light pulses, decals, debris, surface-specific impact kits.
import * as THREE from 'three';
import { SUN, WEATHER } from '../art.js';
import { worldUV, SURFACE } from './mats.js';

// Soft round sprite generated in code.
function glowTexture(size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Stateless rain: N streaks whose positions are a pure function of (seed, time, camera).
// They wrap inside a box that follows the camera, so density is constant and nothing is simulated.
// Lamps (fx.setLamps, shared with snow) light the streaks: rain is only really seen where a light catches it.
// Roofs (fx.setRoofs: up to 4 boxes [x0, z0, x1, z1, y]) keep it from falling under canopies and eaves.
// `far: true` makes a second layer for 12-45 m: only lamp-lit streaks show (the curtain in front of a lit canopy).
const RAIN_LAMPS = Array.from({ length: 6 }, () => new THREE.Vector4(0, -999, 0, 0)), RAIN_LAMPCOL = Array.from({ length: 6 }, () => new THREE.Color(0, 0, 0));
const RAIN_ROOFS = Array.from({ length: 4 }, () => new THREE.Vector4(1e9, 1e9, -1e9, -1e9)), RAIN_ROOFY = { value: [0, 0, 0, 0] };
function makeRain(ctx, count, { far = false } = {}) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { seeds[i * 3] = ctx.rng(); seeds[i * 3 + 1] = ctx.rng(); seeds[i * 3 + 2] = ctx.rng(); }
  geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 3));
  geo.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,   // the streak quad faces away for half the views: FrontSide culled ALL rain
    uniforms: { time: { value: 0 }, camPos: { value: new THREE.Vector3() }, box: { value: far ? new THREE.Vector3(90, 16, 90) : new THREE.Vector3(24, 14, 24) }, wind: { value: new THREE.Vector2(0.6, 0.2) },
      speed: { value: 9 }, len: { value: 0.55 }, sunDir: { value: SUN.dir }, sunColor: { value: SUN.color }, intensity: { value: 1 },
      lamps: { value: RAIN_LAMPS }, lampCol: { value: RAIN_LAMPCOL }, roofs: { value: RAIN_ROOFS }, roofY: RAIN_ROOFY, amb: { value: far ? 0 : (WEATHER.rainAmb ?? 1) }, fade: { value: far ? new THREE.Vector4(9, 13, 38, 48) : new THREE.Vector4(0.5, 2, 10, 13) } },
    vertexShader: `
      attribute vec3 seed; uniform float time, speed, len; uniform vec3 camPos, box; uniform vec2 wind; uniform vec3 sunDir; uniform vec4 lamps[6]; uniform vec3 lampCol[6]; uniform vec4 roofs[4]; uniform float roofY[4]; uniform vec4 fade;
      varying float vA; varying float vFwd; varying vec2 vUv; varying vec3 vLit;
      void main(){
        vec3 p = seed * box;
        p.y -= time * speed * (0.85 + seed.x * 0.3);
        p.xz += vec2(wind) * (box.y - mod(p.y, box.y)) * 0.12;
        p = mod(p - camPos + box * 0.5, box) - box * 0.5 + camPos;      // wrap around the camera
        vec3 fall = normalize(vec3(wind.x * 0.12, -1.0, wind.y * 0.12));
        vec3 side = normalize(cross(fall, normalize(camPos - p)));
        float w = 0.012 * (0.6 + 0.7 * seed.x) * max(1.0, length(camPos - p) * 0.08);          // keep >= ~1px wide far away; drops differ in size
        float under = 0.0; for (int i = 0; i < 4; i++) { vec4 r = roofs[i]; if (p.x > r.x && p.x < r.z && p.z > r.y && p.z < r.w && p.y < roofY[i]) under = 1.0; }
        // light from the lamps: a drop is a tiny lens, it flares toward the viewer when the lamp is behind it
        vec3 lit = vec3(0.0); vec3 toCam = normalize(camPos - p);
        for (int i = 0; i < 6; i++) { vec3 L = lamps[i].xyz - p; float r = lamps[i].w; float d2 = dot(L, L); float k = max(0.0, 1.0 - d2 / (r * r)); float back = 0.35 + 1.6 * pow(max(dot(-normalize(L), toCam), 0.0), 4.0); lit += lampCol[i] * k * k * back; }
        vLit = lit;
        vec3 wp = p + side * position.x * w - fall * position.y * len * (0.35 + 0.9 * fract(seed.y * 5.3));   // streak length varies (exposure catches drops mid-fall)
        vUv = position.xy + vec2(0.5, 0.0);
        vec3 view = normalize(wp - camPos);
        vFwd = pow(max(dot(view, sunDir), 0.0), 6.0);                    // drops glow when looking toward the sun
        float dc = length(camPos - p); vA = smoothstep(fade.x, fade.y, dc) * (1.0 - smoothstep(fade.z, fade.w, dc)) * (1.0 - under) * (0.25 + 0.75 * fract(seed.z * 7.31));
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 sunColor; uniform float intensity, amb; varying float vA; varying float vFwd; varying vec2 vUv; varying vec3 vLit;
      void main(){
        float a = (1.0 - abs(vUv.x - 0.5) * 2.0) * vUv.y * vA * intensity;
        if (a < 0.002) discard;
        gl_FragColor = vec4((mix(vec3(0.55, 0.6, 0.68) * 0.35, sunColor * 2.5, vFwd) * amb + vLit) * a, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 10;
  return mesh;
}

// Stateless splashes: rain hitting the ground near the camera, a tiny crown of droplets for ~0.12 s, seen only where a
// rain lamp lights it (same lamps and roofs as the rain). Ground height: flat at y (a fuel forecourt, a street).
function makeSplashes(ctx, count, { y = 0.07 } = {}) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3)); geo.setIndex([0, 1, 2, 0, 2, 3]);
  const seeds = new Float32Array(count * 3); for (let i = 0; i < count * 3; i++) seeds[i] = ctx.rng();
  geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 3)); geo.instanceCount = count;
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { time: { value: 0 }, camPos: { value: new THREE.Vector3() }, lamps: { value: RAIN_LAMPS }, lampCol: { value: RAIN_LAMPCOL }, roofs: { value: RAIN_ROOFS }, gy: { value: y }, intensity: { value: 1 } },
    vertexShader: `attribute vec3 seed; uniform float time, gy; uniform vec3 camPos; uniform vec4 lamps[6]; uniform vec3 lampCol[6]; uniform vec4 roofs[4];
      varying vec2 vUv; varying vec3 vLit; varying float vA;
      void main(){
        float R = 16.0; vec2 cell = floor(camPos.xz / R);
        float ph = fract(time * (1.6 + seed.z) + seed.x * 13.0), id = floor(time * (1.6 + seed.z) + seed.x * 13.0);
        vec2 jit = fract(vec2(sin(id * 12.9 + seed.y * 78.2), sin(id * 39.3 + seed.x * 11.7)) * 43758.5);
        vec2 xz = camPos.xz + (jit - 0.5) * R;
        vec3 p = vec3(xz.x, gy, xz.y);
        float under = 0.0; for (int i = 0; i < 4; i++) { vec4 r = roofs[i]; if (p.x > r.x && p.x < r.z && p.z > r.y && p.z < r.w) under = 1.0; }
        vec3 lit = vec3(0.0); for (int i = 0; i < 6; i++) { vec3 L = lamps[i].xyz - p; float r = lamps[i].w * 1.3; float k = max(0.0, 1.0 - dot(L, L) / (r * r)); lit += lampCol[i] * k; }
        vLit = lit; float life = 0.14; float t = ph / life; vA = step(ph, life) * (1.0 - under) * smoothstep(0.6, 2.5, length(camPos - p)) * (1.0 - smoothstep(9.0, 12.0, length(camPos - p)));
        vec3 toC = camPos - p; vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), toC));
        float sz = 0.06 + 0.05 * t; vec3 wp = p + side * position.x * sz * 1.6 + vec3(0.0, 1.0, 0.0) * position.y * sz * (0.8 - 0.3 * t);
        vUv = position.xy + vec2(0.5, 0.0); vUv.y += t * 0.0;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); vA *= 1.0 - t;
      }`,
    fragmentShader: `uniform float intensity; varying vec2 vUv; varying vec3 vLit; varying float vA;
      float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){ vec2 q = vUv - vec2(0.5, 0.0); float a = 0.0;
        for (int i = 0; i < 6; i++) { float fi = float(i); vec2 c = vec2((hh(vec2(fi, 1.0)) - 0.5) * 0.8, 0.15 + hh(vec2(fi, 2.0)) * 0.7); a += smoothstep(0.07, 0.0, length(q - c)); }
        a += smoothstep(0.12, 0.0, abs(q.y - 0.04)) * smoothstep(0.5, 0.2, abs(q.x)) * 0.5;
        a *= vA * intensity; if (a < 0.003) discard; gl_FragColor = vec4(vLit * a * 0.9, 1.0); }` });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 10; return mesh;
}

// Stateless snow: slow swirling soft flakes wrapped around the camera. Flakes glow inside lamp light
// (up to 4 lamps, set with fx.setLamps) — the signature shot of a snowy night.
function makeSnow(ctx, count) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) seeds[i] = ctx.rng();
  geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 4)); geo.instanceCount = count;
  const lamps = Array.from({ length: 4 }, () => new THREE.Vector4(0, -999, 0, 0)), lampCol = Array.from({ length: 4 }, () => new THREE.Color(0, 0, 0));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    uniforms: { time: { value: 0 }, camPos: { value: new THREE.Vector3() }, box: { value: new THREE.Vector3(30, 16, 30) }, wind: { value: new THREE.Vector2(0.5, 0.15) },
      fall: { value: 0.9 }, intensity: { value: 1 }, amb: { value: new THREE.Color(0.55, 0.6, 0.7) }, lamps: { value: lamps }, lampCol: { value: lampCol } },
    vertexShader: `
      attribute vec4 seed; uniform float time, fall; uniform vec3 camPos, box; uniform vec2 wind; uniform vec4 lamps[4]; uniform vec3 lampCol[4], amb;
      varying vec2 vQ; varying vec3 vCol; varying float vA;
      void main(){
        vec3 p = seed.xyz * box;
        p.y -= time * fall * (0.6 + seed.w * 0.8);
        p.x += sin(time * 0.7 + seed.w * 40.0) * 0.6 + time * wind.x; p.z += cos(time * 0.5 + seed.x * 30.0) * 0.6 + time * wind.y;   // swirl
        p = mod(p - camPos + box * 0.5, box) - box * 0.5 + camPos;
        float size = mix(0.012, 0.035, seed.w * seed.w);
        vec4 mv = viewMatrix * vec4(p, 1.0); float d = -mv.z;
        vec3 c0;
        size = max(size, d * 0.0011);                                          // >= ~1 px far away
        mv.xy += position.xy * size * (1.0 + 0.0);
        vec3 c = amb * 0.35;
        float lit = 0.0;
        for (int i = 0; i < 4; i++) { vec3 L = lamps[i].xyz - p; float r = lamps[i].w; float k = max(0.0, 1.0 - dot(L, L) / (r * r)); lit += k; c += lampCol[i] * k * k * 12.0; }
        vCol = c; vQ = position.xy * 2.0;
        vA = smoothstep(0.3, 1.2, d) * (1.0 - smoothstep(box.x * 0.38, box.x * 0.5, d));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float intensity; varying vec2 vQ; varying vec3 vCol; varying float vA;
      void main(){ float a = smoothstep(1.0, 0.2, length(vQ)) * vA * intensity; if (a < 0.01) discard; gl_FragColor = vec4(vCol, a); }`,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 10;
  return mesh;
}

// A soft additive light cone (lamp beam in snow/fog/rain): apex at pos, pointing along dir.
export function lampCone(pos, dir, { length = 5, radius = 1.6, color = [1, 0.7, 0.4], strength = 0.6 } = {}) {
  const g = new THREE.ConeGeometry(radius, length, 32, 8, true); g.translate(0, -length / 2, 0);
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { col: { value: new THREE.Color(...color) }, len: { value: length }, k: { value: strength } },
    vertexShader: `varying float vY; varying vec3 vN, vV; void main(){ vY = -position.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 col; uniform float len, k; varying float vY; varying vec3 vN, vV;
      void main(){ float edge = pow(abs(dot(vN, vV)), 2.0); float fall = pow(1.0 - clamp(vY / len, 0.0, 1.0), 1.6);
        gl_FragColor = vec4(col * edge * fall * k, 1.0); }` });
  const mesh = new THREE.Mesh(g, m); mesh.position.copy(pos);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize()); mesh.userData.noAO = true;
  return mesh;
}

export async function create(ctx) {
  const MAX = Math.round(2000 * ctx.quality.particles);
  const tex = glowTexture();
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: false });
  const quad = new THREE.PlaneGeometry(1, 1);
  const inst = new THREE.InstancedMesh(quad, mat, MAX); inst.frustumCulled = false; inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  ctx.scene.add(inst);
  // struct-of-arrays pool
  const P = { pos: new Float32Array(MAX * 3), vel: new Float32Array(MAX * 3), life: new Float32Array(MAX), max: new Float32Array(MAX), size: new Float32Array(MAX), grow: new Float32Array(MAX), col: new Float32Array(MAX * 3), drag: new Float32Array(MAX), grav: new Float32Array(MAX) };
  let n = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3();

  // burst(pos, {count, speed, life, size, grow, color:[r,g,b] (HDR ok), gravity, drag, spread})
  function burst(pos, o = {}) {
    const count = Math.round((o.count ?? 12) * ctx.quality.particles);
    for (let k = 0; k < count && n < MAX; k++, n++) {
      const i = n, s = o.speed ?? 3, d = o.dir || [0, 1, 0], sp = o.spread ?? 1;
      P.pos.set([pos.x, pos.y, pos.z], i * 3);
      P.vel.set([d[0] * s + (ctx.rng() - 0.5) * s * sp, d[1] * s + (ctx.rng() - 0.5) * s * sp, d[2] * s + (ctx.rng() - 0.5) * s * sp], i * 3);
      P.life[i] = P.max[i] = (o.life ?? 0.5) * (0.7 + ctx.rng() * 0.6);
      P.size[i] = (o.size ?? 0.1) * (0.7 + ctx.rng() * 0.6); P.grow[i] = o.grow ?? 0;
      P.col.set(o.color || [3, 1.8, 0.8], i * 3); P.drag[i] = o.drag ?? 1.5; P.grav[i] = o.gravity ?? -9.8;
    }
  }

  const W = WEATHER;
  const rain = makeRain(ctx, Math.round(9000 * ctx.quality.particles)), rainFar = makeRain(ctx, Math.round(26000 * ctx.quality.particles), { far: true });
  const snow = makeSnow(ctx, Math.round(7000 * ctx.quality.particles));
  const splash = makeSplashes(ctx, Math.round(1400 * ctx.quality.particles));
  rain.visible = rainFar.visible = splash.visible = W.type === 'rain'; snow.visible = W.type === 'snow';
  ctx.scene.add(rain, rainFar, splash, snow);

  return {
    rain, rainFar, splash, snow, burst, lampCone,
    // lamps that light the falling snow: [{ pos: Vector3, color: [r,g,b], range }]
    // lamps light the falling flakes AND make the settled snow glint near them (SURFACE.lamps)
    setLamps(list) { list.slice(0, 4).forEach((l, i) => { const r = l.range || 6;
      snow.material.uniforms.lamps.value[i].set(l.pos.x, l.pos.y, l.pos.z, r); snow.material.uniforms.lampCol.value[i].setRGB(...l.color);
      SURFACE.lamps.value[i].set(l.pos.x, l.pos.y, l.pos.z, r); SURFACE.lampCol.value[i].setRGB(...l.color); }); },
    // lamps that light the rain (up to 6; a canopy = 2-3 lamps spread under it): [{ pos, color: [HDR], range }]
    setRainLamp(i, pos, color, range = 8) { RAIN_LAMPS[i].set(pos.x, pos.y, pos.z, range); RAIN_LAMPCOL[i].setRGB(...color); },
    setRainLamps(list) { list.slice(0, 6).forEach((l, i) => { RAIN_LAMPS[i].set(l.pos.x, l.pos.y, l.pos.z, l.range || 8); RAIN_LAMPCOL[i].setRGB(...l.color); }); },
    // roofs that rain does not fall under: [[x0, z0, x1, z1, y]] (up to 4)
    setRoofs(list) { list.slice(0, 4).forEach((r, i) => { RAIN_ROOFS[i].set(r[0], r[1], r[2], r[3]); RAIN_ROOFY.value[i] = r[4]; }); },
    clear() { n = 0; },
    update(dt) {
      const cam = ctx.camera;
      rain.material.uniforms.time.value += dt; rain.material.uniforms.camPos.value.copy(cam.position); rainFar.material.uniforms.time.value = rain.material.uniforms.time.value; rainFar.material.uniforms.camPos.value.copy(cam.position); splash.material.uniforms.time.value = rain.material.uniforms.time.value; splash.material.uniforms.camPos.value.copy(cam.position);
      // hide rain inside interiors
      const inside = (ctx.level?.interiorBoxes || []).some((b) => b.containsPoint(cam.position));
      rain.material.uniforms.intensity.value += ((inside ? 0 : W.amount) - rain.material.uniforms.intensity.value) * Math.min(1, dt * 4);
      snow.material.uniforms.time.value += dt; snow.material.uniforms.camPos.value.copy(cam.position);
      snow.material.uniforms.intensity.value += ((inside ? 0 : W.amount) - snow.material.uniforms.intensity.value) * Math.min(1, dt * 4);
      cam.getWorldQuaternion(q);
      for (let i = 0; i < n; i++) {
        P.life[i] -= dt;
        if (P.life[i] <= 0) { // swap-remove
          n--; for (const k of ['pos', 'vel', 'col']) P[k].copyWithin(i * 3, n * 3, n * 3 + 3);
          for (const k of ['life', 'max', 'size', 'grow', 'drag', 'grav']) P[k][i] = P[k][n];
          i--; continue;
        }
        const dr = Math.exp(-P.drag[i] * dt);
        P.vel[i * 3] *= dr; P.vel[i * 3 + 1] = P.vel[i * 3 + 1] * dr + P.grav[i] * dt; P.vel[i * 3 + 2] *= dr;
        P.pos[i * 3] += P.vel[i * 3] * dt; P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt; P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
      }
      for (let i = 0; i < n; i++) {
        const t = P.life[i] / P.max[i], s = P.size[i] * (1 + P.grow[i] * (1 - t));
        m4.compose(v.fromArray(P.pos, i * 3), q, sc.set(s, s, s)); inst.setMatrixAt(i, m4);
        inst.instanceColor.setXYZ(i, P.col[i * 3] * t, P.col[i * 3 + 1] * t, P.col[i * 3 + 2] * t);
      }
      inst.count = n; inst.instanceMatrix.needsUpdate = true; inst.instanceColor.needsUpdate = true;
    },
  };
}

// ?show=fx — loops a few bursts in front of the camera so effects can be judged in stills.
export async function showcase(ctx) {
  const floor = new THREE.Mesh(worldUV(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), 4), ctx.mats.get('asphalt')); floor.receiveShadow = true; ctx.scene.add(floor);
  let t = 0;
  return {
    cam: [0, 1.6, 5], target: [0, 1, 0],
    update(dt) { t += dt; if (t > 0.6) { t = 0; ctx.fx.burst(new THREE.Vector3(0, 1, 0), { count: 30, speed: 4, life: 0.5, size: 0.08, color: [4, 2.2, 0.8] }); } },
  };
}
