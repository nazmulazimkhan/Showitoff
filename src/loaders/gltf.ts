import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { LayerData, LoadedModel } from '../viewer/model';
import { uniqueIds } from './grouping';
import { firstColor } from './rhino';

/**
 * Parse .glb / .gltf (self-contained). Each top-level node becomes a layer (Rhino's glTF
 * exporter writes one node per layer). glTF is Y-up metres, so each node is wrapped in a
 * +90° X rotation to bring it into the Z-up model frame used by the explode maths.
 */
export async function loadGltf(buffer: ArrayBuffer, fileName: string, resourcePath = ''): Promise<LoadedModel> {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(buffer, resourcePath);
  let nodes = [...gltf.scene.children];
  // unwrap a single root wrapper node (common with many exporters)
  while (nodes.length === 1 && !(nodes[0] as THREE.Mesh).isMesh && nodes[0].children.length > 1) {
    const only = nodes[0];
    only.updateMatrix();
    for (const c of only.children) c.applyMatrix4(only.matrix);
    nodes = [...only.children];
  }
  nodes = nodes.filter((n) => !(n as THREE.Light).isLight && !(n as THREE.Camera).isCamera);
  if (nodes.length === 0) throw new Error('No geometry found in this glTF file.');

  // mark translucent materials as glass so they stay translucent in every style
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const pm = m as THREE.MeshPhysicalMaterial;
      if ((m.transparent && m.opacity < 0.95) || (pm.transmission ?? 0) > 0.2) {
        m.userData.glass = true;
        m.transparent = true;
        if (m.opacity > 0.6) m.opacity = 0.4;
        m.depthWrite = false;
      }
    }
  });

  const names = nodes.map((n, i) => n.name || `Layer ${i + 1}`);
  const ids = uniqueIds(names);
  const root = new THREE.Group();
  root.name = fileName;
  const layers: LayerData[] = nodes.map((node, i) => {
    const group = new THREE.Group();
    group.name = names[i];
    const yToZ = new THREE.Group();
    yToZ.rotation.x = Math.PI / 2;
    yToZ.add(node);
    group.add(yToZ);
    root.add(group);
    let meshes = 0;
    node.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) meshes++;
    });
    return { id: ids[i], name: names[i], spec: `${meshes} mesh${meshes === 1 ? '' : 'es'} · glTF node`, color: firstColor(group), group };
  });

  return { fileName, badge: 'glTF · m', units: 'm', root, layers, warnings: [] };
}
