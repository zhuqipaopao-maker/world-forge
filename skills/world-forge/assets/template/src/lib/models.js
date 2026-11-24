// External models (Tripo / n4d / any GLB), packed INTO the single HTML file and restyled to match the world.
//   import ghostGlb from '../assets/ghost.glb';            // esbuild 'binary' loader -> Uint8Array
//   const ghost = await loadModel(ctx, ghostGlb, { height: 2.1, material: 'keep' });
// See references/external-models.md for when to use this and how to keep the style consistent.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export async function loadModel(ctx, bytes, { height = null, material = 'keep', roughness = null, tint = null, castShadow = true } = {}) {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  const root = gltf.scene;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = castShadow; o.receiveShadow = true;
    if (material !== 'keep') { o.material = typeof material === 'string' ? ctx.mats.get(material) : material; return; }
    const m = o.material; if (!m) return;
    if (roughness !== null) m.roughness = roughness;                    // generated models are often too shiny or too flat
    if (tint) m.color.multiply(new THREE.Color(...tint));
    if (m.map) m.map.anisotropy = 8;
  });
  // normalise: feet on y=0, centred, scaled to a real height in metres
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  root.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
  const g = new THREE.Group(); g.add(root);
  if (height) g.scale.setScalar(height / size.y);
  g.userData.animations = gltf.animations; g.userData.size = size.toArray();
  return g;
}
