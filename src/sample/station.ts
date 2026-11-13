import * as THREE from 'three';
import type { LayerData, LoadedModel } from '../viewer/model';

/**
 * Procedural metro station entrance, modelled like a Rhino file: Z-up, metres,
 * one group per "Rhino layer". Building footprint 30 m (X) × 12 m (Y), ~8.3 m high.
 * Front facade faces -Y (Rhino's Front view).
 */

const L = 30; // length along X
const W = 12; // depth along Y
const SLAB = 0.4; // RC slab thickness (top of slab = +0.4)
const EAVE = 7.8; // top of portal beams / underside of roof

function mat(color: string, opts: { glass?: boolean; opacity?: number; rough?: number; metal?: number } = {}) {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.85,
    metalness: opts.metal ?? 0,
    transparent: Boolean(opts.glass),
    opacity: opts.glass ? opts.opacity ?? 0.35 : 1,
    depthWrite: !opts.glass,
    side: opts.glass ? THREE.DoubleSide : THREE.FrontSide,
  });
  m.userData.glass = Boolean(opts.glass);
  return m;
}

/** Axis-aligned box from min/max corners (model frame). */
function box(group: THREE.Group, material: THREE.Material, min: [number, number, number], max: [number, number, number], name?: string) {
  const sx = max[0] - min[0];
  const sy = max[1] - min[1];
  const sz = max[2] - min[2];
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  mesh.position.set(min[0] + sx / 2, min[1] + sy / 2, min[2] + sz / 2);
  if (name) mesh.name = name;
  group.add(mesh);
  return mesh;
}

function cladding(): THREE.Group {
  const g = new THREE.Group();
  const alu = mat('#D9D6CF', { rough: 0.6, metal: 0.1 });
  const sky = mat('#A9C8DC', { glass: true, opacity: 0.45 });
  const fin = mat('#34363A', { rough: 0.7 });
  const roofTop = EAVE + 0.35;
  // overhanging canopy: 2 m beyond the facade on every side
  box(g, alu, [-L / 2 - 2, -W / 2 - 2, EAVE], [L / 2 + 2, W / 2 + 2, roofTop], 'Roof canopy');
  // glazed skylight strip along the ridge
  box(g, sky, [-10, -0.9, roofTop], [10, 0.9, roofTop + 0.18], 'Skylight');
  // charcoal fins hanging from the front roof edge
  const yFront = -W / 2 - 1.6;
  for (let x = -L / 2 - 1.5; x <= L / 2 + 1.5 + 1e-6; x += 1.5) {
    box(g, fin, [x - 0.06, yFront - 0.2, EAVE - 1.1], [x + 0.06, yFront + 0.2, EAVE], 'Fin');
  }
  return g;
}

function facade(): THREE.Group {
  const g = new THREE.Group();
  const glass = mat('#9EC3DB', { glass: true, opacity: 0.32 });
  const mullion = mat('#4D5560', { rough: 0.5, metal: 0.3 });
  const t = 0.06;
  const z0 = SLAB;
  const z1 = EAVE - 0.2;
  // curtain wall on all four sides
  box(g, glass, [-L / 2, -W / 2 - t, z0], [L / 2, -W / 2, z1], 'Glass front');
  box(g, glass, [-L / 2, W / 2, z0], [L / 2, W / 2 + t, z1], 'Glass back');
  box(g, glass, [-L / 2 - t, -W / 2, z0], [-L / 2, W / 2, z1], 'Glass west');
  box(g, glass, [L / 2, -W / 2, z0], [L / 2 + t, W / 2, z1], 'Glass east');
  // front mullions on a 1.5 m module + head transom
  const yf = -W / 2 - t;
  for (let x = -L / 2; x <= L / 2 + 1e-6; x += 1.5) {
    box(g, mullion, [x - 0.05, yf - 0.16, z0], [x + 0.05, yf, z1], 'Mullion');
  }
  box(g, mullion, [-L / 2, yf - 0.18, z1 - 0.2], [L / 2, yf, z1], 'Head transom');
  return g;
}

function structure(): THREE.Group {
  const g = new THREE.Group();
  const concrete = mat('#C8C5BE', { rough: 0.95 });
  const steel = mat('#55606E', { rough: 0.5, metal: 0.35 });
  box(g, concrete, [-L / 2 - 0.5, -W / 2 - 0.5, 0], [L / 2 + 0.5, W / 2 + 0.5, SLAB], 'RC ground slab');
  const yRows = [-W / 2 + 0.6, W / 2 - 0.6];
  const beamDepth = 0.6;
  for (let x = -12; x <= 12 + 1e-6; x += 6) {
    for (const y of yRows) {
      box(g, steel, [x - 0.2, y - 0.2, SLAB], [x + 0.2, y + 0.2, EAVE - beamDepth], 'Steel column');
    }
    // portal beam spanning across the building
    box(g, steel, [x - 0.2, yRows[0] - 0.4, EAVE - beamDepth], [x + 0.2, yRows[1] + 0.4, EAVE], 'Portal beam');
  }
  return g;
}

function landscape(): THREE.Group {
  const g = new THREE.Group();
  const paving = mat('#DCD8CF', { rough: 1 });
  const lawn = mat('#93B271', { rough: 1 });
  const planter = mat('#A3BE85', { rough: 1 });
  const trunk = mat('#6E5C4A', { rough: 1 });
  const canopy = mat('#6F9852', { rough: 1 });
  // paved plinth, larger than the building
  box(g, paving, [-L / 2 - 5, -W / 2 - 6, -0.35], [L / 2 + 5, W / 2 + 4, 0], 'Granite paving');
  // lawn patches
  box(g, lawn, [-L / 2 - 4, W / 2 + 0.8, 0], [-L / 2 + 6, W / 2 + 3.4, 0.08], 'Lawn');
  box(g, lawn, [L / 2 - 6, W / 2 + 0.8, 0], [L / 2 + 4, W / 2 + 3.4, 0.08], 'Lawn');
  // planter strip along the front
  box(g, planter, [-12, -W / 2 - 5.4, 0], [12, -W / 2 - 4.4, 0.45], 'Planter strip');
  // street trees: trunk + box canopy
  for (let x = -L / 2 - 2; x <= L / 2 + 2 + 1e-6; x += 6.8) {
    const y = -W / 2 - 3.2;
    box(g, trunk, [x - 0.12, y - 0.12, 0], [x + 0.12, y + 0.12, 1.8], 'Tree trunk');
    box(g, canopy, [x - 0.8, y - 0.8, 1.8], [x + 0.8, y + 0.8, 3.3], 'Tree canopy');
  }
  return g;
}

export function buildStation(): LoadedModel {
  const root = new THREE.Group();
  root.name = 'metro-station-entrance';
  const defs: Array<Omit<LayerData, 'group'> & { build: () => THREE.Group }> = [
    { id: 'cladding', name: 'Cladding', spec: 'Perforated aluminium canopy + fins', color: '#D3D0C9', build: cladding },
    { id: 'facade', name: 'Facade', spec: 'Unitised curtain wall · 1.5 m module', color: '#9EC3DB', build: facade },
    { id: 'structure', name: 'Structure', spec: 'Steel portal frames @ 6 m · RC slab', color: '#55606E', build: structure },
    { id: 'landscape', name: 'Landscape', spec: 'Granite paving, lawn, street trees', color: '#8FAE6B', build: landscape },
  ];
  const layers: LayerData[] = defs.map(({ build, ...d }) => {
    const group = build();
    group.name = d.name;
    root.add(group);
    return { ...d, group };
  });
  return {
    fileName: 'metro-station-entrance (sample)',
    badge: 'Sample · m',
    units: 'm',
    root,
    layers,
    warnings: [],
  };
}
