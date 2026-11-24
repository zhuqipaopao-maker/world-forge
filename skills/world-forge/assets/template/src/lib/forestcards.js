// FOREST CARDS: tens of thousands of cheap trees for far slopes and ridgelines. Each tree is ONE camera-facing quad
// (turns about its vertical axis, so it never shows its edge) with a canvas-drawn silhouette from a 16-shape atlas:
// 8 conifers (fir/spruce) and 8 broadleaf crowns. The fragment shader gives each card a 3D normal (a cone for
// conifers, a lumpy dome for broadleaf), so the sun lights one side of every crown and the other side falls into
// shade: a slope reads as thousands of round lit volumes, not a painted backdrop. Real 3D trees (lib/vegetation.js)
// are for the near band; these are for beyond ~150 m.
//   import { makeForestCards } from '../lib/forestcards.js';
//   makeForestCards(ctx, spots)   // spots: [{ x, y, z, h (height m), k (shade 0.5-1.4), broad (bool), tint: [r,g,b] }]
import * as THREE from 'three';

const NV = 16;

function atlas() {
  const W = 256 * NV, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  let q = 13; const r = () => ((q = (q * 16807) % 2147483647) - 1) / 2147483646;
  g.clearRect(0, 0, W, H);
  for (let v = 0; v < 8; v++) {   // conifers: tiers of drooping branches, a broken top on one
    const x0 = v * 256, cx = x0 + 128 + (r() - 0.5) * 20, top = 14 + r() * 60, base = 500, slim = 0.6 + r() * 0.6, broken = v === 6;
    g.fillStyle = '#2a2018'; g.fillRect(cx - 4, base - 80, 8, 80);
    const tiers = 16 + Math.floor(r() * 14);
    for (let t = 0; t < tiers; t++) {
      const f = t / tiers, y = top + f * (base - 60 - top), half = (6 + f * 108) * slim * (0.7 + r() * 0.6) * (broken && f < 0.25 ? 0.3 : 1);
      const shade = 34 + r() * 26;
      g.fillStyle = `rgb(${shade * 0.62 | 0},${shade + 20 | 0},${shade * 0.66 | 0})`;
      g.beginPath(); g.moveTo(cx, y - 8 - f * 6);
      for (let s = -1; s <= 1; s += 2) { const n = 7; for (let k = 0; k <= n; k++) { const u = k / n; g.lineTo(cx + s * half * u + (r() - 0.5) * 6, y + u * u * 26 + (r() - 0.5) * 7 + (k % 2) * 5); } g.lineTo(cx, y + 6); }
      g.closePath(); g.fill();
    }
  }
  for (let v = 8; v < NV; v++) {   // broadleaf: a crown of overlapping leaf clumps, ragged edge, gaps, a trunk below
    const x0 = v * 256, cx = x0 + 128 + (r() - 0.5) * 16, top = 30 + r() * 70, bot = 330 + r() * 90, wide = 70 + r() * 45;
    g.strokeStyle = '#2b2219'; g.lineWidth = 9; g.beginPath(); g.moveTo(cx, 505); g.lineTo(cx + (r() - 0.5) * 14, bot - 30); g.stroke();
    g.lineWidth = 4; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(cx, bot - 10); g.lineTo(cx + (r() - 0.5) * wide * 1.2, bot - 60 - r() * 60); g.stroke(); }
    const n = 70 + Math.floor(r() * 40);
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, rr = Math.sqrt(r()), y = top + (bot - top) * (0.5 + 0.5 * Math.sin(a) * rr * 0.95), ry = (y - top) / (bot - top);
      const x = cx + Math.cos(a) * rr * wide * (0.55 + 0.45 * Math.sin(ry * Math.PI));
      const rad = 10 + r() * 22, shade = 30 + r() * 30 - ry * 10;
      g.fillStyle = `rgb(${shade * 0.72 | 0},${shade + 16 | 0},${shade * 0.55 | 0})`;
      g.beginPath(); for (let j = 0; j < 9; j++) { const b = j / 9 * Math.PI * 2, rj = rad * (0.75 + r() * 0.4); g.lineTo(x + Math.cos(b) * rj, y + Math.sin(b) * rj * 0.85); } g.closePath(); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export function makeForestCards(ctx, spots, { atlas: photo = null, broadHalf = false } = {}) {   // photo: an RGBA texture laid out like atlas() (16 cells of 256x512; broadHalf: broadleaf trees fill only the lower half of their cell)
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); geo.setIndex([0, 1, 2, 0, 2, 3]);
  const variant = new Float32Array(spots.length); spots.forEach((s, i) => (variant[i] = (s.broad ? 8 : 0) + Math.floor(Math.random() * 8)));
  geo.setAttribute('aVar', new THREE.InstancedBufferAttribute(variant, 1));
  const mat = new THREE.MeshStandardMaterial({ map: photo || atlas(), alphaTest: photo ? 0.4 : 0.5, side: THREE.DoubleSide, roughness: 0.92, metalness: 0, envMapIntensity: 0.35 });
  mat.alphaToCoverage = true;
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n#define BROADHALF ' + (broadHalf ? 'true' : 'false') + '\nattribute float aVar; varying vec2 vCard; varying float vBroad; varying vec3 vBR, vBU, vBF;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vec2((uv.x + aVar) / 16.0, uv.y * (BROADHALF && aVar > 7.5 ? 0.5 : 1.0));\n#endif\n vCard = uv; vBroad = step(7.5, aVar);')
      .replace('#include <project_vertex>', `
        vec3 ctr = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);
        vec3 toCam = cameraPosition - ctr; toCam.y = 0.0; toCam = normalize(toCam + vec3(1e-4, 0.0, 0.0));
        vec3 rightW = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        vec3 wp = ctr + rightW * position.x * sx + vec3(0.0, 1.0, 0.0) * position.y * sy;
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vBR = (viewMatrix * vec4(rightW, 0.0)).xyz; vBU = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz; vBF = (viewMatrix * vec4(toCam, 0.0)).xyz;`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vCard; varying float vBroad; varying vec3 vBR, vBU, vBF;')
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        {
          float nx = (vCard.x - 0.5) * 2.0;
          vec3 nc = vec3(nx * 1.1, 0.5, sqrt(max(0.05, 1.0 - nx * nx)));                       // conifer: a cone
          float ny = (vCard.y - 0.62) * 2.6;
          vec3 nb = vec3(nx * 1.2, ny * 0.9 + 0.35, sqrt(max(0.05, 1.0 - nx * nx - ny * ny * 0.5)));   // broadleaf: a dome
          vec3 nn = normalize(mix(nc, nb, vBroad));
          normal = normalize(nn.x * vBR + nn.y * vBU + nn.z * vBF);
          nonPerturbedNormal = normal;
        }`);
  };
  mat.customProgramCacheKey = () => 'forestcards2' + (broadHalf ? 'h' : '');
  const im = new THREE.InstancedMesh(geo, mat, spots.length); im.castShadow = false; im.receiveShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  spots.forEach((s, i) => {
    const b = !!s.broad, h = (s.h || 18) * (b ? 0.55 + Math.random() * 0.4 : 0.6 + Math.random() * 0.7), w = h * (b ? (broadHalf ? 0.95 + Math.random() * 0.15 : 0.75 + Math.random() * 0.35) : 0.45 + Math.random() * 0.12);
    m.compose(new THREE.Vector3(s.x, s.y - 0.5, s.z), q, new THREE.Vector3(w, h, w)); im.setMatrixAt(i, m);
    const k = s.k ?? 1, t = s.tint || [1, 1, 0.95]; c.setRGB(k * t[0], k * t[1], k * t[2]); im.setColorAt(i, c);
  });
  im.computeBoundingSphere();
  im.frustumCulled = false; im.userData.noAO = true; im.userData.veg = true; ctx.scene.add(im);
  return im;
}
