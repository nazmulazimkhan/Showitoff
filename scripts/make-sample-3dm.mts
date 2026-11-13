/**
 * Writes public/models/station.3dm from the procedural sample, using rhino3dm in Node.
 * Exercises the real Rhino import path: millimetre units, one Rhino layer per part,
 * object materials (with translucent glass) and, for Landscape, layer colours only.
 *
 *   node --experimental-strip-types scripts/make-sample-3dm.mts [out.3dm] [--with-brep]
 *
 * --with-brep adds a Brep with no render mesh, to test the "missing render mesh" message.
 */
import { writeFileSync } from 'node:fs';
import rhino3dm from 'rhino3dm';
import * as THREE from 'three';
import { buildStation } from '../src/sample/station.ts';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) ?? 'public/models/station.3dm';
const withBrep = args.includes('--with-brep');
const MM = 1000;

const rhino = await rhino3dm();
const doc = new rhino.File3dm();
doc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters;

const model = buildStation();
const matIndex = new Map<THREE.Material, number>();
const rgb = (c: THREE.Color) => {
  const s = c.clone().convertLinearToSRGB();
  return { r: Math.round(s.r * 255), g: Math.round(s.g * 255), b: Math.round(s.b * 255), a: 255 };
};

for (const layer of model.layers) {
  const lc = new THREE.Color(layer.color);
  const layerIndex = doc.layers().addLayer(layer.name, rgb(lc));
  const useLayerColour = layer.id === 'landscape';
  layer.group.updateMatrixWorld(true);
  layer.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const pos = g.attributes.position;
    const rm = new rhino.Mesh();
    for (let i = 0; i < pos.count; i++) rm.vertices().add(pos.getX(i) * MM, pos.getY(i) * MM, pos.getZ(i) * MM);
    const idx = g.index!;
    for (let i = 0; i < idx.count; i += 3) rm.faces().addTriFace(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    rm.normals().computeNormals();
    rm.compact();

    const attrs = new rhino.ObjectAttributes();
    attrs.layerIndex = layerIndex;
    attrs.name = mesh.name;
    if (useLayerColour) {
      attrs.materialSource = rhino.ObjectMaterialSource.MaterialFromLayer;
    } else {
      const m = mesh.material as THREE.MeshStandardMaterial;
      let mi = matIndex.get(m);
      if (mi === undefined) {
        const rmat = new rhino.Material();
        rmat.name = `${layer.name} ${m.userData.glass ? 'glass' : 'solid'}`;
        rmat.diffuseColor = rgb(m.color) as unknown as number[];
        rmat.transparency = m.userData.glass ? 1 - m.opacity : 0;
        doc.materials().add(rmat);
        mi = doc.materials().count - 1;
        matIndex.set(m, mi);
      }
      attrs.materialSource = rhino.ObjectMaterialSource.MaterialFromObject;
      attrs.materialIndex = mi;
    }
    doc.objects().addMesh(rm, attrs);
  });
}

if (withBrep) {
  const li = doc.layers().addLayer('Unmeshed', { r: 200, g: 80, b: 80 });
  const brep = rhino.Brep.createFromSphere(new rhino.Sphere([0, 0, 12000], 1500));
  const attrs = new rhino.ObjectAttributes();
  attrs.layerIndex = li;
  doc.objects().add(brep, attrs);
}

writeFileSync(out, doc.toByteArray());
console.log(`wrote ${out}`);
