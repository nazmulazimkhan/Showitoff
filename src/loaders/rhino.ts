import * as THREE from 'three';
import { Rhino3dmLoader } from 'three/examples/jsm/loaders/3DMLoader.js';
import { resolveUnits } from '../core/units';
import type { LayerData, LoadedModel } from '../viewer/model';
import { RhinoLayerInfo, groupByLayer, rgbToHex, uniqueIds } from './grouping';

const DEFAULT_MATERIAL_NAME = (THREE.Loader as unknown as { DEFAULT_MATERIAL_NAME: string }).DEFAULT_MATERIAL_NAME ?? '__DEFAULT';

interface RhinoAttributes {
  layerIndex?: number;
  drawColor?: { r: number; g: number; b: number };
}

function attributesOf(o: THREE.Object3D): RhinoAttributes | undefined {
  if (o.userData.attributes) return o.userData.attributes as RhinoAttributes;
  // block instances are wrapped in a bare Object3D; use the first child's attributes
  let found: RhinoAttributes | undefined;
  o.traverse((c) => {
    if (!found && c.userData.attributes) found = c.userData.attributes as RhinoAttributes;
  });
  return found;
}

/**
 * Parse a .3dm with three's Rhino3dmLoader. The rhino3dm WASM is served from
 * <base>/rhino3dm/ (copied from node_modules at install/build time), never a CDN.
 * Returns the model in the Rhino frame (Z-up), scaled to metres, one group per Rhino layer.
 */
export async function load3dm(buffer: ArrayBuffer, fileName: string): Promise<LoadedModel> {
  const loader = new Rhino3dmLoader();
  loader.setLibraryPath(`${import.meta.env.BASE_URL}rhino3dm/`);
  loader.setWorkerLimit(2);
  let obj: THREE.Object3D;
  try {
    obj = await loader.parseAsync(buffer);
  } finally {
    loader.dispose();
  }

  const ud = obj.userData as {
    layers?: Array<Record<string, any>>;
    settings?: { modelUnitSystem?: unknown };
    warnings?: Array<{ type?: string; message?: string }>;
  };
  const units = resolveUnits(ud.settings?.modelUnitSystem);
  const rhinoLayers: RhinoLayerInfo[] = (ud.layers ?? []).map((l, i) => ({
    index: typeof l.index === 'number' ? l.index : i,
    name: String(l.name ?? ''),
    fullPath: typeof l.fullPath === 'string' ? l.fullPath : undefined,
    color: l.color && typeof l.color.r === 'number' ? l.color : undefined,
    visible: l.visible !== false,
  }));

  // keep geometry, drop lights / text dots / point clouds
  const objects = [...obj.children].filter((c) => !(c as THREE.Light).isLight && !(c as THREE.Sprite).isSprite && !(c as THREE.Points).isPoints);

  // fall back to the object/layer display colour where Rhino had no render material
  const fallback = new Map<string, THREE.MeshStandardMaterial>();
  for (const o of objects) {
    o.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material as THREE.Material;
      if (m.name !== DEFAULT_MATERIAL_NAME) return;
      const attrs = attributesOf(mesh);
      const layer = attrs?.layerIndex !== undefined ? rhinoLayers.find((l) => l.index === attrs.layerIndex) : undefined;
      const hex = attrs?.drawColor ? rgbToHex(attrs.drawColor) : layer?.color ? rgbToHex(layer.color) : '#CFCFCB';
      let mat = fallback.get(hex);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, vertexColors: (m as THREE.MeshStandardMaterial).vertexColors });
        fallback.set(hex, mat);
      }
      mesh.material = mat;
    });
  }

  const buckets = groupByLayer(objects, (o) => attributesOf(o)?.layerIndex, rhinoLayers);
  const ids = uniqueIds(buckets.map((b) => b.name));
  const root = new THREE.Group();
  root.name = fileName;
  const s = units.toMetres;
  const layers: LayerData[] = buckets.map((b, i) => {
    const group = new THREE.Group();
    group.name = b.name;
    group.visible = b.visible;
    for (const o of b.items) {
      // uniform unit scale applied to each object's own transform: S·T
      o.position.multiplyScalar(s);
      o.scale.multiplyScalar(s);
      group.add(o);
    }
    root.add(group);
    const meshes = countMeshes(group);
    const full = rhinoLayers.find((l) => `layer-${l.index}` === b.key)?.fullPath;
    return {
      id: ids[i],
      name: b.name,
      spec: `${meshes} object${meshes === 1 ? '' : 's'}${full && full !== b.name ? ' · ' + full.replace(/::/g, ' › ') : ''}`,
      color: b.color ?? firstColor(group),
      group,
    };
  });

  const warnings: string[] = [];
  const missing = (ud.warnings ?? []).filter((w) => w.type === 'missing mesh').length;
  if (missing > 0) {
    warnings.push(
      `${missing} Brep/extrusion object${missing === 1 ? ' has' : 's have'} no render mesh and can't be shown. ` +
        `In Rhino, shade the viewport (or run _RefreshShade) so render meshes exist, then save without "Save small".`,
    );
  }
  if (layers.length === 0) {
    throw new Error(missing > 0 ? warnings[0] : 'No displayable geometry found in this .3dm file.');
  }

  return {
    fileName,
    badge: `Rhino · ${units.label}`,
    units: units.label,
    root,
    layers,
    warnings,
  };
}

function countMeshes(g: THREE.Object3D): number {
  let n = 0;
  g.traverse((c) => {
    if ((c as THREE.Mesh).isMesh || (c as THREE.Line).isLine) n++;
  });
  return n;
}

export function firstColor(g: THREE.Object3D): string {
  let hex = '#CFCFCB';
  let done = false;
  g.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (done || !mesh.isMesh) return;
    const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    if (m?.color) {
      hex = '#' + m.color.getHexString();
      done = true;
    }
  });
  return hex;
}
