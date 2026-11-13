import * as THREE from 'three';

/** One explodable component (a Rhino layer / glTF top-level node). */
export interface LayerData {
  id: string;
  name: string;
  /** short spec line shown under the name */
  spec: string;
  /** swatch colour, CSS hex */
  color: string;
  /** holds the layer's meshes, in the model frame (Z-up, metres) */
  group: THREE.Group;
}

export interface LoadedModel {
  fileName: string;
  /** e.g. "Rhino · mm", "glTF · m", "Sample · m" */
  badge: string;
  /** source units label, e.g. "mm" */
  units: string;
  /** contains every layer group; model frame is Z-up, metres */
  root: THREE.Group;
  /** top first (explode order) */
  layers: LayerData[];
  warnings: string[];
}

export const isGlass = (m: THREE.Material): boolean =>
  Boolean(m.userData.glass) || (m.transparent && m.opacity < 0.95);

export function colorToHex(c: THREE.Color): string {
  return '#' + c.getHexString();
}

/** Remove a model's GPU resources. */
export function disposeModel(model: LoadedModel): void {
  model.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}
