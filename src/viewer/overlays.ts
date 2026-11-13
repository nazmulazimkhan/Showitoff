import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Bounds, Direction, Vec3, guideCorners } from '../core/explode';
import { layoutLabels } from '../core/labelLayout';
import { ACCENT } from './styles';

/** Dashed guide lines from three corners of each layer back to its assembled position. */
export class Guides {
  readonly object = new THREE.Group();
  private lines = new Map<string, THREE.LineSegments>();
  private readonly mat: THREE.LineDashedMaterial;
  private readonly selMat: THREE.LineDashedMaterial;

  constructor() {
    this.object.name = 'guides';
    this.mat = new THREE.LineDashedMaterial({ color: '#8C8C88', dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.9 });
    this.selMat = new THREE.LineDashedMaterial({ color: ACCENT, dashSize: 0.35, gapSize: 0.25 });
  }

  setScale(modelSize: number) {
    const d = Math.max(modelSize / 90, 0.01);
    for (const m of [this.mat, this.selMat]) {
      m.dashSize = d;
      m.gapSize = d * 0.7;
    }
  }

  update(layers: Array<{ id: string; bounds: Bounds; offset: Vec3; visible: boolean }>, direction: Direction, selected: string | null) {
    const seen = new Set<string>();
    for (const l of layers) {
      seen.add(l.id);
      let line = this.lines.get(l.id);
      if (!line) {
        line = new THREE.LineSegments(new THREE.BufferGeometry(), this.mat);
        line.raycast = () => {};
        this.lines.set(l.id, line);
        this.object.add(line);
      }
      const len = Math.hypot(...l.offset);
      line.visible = l.visible && len > 1e-4;
      if (!line.visible) continue;
      const corners = guideCorners(l.bounds, direction === 'radial' ? 'z' : direction);
      const pts: number[] = [];
      for (const c of corners) {
        pts.push(c[0] + l.offset[0], c[1] + l.offset[1], c[2] + l.offset[2], c[0], c[1], c[2]);
      }
      line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      line.geometry.computeBoundingSphere();
      line.computeLineDistances();
      line.material = l.id === selected ? this.selMat : this.mat;
    }
    for (const [id, line] of this.lines) {
      if (!seen.has(id)) line.visible = false;
    }
  }

  clear() {
    for (const line of this.lines.values()) {
      line.geometry.dispose();
      this.object.remove(line);
    }
    this.lines.clear();
  }
}

export interface LabelInfo {
  id: string;
  index: number;
  name: string;
  spec: string;
}

export interface LabelSnapshot {
  anchor: { x: number; y: number };
  card: { x: number; y: number };
  number: string;
  name: string;
  spec: string;
  selected: boolean;
}

const CARD_H = 34;
const CARD_W = 230;
const CARD_W_COMPACT = 30; // numbers only, below 600 px (see styles.css)

/**
 * Layer labels as CSS2D overlays: each is anchored at the layer's right-most corner on
 * screen and its card is pushed into a shared column to the right, de-overlapped by
 * layoutLabels, with an SVG leader line back to the anchor.
 */
export class Labels {
  readonly object = new THREE.Group();
  private items = new Map<string, { obj: CSS2DObject; card: HTMLDivElement; line: SVGLineElement; info: LabelInfo }>();
  snapshot: LabelSnapshot[] = [];

  constructor() {
    this.object.name = 'labels';
  }

  setLayers(infos: LabelInfo[]) {
    this.clear();
    for (const info of infos) {
      const root = document.createElement('div');
      root.className = 'label-anchor';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'label-leader');
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      svg.appendChild(line);
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('r', '2');
      svg.appendChild(dot);
      const card = document.createElement('div');
      card.className = 'label-card';
      card.innerHTML = `<span class="label-num"></span><span class="label-text"><b></b><small></small></span>`;
      root.append(svg, card);
      const obj = new CSS2DObject(root);
      obj.center.set(0, 0);
      this.object.add(obj);
      this.items.set(info.id, { obj, card, line, info });
      this.setInfo(info);
    }
  }

  setInfo(info: LabelInfo) {
    const it = this.items.get(info.id);
    if (!it) return;
    it.info = info;
    (it.card.querySelector('.label-num') as HTMLElement).textContent = String(info.index + 1).padStart(2, '0');
    (it.card.querySelector('b') as HTMLElement).textContent = info.name;
    (it.card.querySelector('small') as HTMLElement).textContent = info.spec;
  }

  /**
   * Position the labels. `layers` carry world-space corner points of each (exploded) box.
   */
  update(
    layers: Array<{ id: string; corners: THREE.Vector3[]; visible: boolean }>,
    camera: THREE.Camera,
    width: number,
    height: number,
    selected: string | null,
    enabled: boolean,
  ) {
    this.object.visible = enabled;
    this.snapshot = [];
    if (!enabled) return;
    const v = new THREE.Vector3();
    const toScreen = (p: THREE.Vector3) => {
      v.copy(p).project(camera);
      return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height };
    };

    const active: Array<{ id: string; anchorWorld: THREE.Vector3; ax: number; ay: number }> = [];
    let maxX = -Infinity;
    for (const l of layers) {
      const it = this.items.get(l.id);
      if (!it) continue;
      it.obj.visible = l.visible;
      if (!l.visible) continue;
      let best = l.corners[0];
      let bestS = toScreen(best);
      for (const c of l.corners) {
        const s = toScreen(c);
        maxX = Math.max(maxX, s.x);
        if (s.x > bestS.x + 0.5 || (Math.abs(s.x - bestS.x) <= 0.5 && s.y > bestS.y)) {
          best = c;
          bestS = s;
        }
      }
      active.push({ id: l.id, anchorWorld: best, ax: bestS.x, ay: bestS.y });
    }
    const cardW = window.innerWidth <= 600 ? CARD_W_COMPACT : CARD_W;
    const colX = Math.min(maxX + 40, width - cardW - 8);
    const ys = layoutLabels(
      active.map((a) => a.ay),
      { height: CARD_H, spacing: 6, minY: 48, maxY: height - 36 },
    );
    active.forEach((a, k) => {
      const it = this.items.get(a.id)!;
      it.obj.position.copy(a.anchorWorld);
      const dx = Math.max(colX - a.ax, 16);
      const dy = ys[k] - a.ay;
      it.card.style.transform = `translate(${dx}px, ${dy - CARD_H / 2}px)`;
      it.line.setAttribute('x1', '0');
      it.line.setAttribute('y1', '0');
      it.line.setAttribute('x2', String(dx - 4));
      it.line.setAttribute('y2', String(dy));
      const sel = a.id === selected;
      it.obj.element.classList.toggle('is-selected', sel);
      this.snapshot.push({
        anchor: { x: a.ax, y: a.ay },
        card: { x: a.ax + dx, y: ys[k] },
        number: String(it.info.index + 1).padStart(2, '0'),
        name: it.info.name,
        spec: it.info.spec,
        selected: sel,
      });
    });
  }

  clear() {
    for (const it of this.items.values()) {
      this.object.remove(it.obj);
      it.obj.element.remove();
    }
    this.items.clear();
  }
}

/** XYZ axis gizmo (Rhino axes) drawn in SVG from the camera orientation. */
export class AxisGizmo {
  readonly el: SVGSVGElement;
  private readonly parts: Array<{ axis: THREE.Vector3; line: SVGLineElement; text: SVGTextElement }> = [];

  constructor(parent: HTMLElement) {
    const NS = 'http://www.w3.org/2000/svg';
    this.el = document.createElementNS(NS, 'svg');
    this.el.setAttribute('class', 'gizmo');
    this.el.setAttribute('viewBox', '0 0 72 72');
    // Rhino X, Y, Z expressed in three.js world space (Z-up → Y-up)
    const axes: Array<[string, THREE.Vector3, string]> = [
      ['X', new THREE.Vector3(1, 0, 0), '#D9480F'],
      ['Y', new THREE.Vector3(0, 0, -1), '#2F9E44'],
      ['Z', new THREE.Vector3(0, 1, 0), '#1C7ED6'],
    ];
    for (const [name, axis, color] of axes) {
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '1.6');
      line.setAttribute('stroke-linecap', 'round');
      const text = document.createElementNS(NS, 'text');
      text.textContent = name;
      text.setAttribute('fill', color);
      text.setAttribute('font-size', '10');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      this.el.append(line, text);
      this.parts.push({ axis, line, text });
    }
    parent.appendChild(this.el);
  }

  update(camera: THREE.Camera) {
    const q = camera.quaternion.clone().invert();
    const c = 36;
    const r = 22;
    for (const p of this.parts) {
      const v = p.axis.clone().applyQuaternion(q);
      const x = c + v.x * r;
      const y = c - v.y * r;
      p.line.setAttribute('x1', String(c));
      p.line.setAttribute('y1', String(c));
      p.line.setAttribute('x2', x.toFixed(2));
      p.line.setAttribute('y2', y.toFixed(2));
      p.text.setAttribute('x', (c + v.x * (r + 8)).toFixed(2));
      p.text.setAttribute('y', (c - v.y * (r + 8)).toFixed(2));
      p.line.setAttribute('opacity', v.z < -0.2 ? '0.5' : '1');
    }
  }
}
