import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {
  Bounds,
  Direction,
  ExplodeLayer,
  Spacing,
  Vec3,
  computeExplode,
  easeInOutCubic,
  lerpVec,
  translateBounds,
  unionBounds,
} from '../core/explode';
import type { CameraState, Projection, RenderStyle, ViewPreset } from '../core/viewState';
import type { LoadedModel } from './model';
import { AxisGizmo, Guides, Labels } from './overlays';
import { LayerStyler } from './styles';

const ANIM_MS = 250;

/** Orthographic camera with an optional vertical shear, used for planometric (plan-oblique) views. */
class ObliqueOrthoCamera extends THREE.OrthographicCamera {
  shear = 0;
  shearPivot = 0;
  override updateProjectionMatrix() {
    super.updateProjectionMatrix();
    if (this.shear) {
      // y' = y + k (z_view + d): verticals (toward the camera in a plan view) go up the screen,
      // pivoting about the target depth so the plan stays put.
      const s = new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, this.shear, this.shear * this.shearPivot, 0, 0, 1, 0, 0, 0, 0, 1);
      this.projectionMatrix.multiply(s);
      this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
    }
  }
}

/** Camera directions in three.js world space (Y-up). Rhino (x, y, z) ↦ three (x, z, -y). */
function presetDirection(p: ViewPreset): { dir: THREE.Vector3; shear: number } {
  const fromRhino = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y).normalize();
  const sph = (azDeg: number, elDeg: number) => {
    // azimuth measured in Rhino plan from +X toward -Y (south-east quadrant), elevation above horizon
    const a = THREE.MathUtils.degToRad(azDeg);
    const e = THREE.MathUtils.degToRad(elDeg);
    return fromRhino(Math.cos(a) * Math.cos(e), -Math.sin(a) * Math.cos(e), Math.sin(e));
  };
  switch (p) {
    case 'isometric':
      return { dir: fromRhino(1, -1, 1), shear: 0 }; // true isometric: 35.264° elevation
    case 'dimetric':
      return { dir: sph(62, 20.7), shear: 0 };
    case 'planometric':
      return { dir: sph(45, 89.99), shear: 1 };
    case 'front':
      return { dir: fromRhino(0, -1, 0), shear: 0 };
    case 'top':
      return { dir: sph(90, 89.99), shear: 0 };
    default:
      return { dir: fromRhino(1, -1, 1), shear: 0 };
  }
}

interface LayerRuntime {
  id: string;
  bounds: Bounds; // assembled, model frame
  styler: LayerStyler;
  current: Vec3;
  from: Vec3;
  target: Vec3;
  visible: boolean;
}

export interface ExplodeSettings {
  factor: number;
  gap: number;
  spacing: Spacing;
  direction: Direction;
}

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly labelRenderer: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  private ortho: ObliqueOrthoCamera;
  private persp: THREE.PerspectiveCamera;
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  controls: OrbitControls;
  projection: Projection = 'orthographic';
  preset: ViewPreset = 'isometric';

  /** world ← converter (Z-up → Y-up) ← recenter ← model root ← layer groups */
  private readonly converter = new THREE.Group();
  private readonly recenter = new THREE.Group();
  private model: LoadedModel | null = null;
  private layers = new Map<string, LayerRuntime>();
  private order: string[] = [];
  private extra: Record<string, number> = {};
  private explode: ExplodeSettings = { factor: 1, gap: 1.5, spacing: 'even', direction: 'z' };
  private recenterFrom: Vec3 = [0, 0, 0];
  private recenterTo: Vec3 = [0, 0, 0];
  private recenterNow: Vec3 = [0, 0, 0];
  private animStart = 0;
  private animating = false;

  private readonly guides = new Guides();
  private readonly labels = new Labels();
  private readonly gizmo: AxisGizmo;
  private guidesOn = true;
  private labelsOn = true;
  private selected: string | null = null;
  private style: RenderStyle = 'shaded';
  private modelSize = 30;
  private viewHeight = 40; // ortho frustum height at zoom 1

  private readonly clipPlanes: THREE.Plane[] = [];
  private readonly sectionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private sectionOn = false;
  private sectionPos = 0.5;

  private needsRender = true;
  private width = 1;
  private height = 1;

  onPick: (id: string | null) => void = () => {};
  /** fired when the user changes the camera (orbit/pan/zoom) or a preset is applied */
  onViewChange: () => void = () => {};

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0xffffff, 0);
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'viewport-canvas';
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'viewport-labels';
    container.appendChild(this.labelRenderer.domElement);

    this.gizmo = new AxisGizmo(container);

    this.ortho = new ObliqueOrthoCamera(-1, 1, 1, -1, 0.01, 10000);
    this.persp = new THREE.PerspectiveCamera(32, 1, 0.05, 10000);
    this.camera = this.ortho;
    this.controls = this.makeControls(this.ortho);

    // lights: soft sky + a key light from the upper south-west, like a sunny axo
    this.scene.add(new THREE.HemisphereLight('#FFFFFF', '#C9C6BE', 2.2));
    const key = new THREE.DirectionalLight('#FFFFFF', 2.0);
    key.position.set(-0.6, 1.4, 0.9);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#FFFFFF', 0.7);
    fill.position.set(1, 0.3, -0.6);
    this.scene.add(fill);

    this.converter.rotation.x = -Math.PI / 2; // Rhino Z-up → three.js Y-up
    this.converter.add(this.recenter);
    this.recenter.add(this.guides.object);
    this.scene.add(this.converter);
    this.scene.add(this.labels.object);

    this.installPicking();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.loop();
  }

  // --- setup -------------------------------------------------------------------------

  private makeControls(cam: THREE.Camera): OrbitControls {
    const c = new OrbitControls(cam, this.renderer.domElement);
    c.enableDamping = false;
    c.zoomToCursor = true;
    c.screenSpacePanning = true;
    let start: { az: number; pol: number } | null = null;
    c.addEventListener('start', () => {
      start = { az: c.getAzimuthalAngle(), pol: c.getPolarAngle() };
    });
    c.addEventListener('change', () => {
      if (start && (Math.abs(c.getAzimuthalAngle() - start.az) > 1e-3 || Math.abs(c.getPolarAngle() - start.pol) > 1e-3)) {
        if (this.preset !== 'custom') {
          this.preset = 'custom';
          this.setShear(0);
        }
      }
      this.invalidate();
      this.onViewChange();
    });
    c.addEventListener('end', () => (start = null));
    return c;
  }

  private installPicking() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      down = null;
      const id = this.pick(e.clientX, e.clientY);
      if (id) this.onPick(id);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.buttons) return;
      el.style.cursor = this.pick(e.clientX, e.clientY) ? 'pointer' : '';
    });
  }

  /** Builds the pick ray by unprojecting near/far points, which also works for the sheared camera. */
  pick(clientX: number, clientY: number): string | null {
    if (!this.model) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * 2 - 1;
    const y = -((clientY - r.top) / r.height) * 2 + 1;
    const near = new THREE.Vector3(x, y, -1).unproject(this.camera);
    const far = new THREE.Vector3(x, y, 1).unproject(this.camera);
    const ray = new THREE.Raycaster(near, far.sub(near).normalize());
    const targets: THREE.Object3D[] = [];
    for (const l of this.layers.values()) if (l.visible) targets.push(...l.styler.meshes.map((m) => m.mesh));
    const hits = ray.intersectObjects(targets, false);
    for (const h of hits) {
      const mat = (h.object as THREE.Mesh).material as THREE.Material;
      if (mat.opacity < 0.05) continue;
      if (this.sectionOn && this.sectionPlane.distanceToPoint(h.point) < 0) continue;
      return (h.object.userData.layerId as string) ?? null;
    }
    return null;
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.updateFrustum();
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.invalidate();
  }

  private updateFrustum() {
    const aspect = this.width / this.height;
    const hh = this.viewHeight / 2;
    this.ortho.left = -hh * aspect;
    this.ortho.right = hh * aspect;
    this.ortho.top = hh;
    this.ortho.bottom = -hh;
    this.ortho.shearPivot = this.ortho.position.distanceTo(this.controls?.target ?? new THREE.Vector3());
    this.ortho.updateProjectionMatrix();
  }

  invalidate() {
    this.needsRender = true;
  }

  // --- model -------------------------------------------------------------------------

  setModel(model: LoadedModel) {
    if (this.model) {
      this.recenter.remove(this.model.root);
      for (const l of this.layers.values()) l.styler.dispose();
    }
    this.guides.clear();
    this.layers.clear();
    this.model = model;
    this.extra = {};
    model.root.position.set(0, 0, 0);
    model.root.updateMatrixWorld(true);
    for (const l of model.layers) {
      l.group.position.set(0, 0, 0);
      l.group.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(l.group, true);
      const bounds: Bounds = b.isEmpty()
        ? { min: [0, 0, 0], max: [0, 0, 0] }
        : { min: b.min.toArray() as Vec3, max: b.max.toArray() as Vec3 };
      const styler = new LayerStyler(l.group, l.id, this.clipPlanes);
      styler.setStyle(this.style);
      this.layers.set(l.id, { id: l.id, bounds, styler, current: [0, 0, 0], from: [0, 0, 0], target: [0, 0, 0], visible: l.group.visible !== false });
    }
    this.recenter.add(model.root);
    const all = unionBounds([...this.layers.values()].map((l) => l.bounds))!;
    this.modelSize = Math.max(all.max[0] - all.min[0], all.max[1] - all.min[1], all.max[2] - all.min[2], 1e-3);
    this.guides.setScale(this.modelSize);
    this.order = model.layers.map((l) => l.id);
    this.labels.setLayers(model.layers.map((l, i) => ({ id: l.id, index: i, name: l.name, spec: l.spec })));
    this.recenterNow = [0, 0, 0];
    this.recenterFrom = [0, 0, 0];
    this.recenterTo = [0, 0, 0];
    this.retarget(false);
    this.invalidate();
  }

  get size() {
    return this.modelSize;
  }

  // --- explode -----------------------------------------------------------------------

  setExplode(s: Partial<ExplodeSettings>, animate = true) {
    this.explode = { ...this.explode, ...s };
    this.retarget(animate);
  }

  setOrder(ids: string[]) {
    this.order = ids.filter((id) => this.layers.has(id));
    this.labels.setLayers(
      this.order.map((id, i) => {
        const l = this.model!.layers.find((x) => x.id === id)!;
        return { id, index: i, name: l.name, spec: l.spec };
      }),
    );
    this.retarget(true);
  }

  setExtraOffset(id: string, metres: number, animate = true) {
    this.extra[id] = metres;
    this.retarget(animate);
  }

  setLayerVisible(id: string, visible: boolean) {
    const l = this.layers.get(id);
    const m = this.model?.layers.find((x) => x.id === id);
    if (!l || !m) return;
    l.visible = visible;
    m.group.visible = visible;
    this.retarget(true);
  }

  setLayerOpacity(id: string, opacity: number) {
    this.layers.get(id)?.styler.setOpacity(opacity);
    this.invalidate();
  }

  /** Full-explode bounds in world space for the current settings (used for framing). */
  private explodedWorldBox(factor = 1): THREE.Box3 {
    const res = this.computeTargets(factor);
    const list: Bounds[] = [];
    for (const l of this.layers.values()) {
      if (!l.visible) continue;
      list.push(translateBounds(translateBounds(l.bounds, res.offsets[l.id] ?? [0, 0, 0]), res.recenter));
    }
    const u = unionBounds(list) ?? { min: [0, 0, 0], max: [0, 0, 0] };
    const box = new THREE.Box3(new THREE.Vector3(...u.min), new THREE.Vector3(...u.max));
    return box.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  }

  private computeTargets(factor = this.explode.factor) {
    const stack: ExplodeLayer[] = this.order
      .map((id) => this.layers.get(id)!)
      .filter((l) => l && l.visible)
      .map((l) => ({ id: l.id, bounds: l.bounds }));
    return computeExplode(stack, { ...this.explode, factor, extra: this.extra });
  }

  private retarget(animate: boolean) {
    const res = this.computeTargets();
    for (const l of this.layers.values()) {
      l.from = [...l.current];
      l.target = res.offsets[l.id] ?? [0, 0, 0];
    }
    this.recenterFrom = [...this.recenterNow];
    this.recenterTo = res.recenter;
    if (animate) {
      this.animStart = performance.now();
      this.animating = true;
    } else {
      this.applyProgress(1);
      this.animating = false;
    }
    this.updateSectionPlane();
    this.invalidate();
  }

  private applyProgress(t: number) {
    const e = easeInOutCubic(t);
    if (!this.model) return;
    for (const l of this.model.layers) {
      const rt = this.layers.get(l.id)!;
      rt.current = lerpVec(rt.from, rt.target, e);
      l.group.position.set(...rt.current);
    }
    this.recenterNow = lerpVec(this.recenterFrom, this.recenterTo, e);
    this.recenter.position.set(...this.recenterNow);
  }

  // --- appearance ----------------------------------------------------------------------

  setStyle(style: RenderStyle) {
    this.style = style;
    for (const l of this.layers.values()) l.styler.setStyle(style);
    this.invalidate();
  }

  setSelected(id: string | null) {
    this.selected = id;
    for (const l of this.layers.values()) l.styler.setSelected(l.id === id);
    this.invalidate();
  }

  setGuides(on: boolean) {
    this.guidesOn = on;
    this.invalidate();
  }

  setLabels(on: boolean) {
    this.labelsOn = on;
    this.invalidate();
  }

  setSection(enabled: boolean, position: number) {
    this.sectionOn = enabled;
    this.sectionPos = position;
    this.clipPlanes.length = 0;
    if (enabled) this.clipPlanes.push(this.sectionPlane);
    this.updateSectionPlane();
    this.invalidate();
  }

  /** Horizontal cut at `position` (0–1) through the height of the current (target) layout. */
  private updateSectionPlane() {
    if (!this.model) return;
    const box = this.explodedWorldBox(this.explode.factor);
    const y = box.min.y + (box.max.y - box.min.y) * this.sectionPos;
    this.sectionPlane.set(new THREE.Vector3(0, -1, 0), y);
  }

  // --- camera --------------------------------------------------------------------------

  private setShear(k: number) {
    this.ortho.shear = this.projection === 'orthographic' ? k : 0;
    this.updateFrustum();
  }

  setPreset(preset: ViewPreset) {
    this.preset = preset;
    const { dir, shear } = presetDirection(preset);
    this.fit(dir);
    this.setShear(shear);
    if (shear) this.fit(dir); // re-fit with the sheared projection
    this.onViewChange();
    this.invalidate();
  }

  /** Frames the fully exploded model from `dir` (world space, pointing from target to camera). */
  fit(dir: THREE.Vector3 = this.camera.position.clone().sub(this.controls.target).normalize()) {
    const box = this.explodedWorldBox(1);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1e-3);
    const dist = radius * 4;
    for (const cam of [this.ortho, this.persp]) {
      cam.up.set(0, 1, 0);
      cam.position.copy(center).addScaledVector(dir, dist);
      cam.lookAt(center);
      cam.near = cam === this.ortho ? 0.01 : radius / 100;
      cam.far = dist + radius * 4;
      cam.updateMatrixWorld();
    }
    this.controls.target.copy(center);

    // ortho: measure the projected extent at zoom 1 and choose a zoom that fits with margin
    this.viewHeight = radius * 2;
    this.ortho.zoom = 1;
    this.updateFrustum();
    const corners = boxCorners(box);
    let maxX = 0;
    let maxY = 0;
    let midX = 0;
    let midY = 0;
    {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const c of corners) {
        const p = c.clone().project(this.ortho);
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
        y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      maxX = (x1 - x0) / 2;
      maxY = (y1 - y0) / 2;
      midX = (x0 + x1) / 2;
      midY = (y0 + y1) / 2;
    }
    // shift the target so the projected box is centred (matters for the sheared camera)
    const shift = new THREE.Vector3(midX * (this.ortho.right - this.ortho.left) / 2, midY * (this.ortho.top - this.ortho.bottom) / 2, 0)
      .applyQuaternion(this.ortho.quaternion);
    this.ortho.position.add(shift);
    this.persp.position.add(shift);
    this.controls.target.add(shift);
    // leave a column on the right for labels and room for the floating toolbars
    const labelPx = this.labelsOn ? (window.innerWidth <= 600 ? 40 : Math.min(240, this.width * 0.3)) : 0;
    const availW = this.width * 0.92 - labelPx;
    const availH = this.height - 150;
    this.ortho.zoom = Math.max(
      1e-6,
      Math.min(availW / Math.max(maxX * this.width, 1e-6), Math.max(availH, 50) / Math.max(maxY * this.height, 1e-6)),
    );
    this.updateFrustum();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.ortho.quaternion);
    const orthoWorldPerPx = (this.ortho.right - this.ortho.left) / this.ortho.zoom / this.width;
    const panX = (labelPx / 2) * orthoWorldPerPx;
    this.ortho.position.addScaledVector(right, panX);
    const orthoTarget = this.controls.target.clone().addScaledVector(right, panX);

    // perspective: distance so the bounding sphere fits the smaller fov
    const vfov = THREE.MathUtils.degToRad(this.persp.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.persp.aspect * (availW / this.width));
    const pd = (radius / Math.sin(Math.min(vfov * (availH / this.height), hfov) / 2)) * 0.9;
    this.persp.position.copy(this.controls.target).addScaledVector(dir, pd);
    const perspWorldPerPx = (2 * pd * Math.tan(vfov / 2)) / this.height;
    this.persp.position.addScaledVector(right, (labelPx / 2) * perspWorldPerPx);
    this.persp.far = pd + radius * 4;
    if (this.camera === this.ortho) this.controls.target.copy(orthoTarget);
    else this.controls.target.addScaledVector(right, (labelPx / 2) * perspWorldPerPx);
    this.persp.updateProjectionMatrix();
    this.controls.update();
    this.invalidate();
  }

  setProjection(p: Projection) {
    if (p === this.projection) return;
    const target = this.controls.target.clone();
    const dir = this.camera.position.clone().sub(target).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const vfov = THREE.MathUtils.degToRad(this.persp.fov);
    if (p === 'perspective') {
      const halfH = (this.ortho.top - this.ortho.bottom) / 2 / this.ortho.zoom;
      const d = halfH / Math.tan(vfov / 2);
      this.persp.up.copy(up);
      this.persp.position.copy(target).addScaledVector(dir, d);
      this.persp.near = d / 200;
      this.persp.far = d + this.modelSize * 10;
      this.persp.lookAt(target);
      this.persp.updateProjectionMatrix();
      this.camera = this.persp;
    } else {
      const d = this.persp.position.distanceTo(target);
      const halfH = d * Math.tan(vfov / 2);
      this.ortho.up.copy(up);
      this.ortho.position.copy(target).addScaledVector(dir, Math.max(d, this.modelSize * 4));
      this.ortho.lookAt(target);
      this.ortho.zoom = this.viewHeight / 2 / halfH;
      this.ortho.far = this.ortho.position.distanceTo(target) + this.modelSize * 10;
      this.camera = this.ortho;
    }
    this.projection = p;
    this.controls.dispose();
    this.controls = this.makeControls(this.camera);
    this.controls.target.copy(target);
    this.setShear(p === 'orthographic' && this.preset === 'planometric' ? 1 : 0);
    this.controls.update();
    this.onViewChange();
    this.invalidate();
  }

  getCameraState(): CameraState {
    return {
      position: this.camera.position.toArray() as Vec3,
      target: this.controls.target.toArray() as Vec3,
      zoom: this.projection === 'orthographic' ? this.ortho.zoom : 1,
      projection: this.projection,
      preset: this.preset,
    };
  }

  setCameraState(c: CameraState) {
    if (c.projection !== this.projection) this.setProjection(c.projection);
    if (c.preset !== 'custom') this.setPreset(c.preset);
    this.preset = c.preset;
    this.camera.position.fromArray(c.position);
    this.controls.target.fromArray(c.target);
    this.camera.up.set(0, 1, 0);
    if (this.camera === this.ortho) {
      this.ortho.zoom = c.zoom;
      this.setShear(c.preset === 'planometric' ? 1 : 0);
    }
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.onViewChange();
    this.invalidate();
  }

  // --- frame loop ------------------------------------------------------------------------

  private loop = () => {
    requestAnimationFrame(this.loop);
    if (this.animating) {
      const t = (performance.now() - this.animStart) / ANIM_MS;
      this.applyProgress(Math.min(t, 1));
      if (t >= 1) this.animating = false;
      this.needsRender = true;
    }
    if (!this.needsRender) return;
    this.needsRender = false;
    this.render();
  };

  /** world-space corners of each layer's current (exploded) box */
  private layerWorldCorners() {
    const out: Array<{ id: string; corners: THREE.Vector3[]; visible: boolean }> = [];
    this.converter.updateMatrixWorld(true);
    const m = this.recenter.matrixWorld;
    for (const id of this.order) {
      const l = this.layers.get(id)!;
      const b = translateBounds(l.bounds, l.current);
      const corners = boxCorners(new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max))).map((c) => c.applyMatrix4(m));
      out.push({ id, corners, visible: l.visible });
    }
    return out;
  }

  render() {
    if (this.camera === this.ortho) {
      const d = this.ortho.position.distanceTo(this.controls.target);
      if (this.ortho.shear && Math.abs(d - this.ortho.shearPivot) > 1e-6) this.updateFrustum();
    }
    this.guides.object.visible = this.guidesOn;
    if (this.guidesOn) {
      this.guides.update(
        this.order.map((id) => {
          const l = this.layers.get(id)!;
          return { id, bounds: l.bounds, offset: l.current, visible: l.visible };
        }),
        this.explode.direction,
        this.selected,
      );
    }
    this.scene.updateMatrixWorld();
    this.labels.update(this.layerWorldCorners(), this.camera, this.width, this.height, this.selected, this.labelsOn && !!this.model);
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
    this.gizmo.update(this.camera);
  }

  // --- export --------------------------------------------------------------------------

  async exportPNG(scale: number, transparent: boolean): Promise<Blob> {
    const w = this.width;
    const h = this.height;
    const prev = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(scale);
    this.renderer.setSize(w, h, false);
    this.render();
    const out = document.createElement('canvas');
    out.width = Math.round(w * scale);
    out.height = Math.round(h * scale);
    const ctx = out.getContext('2d')!;
    if (!transparent) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, out.width, out.height);
    }
    ctx.drawImage(this.renderer.domElement, 0, 0, out.width, out.height);
    if (this.labelsOn) drawLabels(ctx, this.labels.snapshot, scale);
    this.renderer.setPixelRatio(prev);
    this.renderer.setSize(w, h, false);
    this.render();
    return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
  }
}

function boxCorners(b: THREE.Box3): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

/** Paint the HTML labels into the exported image so the PNG matches the screen. */
function drawLabels(ctx: CanvasRenderingContext2D, labels: Labels['snapshot'], scale: number) {
  ctx.save();
  ctx.scale(scale, scale);
  for (const l of labels) {
    const color = l.selected ? '#C2410C' : '#8C8C88';
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(l.anchor.x, l.anchor.y);
    ctx.lineTo(l.card.x - 4, l.card.y);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(l.anchor.x, l.anchor.y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = l.selected ? '#C2410C' : '#6B6B66';
    ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText(l.number, l.card.x + 2, l.card.y - 7);
    ctx.fillStyle = '#1B1B1A';
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.fillText(l.name, l.card.x + 26, l.card.y - 7);
    ctx.fillStyle = '#6B6B66';
    ctx.font = '400 10.5px Inter, system-ui, sans-serif';
    ctx.fillText(l.spec, l.card.x + 26, l.card.y + 8);
  }
  ctx.restore();
}
