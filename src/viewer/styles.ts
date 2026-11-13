import * as THREE from 'three';
import type { RenderStyle } from '../core/viewState';
import { isGlass } from './model';

export const ACCENT = '#C2410C';
const EDGE_THRESHOLD_DEG = 25;
const MAX_EDGE_TRIANGLES = 400_000;

interface MeshEntry {
  mesh: THREE.Mesh;
  shaded: THREE.Material;
  glass: boolean;
  edges?: THREE.LineSegments;
}

interface MatState {
  baseOpacity: number;
  baseTransparent: boolean;
  baseDepthWrite: boolean;
}

/**
 * Owns the materials of one layer for every render style, so per-layer opacity, selection
 * outline and style switches never leak into other layers (3DMLoader shares materials
 * between objects, so they are cloned here).
 */
export class LayerStyler {
  readonly meshes: MeshEntry[] = [];
  private style: RenderStyle = 'shaded';
  private opacity = 1;
  private selected = false;
  private readonly edgeMat: THREE.LineBasicMaterial;
  private readonly clay: THREE.MeshLambertMaterial;
  private readonly clayGlass: THREE.MeshLambertMaterial;
  private readonly line: THREE.MeshBasicMaterial;
  private readonly lineGlass: THREE.MeshBasicMaterial;
  private readonly all: THREE.Material[] = [];
  private readonly base = new Map<THREE.Material, MatState>();

  constructor(group: THREE.Group, layerId: string, clipPlanes: THREE.Plane[]) {
    const clones = new Map<THREE.Material, THREE.Material>();
    const cloneOf = (m: THREE.Material) => {
      let c = clones.get(m);
      if (!c) {
        c = m.clone();
        c.userData = { ...m.userData };
        clones.set(m, c);
      }
      return c;
    };

    this.clay = new THREE.MeshLambertMaterial({ color: '#F7F7F5' });
    this.clayGlass = new THREE.MeshLambertMaterial({ color: '#E9EEF2', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    this.line = new THREE.MeshBasicMaterial({ color: '#FFFFFF' });
    this.lineGlass = new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
    this.edgeMat = new THREE.LineBasicMaterial({ color: '#1B1B1A', transparent: true, opacity: 0.6 });

    const meshes: THREE.Mesh[] = [];
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    for (const mesh of meshes) {
      const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const shaded = cloneOf(src);
      mesh.userData.layerId = layerId;
      const entry: MeshEntry = { mesh, shaded, glass: isGlass(src) };
      const tris = (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position?.count ?? 0) / 3;
      if (tris > 0 && tris < MAX_EDGE_TRIANGLES) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, EDGE_THRESHOLD_DEG), this.edgeMat);
        edges.raycast = () => {};
        edges.userData.isEdge = true;
        mesh.add(edges);
        entry.edges = edges;
      }
      this.meshes.push(entry);
    }

    for (const m of [...clones.values(), this.clay, this.clayGlass, this.line, this.lineGlass, this.edgeMat]) {
      this.all.push(m);
      m.clippingPlanes = clipPlanes;
      this.base.set(m, { baseOpacity: m.opacity, baseTransparent: m.transparent, baseDepthWrite: m.depthWrite });
      if (!(m instanceof THREE.LineBasicMaterial)) {
        // keep faces slightly behind their edge lines
        m.polygonOffset = true;
        m.polygonOffsetFactor = 1;
        m.polygonOffsetUnits = 1;
      }
    }
    this.apply();
  }

  setStyle(style: RenderStyle) {
    this.style = style;
    this.apply();
  }

  setOpacity(o: number) {
    this.opacity = o;
    this.apply();
  }

  setSelected(sel: boolean) {
    this.selected = sel;
    this.apply();
  }

  private apply() {
    for (const e of this.meshes) {
      e.mesh.material =
        this.style === 'shaded' ? e.shaded : this.style === 'clay' ? (e.glass ? this.clayGlass : this.clay) : e.glass ? this.lineGlass : this.line;
    }
    for (const m of this.all) {
      const b = this.base.get(m)!;
      if (m === this.edgeMat) continue;
      m.opacity = b.baseOpacity * this.opacity;
      const transparent = b.baseTransparent || this.opacity < 0.999;
      if (m.transparent !== transparent) m.needsUpdate = true;
      m.transparent = transparent;
      m.depthWrite = b.baseDepthWrite && this.opacity >= 0.999;
    }
    const edgeColor = this.selected ? ACCENT : this.style === 'line' ? '#1B1B1A' : this.style === 'clay' ? '#5E5E5A' : '#2A2D31';
    const edgeOpacity = this.selected ? 1 : this.style === 'line' ? 0.95 : this.style === 'clay' ? 0.55 : 0.45;
    this.edgeMat.color.set(edgeColor);
    this.edgeMat.opacity = edgeOpacity * Math.max(this.opacity, 0.15);
    for (const e of this.meshes) {
      if (e.edges) e.edges.renderOrder = this.selected ? 2 : 1;
    }
  }

  dispose() {
    for (const m of this.all) m.dispose();
    for (const e of this.meshes) e.edges?.geometry.dispose();
  }
}
