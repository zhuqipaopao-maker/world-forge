// MATERIALS: every texture is a function, baked ON THE GPU at boot (fast enough for 1–2k px sets).
// A recipe (src/lib/recipes.glsl.js) writes albedo/roughness/metal/ao/height/mask per pixel;
// the baker renders it into textures, derives a normal map from the height, and builds a
// MeshStandardMaterial patched with world-space effects shared by every material:
//   macro variation (no visible tiling) · paint tint through the mask · wetness · snow cover + sparkle ·
//   Toksvig roughness (no specular shimmer).
// Global weather knobs: import { SURFACE } and set SURFACE.wet.value / SURFACE.snow.value (0..1).
import * as THREE from 'three';
import { NOISE_GLSL } from '../lib/noise.glsl.js';
import { RECIPES_GLSL } from '../lib/recipes.glsl.js';
import { loadPhotoSets } from '../lib/photo.js';
import { SUN } from '../art.js';

// name -> { recipe, metres (texture repeat size), size (fraction of quality.tex), bump (normal strength),
//           paint [r,g,b] (tints mask=1 areas), rough/metal multipliers, wet [darken, roughMul, streak, on], snow (0/1 accepts snow) }
export const MATERIALS = {
  concrete:      { recipe: 'concrete', metres: 3, bump: 1.2, wet: [0.42, 0.38, 0.5, 1], snow: 1 },
  asphalt:       { recipe: 'asphalt', metres: 2, bump: 2.5, wet: [0.45, 0.3, 0.5, 1], snow: 1 },
  painted_metal: { recipe: 'painted_metal', metres: 2, bump: 1.5, paint: [0.49, 0.13, 0.1], wet: [0.05, 0.62, 0.65, 1], snow: 1 },
  painted_blue:  { recipe: 'painted_metal', metres: 2, bump: 1.5, paint: [0.12, 0.23, 0.4], wet: [0.05, 0.62, 0.65, 1], snow: 1 },
  rust:          { recipe: 'rust', metres: 1.5, bump: 2.0, wet: [0.3, 0.6, 0.6, 1], snow: 1 },
  wood_planks:   { recipe: 'wood_planks', metres: 1.2, bump: 2.0, wet: [0.35, 0.55, 0.6, 1], snow: 1 },
  bark:          { recipe: 'bark', metres: 1.0, bump: 4.0, size: 0.5, wet: [0.3, 0.6, 0.6, 1], snow: 0 },
  rock:          { recipe: 'rock', metres: 3, bump: 3.0, wet: [0.35, 0.45, 0.5, 1], snow: 1 },
  snow:          { recipe: 'snow', metres: 6, bump: 1.6, wet: [0, 1, 0, 0], snow: 0, sparkle: 1 },
  plaster:       { recipe: 'plaster', metres: 2.5, bump: 1.5, paint: [0.92, 0.88, 0.8], wet: [0.3, 0.7, 0.7, 1], snow: 1 },
  roof_tiles:    { recipe: 'roof_tiles', metres: 1.6, bump: 3.0, wet: [0.3, 0.45, 0.5, 1], snow: 1 },
  dirt:          { recipe: 'dirt', metres: 3, bump: 2.0, wet: [0.45, 0.35, 0.4, 1], snow: 1 },
  ballast:       { recipe: 'ballast', metres: 1.2, bump: 3.0, wet: [0.3, 0.5, 0.5, 1], snow: 1 },
  timber_red:    { recipe: 'timber', metres: 2.4, bump: 2.0, paint: [0.36, 0.11, 0.07], wet: [0.3, 0.6, 0.6, 1], snow: 1 },
  timber_cream:  { recipe: 'timber', metres: 2.4, bump: 2.0, paint: [0.78, 0.72, 0.6], wet: [0.3, 0.6, 0.6, 1], snow: 1 },
  wood_indoor:   { recipe: 'wood_planks', metres: 1.2, bump: 2.0, wet: [0, 1, 0, 0], snow: 0 },   // under a roof: no snow, no wet
  sleeper:       { recipe: 'wood_planks', metres: 1.4, bump: 2.5, rough: 1.0, wet: [0.3, 0.6, 0.6, 1], snow: 1 },
  tarpaper:      { recipe: 'tarpaper', metres: 2.7, bump: 1.5, wet: [0.2, 0.5, 0.5, 1], snow: 1 },
  steel:         { recipe: 'steel', metres: 1.0, bump: 1.0, wet: [0.1, 0.6, 0.5, 1], snow: 1 },
  steel_bare:    { recipe: 'steel', metres: 1.0, bump: 0.6, rough: 0.55, wet: [0.1, 0.6, 0.5, 1], snow: 0 },
  paint_grey:    { recipe: 'painted_metal', metres: 1.5, bump: 1.2, paint: [0.36, 0.38, 0.36], wet: [0.05, 0.62, 0.65, 1], snow: 1 },
  paint_black:   { recipe: 'painted_metal', metres: 1.5, bump: 1.2, paint: [0.05, 0.05, 0.05], wet: [0.05, 0.62, 0.65, 1], snow: 1 },
  ceramic:       { recipe: 'plaster', metres: 0.6, bump: 0.3, rough: 0.35, paint: [0.95, 0.94, 0.9], wet: [0.05, 0.6, 0.3, 1], snow: 1 },
  canvas:        { recipe: 'fabric', metres: 0.12, bump: 0,   paint: [0.62, 0.55, 0.42], wet: [0.3, 0.7, 0.4, 1], snow: 0 },
  plaster_in:    { recipe: 'plaster', metres: 3.0, bump: 0, paint: [0.62, 0.57, 0.46], wet: [0, 1, 0, 0], snow: 0 },          // indoor: no snow, no wet
  timber_green_in: { recipe: 'timber', metres: 1.6, bump: 1.6, paint: [0.12, 0.21, 0.16], wet: [0, 1, 0, 0], snow: 0 },
  iron_in:       { recipe: 'painted_metal', metres: 1.0, bump: 1.4, paint: [0.05, 0.05, 0.05], wet: [0, 1, 0, 0], snow: 0 },
  ice:           { recipe: 'snow', metres: 1.0, bump: 0.3, rough: 0.15, wet: [0, 1, 0, 0], snow: 0, sparkle: 1 },
  fabric:        { recipe: 'fabric', metres: 0.5, bump: 1.0, size: 0.5, paint: [0.35, 0.33, 0.28], wet: [0.4, 0.7, 0.3, 1], snow: 0 },
};

// Weather uniforms shared by every material (and by your own shaders if you like).
export const SURFACE = { wet: { value: 0 }, snow: { value: 0 }, sunDir: { value: SUN.dir.clone() }, time: { value: 0 },
  lamps: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, -999, 0, 0)) }, lampCol: { value: Array.from({ length: 4 }, () => new THREE.Color(0, 0, 0)) },   // lamp glints in snow
  // interiors: sky/env light is cut to `indoorK` inside these boxes (walls block the sky; three's hemisphere and
  // environment light do not know that). Set the boxes from the level: SURFACE.indoorMin/Max.value[i].copy(...)
  indoorMin: { value: [new THREE.Vector3(1e9, 1e9, 1e9), new THREE.Vector3(1e9, 1e9, 1e9)] }, indoorMax: { value: [new THREE.Vector3(-1e9, -1e9, -1e9), new THREE.Vector3(-1e9, -1e9, -1e9)] },
  indoorK: { value: 0.22 },
  // point lights have no shadows, so a lamp outside lights the inner walls through them (and the desk lamp lights
  // the snow outside). lightIn[i] = 1 if pool light i is inside an interior box (set by the level each frame);
  // light reaching across a wall is cut to 4%.
  lightIn: { value: new Float32Array(8) } };

// ---- GPU baker ---------------------------------------------------------------------
function makeBaker(renderer) {
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false; scene.add(quad);
  const vs = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const rt = (size, srgb, half) => {
    const t = new THREE.WebGLRenderTarget(size, size, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: false,
      generateMipmaps: !half, minFilter: half ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
    t.texture.wrapS = t.texture.wrapT = THREE.RepeatWrapping; t.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (srgb) t.texture.colorSpace = THREE.SRGBColorSpace; // GPU encodes linear -> sRGB on write: full precision in darks
    return t;
  };
  const draw = (mat, target) => { quad.material = mat; const prev = renderer.getRenderTarget(); renderer.setRenderTarget(target); renderer.render(scene, cam); renderer.setRenderTarget(prev); };
  return function bake(recipe, size, bump, metres) {
    const mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: { OUT: { value: 0 } }, vertexShader: vs,
      fragmentShader: `precision highp float; precision highp int; uniform int OUT; varying vec2 vUv; layout(location = 0) out vec4 fragOut;
        ${NOISE_GLSL}
        ${RECIPES_GLSL}
        void main(){
          vec3 alb = vec3(0.5); float rough = 0.8, metal = 0.0, ao = 1.0, h = 0.5, mask = 0.0;
          S_${recipe}(vUv, alb, rough, metal, ao, h, mask);
          if (OUT == 0) fragOut = vec4(clamp(alb, 0.0, 1.0), clamp(mask, 0.0, 1.0));
          else if (OUT == 1) fragOut = vec4(clamp(ao, 0.0, 1.0), clamp(rough, 0.03, 1.0), clamp(metal, 0.0, 1.0), 1.0);
          else fragOut = vec4(h, 0.0, 0.0, 1.0);
        }` });
    const A = rt(size, true), O = rt(size, false), H = rt(size, false, true), N = rt(size, false);
    mat.uniforms.OUT.value = 0; draw(mat, A);
    mat.uniforms.OUT.value = 1; draw(mat, O);
    mat.uniforms.OUT.value = 2; draw(mat, H);
    // height -> tangent-space normal, strength in physical units (texels per metre)
    const nmat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: { tH: { value: H.texture }, K: { value: bump * 0.0015 * size / metres }, px: { value: 1 / size } }, vertexShader: vs,
      fragmentShader: `uniform sampler2D tH; uniform float K, px; varying vec2 vUv; layout(location = 0) out vec4 fragOut;
        float s(vec2 o){ return texture(tH, fract(vUv + o * px)).r; }
        void main(){
          float gx = (s(vec2(1,-1)) + 2.0*s(vec2(1,0)) + s(vec2(1,1))) - (s(vec2(-1,-1)) + 2.0*s(vec2(-1,0)) + s(vec2(-1,1)));
          float gy = (s(vec2(-1,1)) + 2.0*s(vec2(0,1)) + s(vec2(1,1))) - (s(vec2(-1,-1)) + 2.0*s(vec2(0,-1)) + s(vec2(1,-1)));
          vec3 n = normalize(vec3(-gx * K * 24.0, -gy * K * 24.0, 1.0));
          fragOut = vec4(n * 0.5 + 0.5, 1.0);
        }` });
    draw(nmat, N);
    mat.dispose(); nmat.dispose(); H.dispose();
    return { map: A.texture, ormMap: O.texture, normalMap: N.texture };
  };
}

// ---- shared material patch ---------------------------------------------------------------
function patch(m, def) {
  const u = {
    uPaint: { value: new THREE.Color(...(def.paint || [1, 1, 1])) }, uPaintOn: { value: def.paint ? 1 : 0 },
    uWetP: { value: new THREE.Vector4(...(def.wet || [0.3, 0.5, 0.5, 1])) }, uSnowOn: { value: def.snow ?? 1 }, uSparkle: { value: def.sparkle || 0 },
    uMacro: { value: new THREE.Vector3(...(def.macro || [0.14, 0.12, 0.35])) },
    uBomb: { value: new THREE.Vector2(def.bomb ?? 0, def.bombRot ?? 1) },   // texture bombing: bomb 0..1, bombRot 0 for oriented patterns (bricks)
    uAge: { value: def.age ?? 0 }, uGround: { value: def.ground ?? 0 },   // age: gravity grime on walls; ground: straw/earth/moss patches
    uUnder: { value: null }, uUnderK: { value: new THREE.Vector2(0, 1.6) },   // spalled plaster: def.under (a photo set name) shows through in patches; x = amount, y = its metres
  };
  m.userData.u = u;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u, { uWet: SURFACE.wet, uSnow: SURFACE.snow, uSunDir: SURFACE.sunDir, uLamps: SURFACE.lamps, uLampCol: SURFACE.lampCol, uInMin: SURFACE.indoorMin, uInMax: SURFACE.indoorMax, uInK: SURFACE.indoorK, uLightIn: SURFACE.lightIn });
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 wfP = vec4(transformed, 1.0); vec3 wfN = objectNormal;
        #ifdef USE_INSTANCING
          wfP = instanceMatrix * wfP; wfN = mat3(instanceMatrix) * wfN;
        #endif
        vWPos = (modelMatrix * wfP).xyz; vWNrm = normalize(mat3(modelMatrix) * wfN);`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm;
        uniform vec2 uBomb, uUnderK; uniform float uAge, uGround; uniform sampler2D uUnder;
        uniform vec3 uPaint, uMacro, uSunDir; uniform vec4 uWetP; uniform vec4 uLamps[4]; uniform vec3 uLampCol[4]; uniform float uPaintOn, uWet, uSnow, uSnowOn, uSparkle; uniform vec3 uInMin[2], uInMax[2]; uniform float uInK; uniform float uLightIn[8];
        // interior box = the inner wall faces: lining counts as inside, outer faces (one wall thickness out) do not
        float wfIndoor(vec3 p){ float k = 0.0; for (int i = 0; i < 2; i++) { vec3 a = smoothstep(uInMin[i] - 0.09, uInMin[i] - 0.005, p) * (1.0 - smoothstep(uInMax[i] + 0.005, uInMax[i] + 0.09, p)); k = max(k, a.x * a.y * a.z); } return k; }
        float wfH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float wfN3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(wfH(i),wfH(i+vec3(1,0,0)),f.x), mix(wfH(i+vec3(0,1,0)),wfH(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(wfH(i+vec3(0,0,1)),wfH(i+vec3(1,0,1)),f.x), mix(wfH(i+vec3(0,1,1)),wfH(i+vec3(1,1,1)),f.x),f.y), f.z); }
        float wfMacro, wfWetK, wfSnowK;`)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 wfTex = texture2D(map, vMapUv);
          if (uBomb.x > 0.0) {
            vec2 uv2 = uBomb.y > 0.5 ? vec2(-vMapUv.y, vMapUv.x) + vec2(0.37, 0.61) : vMapUv + vec2(0.5, 0.37);
            float bw = smoothstep(0.38, 0.62, wfN3(vWPos * 0.21 + 3.0)) * uBomb.x;
            wfTex = mix(wfTex, texture2D(map, uv2), bw);
          }
          vec3 wfAlb = mix(wfTex.rgb, wfTex.rgb * uPaint * 2.0, wfTex.a * uPaintOn);
          if (uUnderK.x > 0.0) {   // plaster fallen off in patches: brick behind, a dark broken edge round each patch; more near the ground and at the top
            float wl = 1.0 - smoothstep(0.3, 0.7, abs(vWNrm.y));
            vec2 tg = normalize(vec2(-vWNrm.z, vWNrm.x) + 1e-4); float uu = dot(vWPos.xz, tg);
            float n = wfN3(vWPos * 0.32 + 9.0) * 0.55 + wfN3(vWPos * 1.2 + 3.0) * 0.3 + wfN3(vWPos * 4.5) * 0.15;
            n += (1.0 - smoothstep(0.0, 2.2, mod(vWPos.y, 100.0))) * 0.1;
            float th = 0.72 - 0.08 * uUnderK.x;
            float sp = smoothstep(th, th + 0.015, n) * wl, rim = smoothstep(th - 0.035, th, n) * (1.0 - sp) * wl;
            vec3 brick = texture2D(uUnder, vec2(uu, vWPos.y) / uUnderK.y).rgb;
            wfAlb = mix(wfAlb, brick, sp); wfAlb *= 1.0 - 0.45 * rim;
          }
          diffuseColor.rgb *= wfAlb;
          diffuseColor.rgb *= wfAlb;
        #endif
        wfMacro = wfN3(vWPos * uMacro.z) * 0.65 + wfN3(vWPos * uMacro.z * 3.7) * 0.35;
        diffuseColor.rgb *= 1.0 + uMacro.x * (wfMacro - 0.5) * 2.0;           // breaks tiling at 10–30 m
        if (uGround > 0.0) {   // open ground: patches of dead straw, bare damp earth and greener moss at 3-20 m scales, so a field is never one flat colour
          float up = smoothstep(0.5, 0.9, vWNrm.y);
          float a = wfN3(vWPos * 0.09 + 11.0) * 0.6 + wfN3(vWPos * 0.31) * 0.4, b = wfN3(vWPos * 0.05 + 4.0);
          vec3 straw = vec3(1.75, 1.45, 0.85), earth = vec3(0.85, 0.72, 0.6), moss = vec3(0.9, 1.15, 0.8);
          vec3 tint = mix(moss, straw, smoothstep(0.42, 0.7, a)); tint = mix(tint, earth, smoothstep(0.55, 0.8, b) * 0.8);
          diffuseColor.rgb *= mix(vec3(1.0), tint, uGround * up);
        }
        if (uAge > 0.0) {   // grime that follows gravity: dark vertical runs on walls (water carried dirt down for decades), heavier low down, a damp band at the foot
          float wall = 1.0 - smoothstep(0.3, 0.7, abs(vWNrm.y));
          float u = dot(vWPos.xz, normalize(vec2(-vWNrm.z, vWNrm.x) + 1e-4));
          float runs = smoothstep(0.45, 0.95, wfN3(vec3(u * 1.6, vWPos.y * 0.07, 3.1)) * 0.7 + wfN3(vec3(u * 5.0, vWPos.y * 0.2, 7.3)) * 0.3);
          float sheet = wfN3(vec3(u * 0.35, vWPos.y * 0.03, 1.7));
          float foot = 1.0 - smoothstep(0.0, 1.4 + 0.8 * wfN3(vec3(u * 0.8, 0.0, 5.0)), vWPos.y - floor(vWPos.y / 3.1) * 0.0 - 0.0);
          float g = clamp(runs * 0.55 + sheet * 0.25 + foot * 0.45, 0.0, 1.0) * wall * uAge;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.52, 0.5, 0.44), g);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.26, 0.14) * dot(diffuseColor.rgb, vec3(0.5)), foot * wall * uAge * 0.35 * smoothstep(0.4, 0.7, wfMacro));
        }
        float wfUp = smoothstep(0.15, 0.85, vWNrm.y), wfExp = smoothstep(-0.4, -0.05, vWNrm.y);
        float wfStreak = wfN3(vec3((vWPos.x + vWPos.z) * 6.0, vWPos.y * 0.6, 0.0)) * wfN3(vWPos * vec3(20.0, 1.5, 20.0));
        wfWetK = uWet * uWetP.w * wfExp * mix(uWetP.z * (0.55 + 0.9 * wfStreak), 0.75 + 0.5 * wfMacro, wfUp);
        wfWetK = clamp(wfWetK, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * mix(vec3(1.0), diffuseColor.rgb / max(dot(diffuseColor.rgb, vec3(0.333)), 1e-3), 0.25), wfWetK);
        diffuseColor.rgb *= 1.0 - uWetP.x * wfWetK;                            // wet = darker, more saturated
        wfSnowK = uSnowOn * smoothstep(0.5, 0.85, vWNrm.y + 0.25 * (wfMacro - 0.5));
        wfSnowK *= smoothstep(0.42, 0.62, (wfN3(vWPos * vec3(2.3, 2.3, 0.9)) * 0.55 + wfMacro * 0.45) + uSnow - 0.62) * min(1.0, uSnow * 3.0);   // patchy cover: swept/trodden bare spots`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.88, 0.92) * (0.96 + 0.08 * wfMacro), wfSnowK);   // after vertex colour: snow is not tinted by prop grime`)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          vec4 texelRoughness = texture2D(roughnessMap, vRoughnessMapUv);
          roughnessFactor *= texelRoughness.g;
        #endif
        roughnessFactor *= 1.0 + uMacro.y * (wfMacro - 0.5) * 2.0;
        roughnessFactor = mix(roughnessFactor, roughnessFactor * uWetP.y, wfWetK);   // wet = glossier
        roughnessFactor = mix(roughnessFactor, 0.62, wfSnowK);
        #ifdef USE_NORMALMAP
          float wfNl = length(texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0);
          roughnessFactor = sqrt(roughnessFactor * roughnessFactor + (1.0 - min(wfNl, 1.0)) * 0.6); // Toksvig: no sparkle from mips
        #endif
        roughnessFactor = clamp(roughnessFactor, 0.03, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, nonPerturbedNormal, wfSnowK * 0.85));   // snow fills the grooves: hide the surface's normal map`)
      .replace('#include <lights_fragment_begin>', 'float wfIn = wfIndoor(vWPos);\n' + THREE.ShaderChunk.lights_fragment_begin.replace('getPointLightInfo( pointLight, geometryPosition, directLight );',
        'getPointLightInfo( pointLight, geometryPosition, directLight ); directLight.color *= mix(1.0, 0.04, abs(wfIn - uLightIn[ i ]));'))
      .replace('#include <lights_fragment_end>', `{ float ink = mix(1.0, uInK, wfIndoor(vWPos)); irradiance *= ink; iblIrradiance *= ink; radiance *= mix(1.0, ink, 0.7); }
        #include <lights_fragment_end>`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float sp = max(uSparkle, wfSnowK);
          if (sp > 0.0) {
            vec3 V = normalize(cameraPosition - vWPos); float d = length(cameraPosition - vWPos);
            vec3 cell = floor(vWPos * 90.0); float g = step(0.985, wfH(cell + 0.37)) * step(0.5, wfH(cell + 7.1));
            float spec = pow(max(dot(reflect(-uSunDir, normalize(vWNrm + (vec3(wfH(cell), wfH(cell + 3.0), wfH(cell + 5.0)) - 0.5) * 0.8)), V), 0.0), 40.0);
            totalEmissiveRadiance += vec3(1.0, 0.97, 0.92) * g * spec * sp * 6.0 * (1.0 - smoothstep(3.0, 16.0, d));
            vec3 jn = normalize(vWNrm + (vec3(wfH(cell), wfH(cell + 3.0), wfH(cell + 5.0)) - 0.5) * 0.8);
            for (int li = 0; li < 4; li++) { vec3 Lv = uLamps[li].xyz - vWPos; float ld = length(Lv); float lr = uLamps[li].w * 1.6;
              if (lr > 0.0 && ld < lr) { float ls = pow(max(dot(reflect(-Lv / ld, jn), V), 0.0), 30.0);
                totalEmissiveRadiance += uLampCol[li] * g * ls * sp * 10.0 * (1.0 - ld / lr) * (1.0 - smoothstep(3.0, 14.0, d)); } }
          }
        }`);
  };
  m.customProgramCacheKey = () => 'wf-surface-4';
  return m;
}

// Box-projected UVs in metres: texel density is the same on every surface, whatever its size.
// Call on any geometry after it is positioned (kit.finish does this for props).
export function worldUV(geo, metres = 2, offset = [0, 0, 0]) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + offset[0], y = p.getY(i) + offset[1], z = p.getZ(i) + offset[2];
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [u, v] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, y] : [x, y];
    uv[i * 2] = u / metres; uv[i * 2 + 1] = v / metres;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

export async function create(ctx) {
  const t0 = performance.now(), bake = makeBaker(ctx.renderer);
  // CC0 photo texture sets (lib/photo.js; the template's is an empty stub, see photo.example.js): `photo: '<set>'` in a material uses them
  const photos = await loadPhotoSets(ctx.renderer).catch((e) => { console.error('[mats] photo sets failed: ' + e.message); return {}; });
  const sets = new Map(), cache = new Map();
  let fallback = null, ms = 0;
  function material(name) {
    if (cache.has(name)) return cache.get(name);
    const def = MATERIALS[name];
    if (!def) {
      console.error(`[mats] unknown material "${name}" — using fallback`);
      fallback ??= new THREE.MeshStandardMaterial({ color: 0xff00ff, roughness: 0.6 }); // loud magenta: easy to spot
      return fallback;
    }
    const size = Math.max(64, Math.round(ctx.quality.tex * (def.size || 1)));
    const key = (def.photo ? 'photo:' + def.photo : def.recipe) + '@' + size;
    let set = sets.get(key);
    if (!set && def.photo && photos[def.photo]) { set = { ...photos[def.photo], bump: def.bump ?? 1, metres: def.metres || 2 }; sets.set(key, set); }
    if (!set) {
      const t = performance.now();
      try { set = bake(def.recipe, size, def.bump || 2, def.metres || 2); } catch (e) { console.error(`[mats] bake "${def.recipe}" failed: ${e.message}`); set = {}; }
      ms += performance.now() - t; set.bump = def.bump || 2; set.metres = def.metres || 2; sets.set(key, set);
    }
    const m = patch(new THREE.MeshStandardMaterial({
      map: set.map || null, normalMap: set.normalMap || null, roughnessMap: set.ormMap || null, metalnessMap: set.ormMap || null, aoMap: set.ormMap || null,
      roughness: def.rough ?? 1, metalness: def.metal ?? 1, aoMapIntensity: 1,
    }), def);
    // texture sets are shared per recipe: the normal map was baked with the first material's bump/metres,
    // so scale it to this material's strength (else every variant gets the first one's relief)
    if (set.normalMap) m.normalScale.setScalar(((def.bump ?? 2) / (def.metres || 2)) / (set.bump / set.metres));
    if (def.under && photos[def.under]) { m.userData.u.uUnder.value = photos[def.under].map; m.userData.u.uUnderK.value.set(def.underAmt ?? 1, def.underMetres ?? 1.6); }
    if (def.bump === 0) m.normalMap = null;   // bump 0 = smooth (painted plaster, paper): a scaled-down normal map still shows its steep edges
    m.name = name; m.userData.metres = def.metres || 2;
    cache.set(name, m);
    return m;
  }
  for (const k of Object.keys(MATERIALS)) material(k); // bake up front: no hitch on first use
  console.log(`[mats] ${sets.size} GPU texture sets @${ctx.quality.tex}px in ${ms.toFixed(0)}ms (total ${(performance.now() - t0).toFixed(0)}ms)`);
  // interiors, automatic: level.interiorBoxes (first 2) cut the sky light inside, and every pool light is tagged
  // inside/outside so lamps do not shine through walls (point lights have no shadows). See SURFACE.indoor*/lightIn.
  const _tmp = new THREE.Vector3();
  function syncInteriors() {
    const boxes = ctx.level?.interiorBoxes || [];
    for (let i = 0; i < 2; i++) { const b = boxes[i]; SURFACE.indoorMin.value[i].copy(b ? b.min : _tmp.set(1e9, 1e9, 1e9)); SURFACE.indoorMax.value[i].copy(b ? b.max : _tmp.set(-1e9, -1e9, -1e9)); }
    (ctx.render?.lights?.pool || []).forEach((l, i) => { if (i < 8) SURFACE.lightIn.value[i] = l.intensity > 0 && boxes.some((b) => b.containsPoint(l.position)) ? 1 : 0; });
  }
  return { get: material, names: () => Object.keys(MATERIALS), surface: SURFACE, update(dt) { SURFACE.time.value += dt; syncInteriors(); } };
}

// ?show=mats — sphere + bevelled box per material under the real sun. ?wet=1 / ?snow=1 to preview weather.
export async function showcase(ctx) {
  SURFACE.wet.value = +(ctx.params.wet || 0); SURFACE.snow.value = +(ctx.params.snow || 0);
  const { RoundedBoxGeometry } = await import('three/examples/jsm/geometries/RoundedBoxGeometry.js');
  const names = ctx.mats.names(), cols = 7;
  names.forEach((n, i) => {
    const x = ((i % cols) - (cols - 1) / 2) * 2.6, z = -Math.floor(i / cols) * 4.2;
    const m = ctx.mats.get(n), metres = m.userData.metres;
    const s = new THREE.Mesh(worldUV(new THREE.SphereGeometry(0.7, 64, 32), metres), m); s.position.set(x, 0.7, z); s.castShadow = s.receiveShadow = true;
    const bg = worldUV(new RoundedBoxGeometry(1.2, 1.2, 1.2, 3, 0.03), metres); const b = new THREE.Mesh(bg, m); b.position.set(x, 0.6, z - 1.5); b.rotation.y = 0.5; b.castShadow = b.receiveShadow = true;
    ctx.scene.add(s, b);
  });
  const floor = new THREE.Mesh(worldUV(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), 3), ctx.mats.get('concrete')); floor.receiveShadow = true; ctx.scene.add(floor);
  // ?show=mats&cam=... for close-ups; default frames both rows
  return { cam: [0, 4.2, 6.5], target: [0, 0.3, -3.2] };
}
