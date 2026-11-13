import './styles.css';
import type { Direction, Spacing } from './core/explode';
import { formatMm } from './core/units';
import {
  DEFAULT_EXPLODE,
  LayerViewState,
  Projection,
  RenderStyle,
  ViewPreset,
  ViewState,
  decodeViewHash,
  encodeViewHash,
  parseViewState,
} from './core/viewState';
import { fileKind, safeModelName } from './loaders/grouping';
import { buildStation } from './sample/station';
import { LayersPanel } from './ui/layersPanel';
import { LoadedModel, disposeModel } from './viewer/model';
import { Viewer } from './viewer/viewer';

// ---------------------------------------------------------------------------------------
// DOM

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  fileName: $('fileName'),
  badge: $('unitsBadge'),
  openBtn: $<HTMLButtonElement>('openBtn'),
  shareBtn: $<HTMLButtonElement>('shareBtn'),
  exportBtn: $<HTMLButtonElement>('exportBtn'),
  exportMenu: $('exportMenu'),
  exportScale: $('exportScale'),
  exportTransparent: $<HTMLInputElement>('exportTransparent'),
  exportGo: $<HTMLButtonElement>('exportGo'),
  fileInput: $<HTMLInputElement>('fileInput'),
  viewsInput: $<HTMLInputElement>('viewsInput'),
  layerList: $<HTMLUListElement>('layerList'),
  layerSource: $('layerSource'),
  dropZone: $<HTMLButtonElement>('dropZone'),
  viewport: $('viewport'),
  presetSeg: $('presetSeg'),
  projSeg: $('projSeg'),
  styleSeg: $('styleSeg'),
  banner: $('banner'),
  bannerText: $('bannerText'),
  bannerClose: $<HTMLButtonElement>('bannerClose'),
  loading: $('loading'),
  loadingText: $('loadingText'),
  explodeSlider: $<HTMLInputElement>('explodeSlider'),
  explodeReadout: $('explodeReadout'),
  spacingSeg: $('spacingSeg'),
  gapSlider: $<HTMLInputElement>('gapSlider'),
  gapReadout: $('gapReadout'),
  guidesToggle: $<HTMLInputElement>('guidesToggle'),
  labelsToggle: $<HTMLInputElement>('labelsToggle'),
  selSwatch: $('selSwatch'),
  selName: $('selName'),
  offsetSlider: $<HTMLInputElement>('offsetSlider'),
  offsetReadout: $('offsetReadout'),
  opacitySlider: $<HTMLInputElement>('opacitySlider'),
  opacityReadout: $('opacityReadout'),
  viewChips: $('viewChips'),
  viewsExport: $<HTMLButtonElement>('viewsExport'),
  viewsImport: $<HTMLButtonElement>('viewsImport'),
  sectionToggle: $<HTMLInputElement>('sectionToggle'),
  sectionSlider: $<HTMLInputElement>('sectionSlider'),
  directionSeg: $('directionSeg'),
  statusBar: $('statusBar'),
  toast: $('toast'),
};

// ---------------------------------------------------------------------------------------
// State

interface AppState {
  model: LoadedModel | null;
  /** explode order, top first (layer ids) */
  order: string[];
  layers: Record<string, LayerViewState>;
  selected: string | null;
  explode: ViewState['explode'];
  style: RenderStyle;
  section: { enabled: boolean; position: number };
  gapMax: number;
  /** ?model= file name, kept in shared links */
  modelParam: string | null;
}

const state: AppState = {
  model: null,
  order: [],
  layers: {},
  selected: null,
  explode: { ...DEFAULT_EXPLODE },
  style: 'shaded',
  section: { enabled: false, position: 0.5 },
  gapMax: 6,
  modelParam: null,
};

const viewer = new Viewer(el.viewport);
const panel = new LayersPanel(el.layerList, {
  select: (id) => select(id),
  toggle: (id) => {
    const l = state.layers[id];
    l.visible = !l.visible;
    viewer.setLayerVisible(id, l.visible);
    renderLayers();
    scheduleHash();
  },
  reorder: (ids) => {
    state.order = ids;
    viewer.setOrder(ids);
    renderLayers();
    scheduleHash();
  },
});

viewer.onPick = (id) => id && select(id);
viewer.onViewChange = () => {
  syncSeg(el.presetSeg, viewer.preset);
  syncSeg(el.projSeg, viewer.projection);
  renderStatus();
  scheduleHash();
};

const layerById = (id: string | null) => state.model?.layers.find((l) => l.id === id);
const layerByName = (name: string) => state.model?.layers.find((l) => l.name === name);

// ---------------------------------------------------------------------------------------
// Rendering the UI from state

function syncSeg(seg: HTMLElement, value: string) {
  seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    const on = b.dataset.value === value;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function setFill(input: HTMLInputElement) {
  const min = Number(input.min);
  const max = Number(input.max);
  const pct = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty('--fill', `${pct}%`);
}

function fmtMetres(m: number) {
  return `${m < 10 ? m.toFixed(2).replace(/0$/, '') : m.toFixed(1)} m`;
}

function renderLayers() {
  if (!state.model) return;
  panel.render(
    state.order.map((id) => {
      const l = layerById(id)!;
      return { id, name: l.name, spec: l.spec, color: l.color, visible: state.layers[id].visible };
    }),
    state.selected,
  );
}

function renderControls() {
  const e = state.explode;
  el.explodeSlider.value = String(Math.round(e.factor * 100));
  el.explodeReadout.textContent = `${Math.round(e.factor * 100)}%`;
  syncSeg(el.spacingSeg, e.spacing);
  syncSeg(el.directionSeg, e.direction);
  el.gapSlider.value = String(Math.round((e.gap / state.gapMax) * 100));
  el.gapReadout.textContent = fmtMetres(e.gap);
  el.guidesToggle.checked = e.guides;
  el.labelsToggle.checked = e.labels;
  syncSeg(el.styleSeg, state.style);
  syncSeg(el.presetSeg, viewer.preset);
  syncSeg(el.projSeg, viewer.projection);
  el.sectionToggle.checked = state.section.enabled;
  el.sectionSlider.disabled = !state.section.enabled;
  el.sectionSlider.value = String(Math.round(state.section.position * 100));
  renderSelected();
  [el.explodeSlider, el.gapSlider, el.sectionSlider].forEach(setFill);
}

function renderSelected() {
  const l = layerById(state.selected);
  const ls = l ? state.layers[l.id] : undefined;
  el.selName.textContent = l?.name ?? '—';
  el.selSwatch.style.background = l?.color ?? 'transparent';
  el.offsetSlider.disabled = !l;
  el.opacitySlider.disabled = !l;
  el.offsetSlider.value = String(Math.round((ls?.offset ?? 0) * 1000));
  el.offsetReadout.textContent = formatMm(ls?.offset ?? 0);
  el.opacitySlider.value = String(Math.round((ls?.opacity ?? 1) * 100));
  el.opacityReadout.textContent = `${Math.round((ls?.opacity ?? 1) * 100)}%`;
  [el.offsetSlider, el.opacitySlider].forEach(setFill);
}

function renderStatus() {
  const m = state.model;
  const proj = viewer.projection === 'orthographic' ? 'Orthographic' : 'Perspective';
  const preset = viewer.preset === 'custom' ? 'Custom' : viewer.preset[0].toUpperCase() + viewer.preset.slice(1);
  const parts = [`${proj} · ${preset}`];
  if (m) {
    parts.push(`Units: ${m.units}${m.units !== 'm' ? ' → m' : ''}`);
    parts.push(`${m.layers.length} layer${m.layers.length === 1 ? '' : 's'}`);
    parts.push(m.badge.startsWith('glTF') ? 'glTF Y-up' : 'Z-up → Y-up converted');
  }
  el.statusBar.innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
}

// ---------------------------------------------------------------------------------------
// Actions

function select(id: string | null) {
  state.selected = id;
  viewer.setSelected(id);
  renderLayers();
  renderSelected();
  scheduleHash();
}

function setExplode(patch: Partial<ViewState['explode']>, animate = true) {
  const directionChanged = patch.direction !== undefined && patch.direction !== state.explode.direction;
  state.explode = { ...state.explode, ...patch };
  const { factor, gap, spacing, direction } = state.explode;
  viewer.setExplode({ factor, gap, spacing, direction }, animate);
  // the exploded extents change shape completely with direction: re-frame the camera
  if (directionChanged) viewer.fit();
  viewer.setGuides(state.explode.guides);
  viewer.setLabels(state.explode.labels);
  renderControls();
  scheduleHash();
}

let toastTimer = 0;
function toast(msg: string) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.toast.classList.remove('show'), 2600);
}

function showBanner(msg: string | null) {
  el.banner.hidden = !msg;
  el.bannerText.textContent = msg ?? '';
}

function niceStep(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2.5 : n < 7.5 ? 5 : 10) * p;
}

function setModel(model: LoadedModel, opts: { intro?: boolean } = {}) {
  if (state.model) disposeModel(state.model);
  state.model = model;
  viewer.setModel(model);
  state.order = model.layers.map((l) => l.id);
  state.layers = Object.fromEntries(model.layers.map((l) => [l.id, { visible: l.group.visible !== false, opacity: 1, offset: 0 }]));
  const size = viewer.size;
  state.gapMax = niceStep(size * 0.25);
  const gap = Math.round(size * 0.07 * 10) / 10 || 0.1;
  state.explode = { ...DEFAULT_EXPLODE, gap: Math.min(gap, state.gapMax) };
  const offMin = -Math.round(size * 0.15) * 1000;
  const offMax = Math.round(size * 0.3) * 1000 || 1000;
  el.offsetSlider.min = String(offMin);
  el.offsetSlider.max = String(offMax);
  el.offsetSlider.step = String(niceStep(Math.max(size * 0.002, 0.001)) * 1000);

  el.fileName.textContent = model.fileName;
  el.fileName.title = model.fileName;
  el.badge.textContent = model.badge;
  el.layerSource.textContent = model.badge.startsWith('glTF') ? 'From glTF node order' : 'From Rhino layer order';
  showBanner(model.warnings.length ? model.warnings.join(' ') : null);
  document.title = `${model.fileName} · Detail Explorer`;

  // initial look: assembled → exploded, isometric, framed for full explode
  viewer.setExplode({ factor: 0, gap: state.explode.gap, spacing: 'even', direction: 'z' }, false);
  viewer.setStyle(state.style);
  viewer.setSection(false, 0.5);
  state.section = { enabled: false, position: 0.5 };
  viewer.setPreset('isometric');
  select(model.layers.find((l) => /facade|façade/i.test(l.name))?.id ?? model.layers[0]?.id ?? null);
  setExplode({}, opts.intro !== false);
  renderLayers();
  renderControls();
  renderStatus();
  renderViewChips();
}

// ---------------------------------------------------------------------------------------
// View state (share / saved views)

function captureState(): ViewState {
  const layers: Record<string, LayerViewState> = {};
  for (const id of state.order) layers[layerById(id)!.name] = { ...state.layers[id] };
  return {
    v: 1,
    camera: viewer.getCameraState(),
    explode: { ...state.explode },
    style: state.style,
    section: { ...state.section },
    order: state.order.map((id) => layerById(id)!.name),
    layers,
    selected: layerById(state.selected)?.name,
  };
}

function applyState(vs: ViewState, opts: { camera?: boolean } = {}) {
  if (!state.model) return;
  // order: names we know, in the saved order, then any layers the view didn't mention
  const named = vs.order.map((n) => layerByName(n)?.id).filter((x): x is string => !!x);
  const rest = state.model.layers.map((l) => l.id).filter((id) => !named.includes(id));
  if (named.length) {
    state.order = [...named, ...rest];
    viewer.setOrder(state.order);
  }
  for (const l of state.model.layers) {
    const s = vs.layers[l.name] ?? { visible: true, opacity: 1, offset: 0 };
    state.layers[l.id] = { ...s };
    viewer.setLayerVisible(l.id, s.visible);
    viewer.setLayerOpacity(l.id, s.opacity);
    viewer.setExtraOffset(l.id, s.offset);
  }
  state.style = vs.style;
  viewer.setStyle(vs.style);
  state.section = { ...vs.section };
  viewer.setSection(vs.section.enabled, vs.section.position);
  setExplode({ ...vs.explode });
  if (opts.camera !== false && vs.camera) viewer.setCameraState(vs.camera);
  const sel = vs.selected ? layerByName(vs.selected)?.id : undefined;
  select(sel ?? state.selected);
  renderLayers();
  renderControls();
  renderStatus();
}

let hashTimer = 0;
function scheduleHash() {
  clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => {
    if (!state.model) return;
    history.replaceState(null, '', `${location.pathname}${location.search}#${encodeViewHash(captureState())}`);
  }, 400);
}

async function shareView() {
  if (!state.model) return;
  const url = `${location.origin}${location.pathname}${location.search}#${encodeViewHash(captureState())}`;
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    toast(state.modelParam || state.model.badge.startsWith('Sample') ? 'Link copied to clipboard' : 'Link copied — it holds the view only; share the model file too');
  } catch {
    window.prompt('Copy this link', url);
  }
}

// Saved views ----------------------------------------------------------------------------

interface SavedView {
  name: string;
  state: ViewState;
}
const STORAGE_KEY = 'detail-explorer.views.v1';

function loadCustomViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Array<{ name: unknown; state: unknown }>;
    return arr.filter((v) => typeof v.name === 'string').map((v) => ({ name: v.name as string, state: parseViewState(v.state) }));
  } catch {
    return [];
  }
}
function storeCustomViews(views: SavedView[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
  } catch {
    /* storage unavailable: views live for this session only */
  }
}
let customViews = loadCustomViews();

function builtInView(kind: 'assembled' | 'full' | 'structure'): ViewState {
  const vs = captureState();
  delete vs.camera;
  for (const k of Object.keys(vs.layers)) vs.layers[k] = { visible: true, opacity: 1, offset: 0 };
  vs.section = { enabled: false, position: vs.section.position };
  if (kind === 'assembled') vs.explode.factor = 0;
  if (kind === 'full') vs.explode.factor = 1;
  if (kind === 'structure') {
    vs.explode.factor = 1;
    const focus = state.model!.layers.find((l) => /struct/i.test(l.name)) ?? layerById(state.selected) ?? state.model!.layers[0];
    for (const k of Object.keys(vs.layers)) vs.layers[k].opacity = k === focus.name ? 1 : 0.15;
    vs.selected = focus.name;
  }
  return vs;
}

function renderViewChips() {
  const chips: string[] = [
    `<button type="button" class="chip" data-builtin="assembled">Assembled</button>`,
    `<button type="button" class="chip" data-builtin="full">Full explode</button>`,
    `<button type="button" class="chip" data-builtin="structure">Structure focus</button>`,
    ...customViews.map(
      (_v, i) =>
        `<button type="button" class="chip" data-custom="${i}"><span></span><span class="chip-x" data-remove="${i}" role="button" aria-label="Delete view">×</span></button>`,
    ),
    `<button type="button" class="chip chip-add" data-add>+ Save current</button>`,
  ];
  el.viewChips.innerHTML = chips.join('');
  el.viewChips.querySelectorAll<HTMLButtonElement>('[data-custom]').forEach((b) => {
    (b.firstElementChild as HTMLElement).textContent = customViews[Number(b.dataset.custom)].name;
  });
}

el.viewChips.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const remove = t.closest<HTMLElement>('[data-remove]');
  if (remove) {
    customViews.splice(Number(remove.dataset.remove), 1);
    storeCustomViews(customViews);
    renderViewChips();
    return;
  }
  const chip = t.closest<HTMLButtonElement>('.chip');
  if (!chip || !state.model) return;
  if (chip.dataset.builtin) {
    applyState(builtInView(chip.dataset.builtin as 'assembled' | 'full' | 'structure'), { camera: false });
  } else if (chip.dataset.custom) {
    applyState(customViews[Number(chip.dataset.custom)].state);
  } else if (chip.hasAttribute('data-add')) {
    const name = window.prompt('Name this view', `View ${customViews.length + 1}`);
    if (!name) return;
    customViews.push({ name: name.slice(0, 40), state: captureState() });
    storeCustomViews(customViews);
    renderViewChips();
    toast(`Saved “${name}”`);
  }
});

el.viewsExport.addEventListener('click', () => {
  const data = { app: 'detail-explorer', version: 1, model: state.model?.fileName, current: captureState(), views: customViews };
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${baseName()}-views.json`);
});
el.viewsImport.addEventListener('click', () => el.viewsInput.click());
el.viewsInput.addEventListener('change', async () => {
  const f = el.viewsInput.files?.[0];
  el.viewsInput.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const list: SavedView[] = [];
    if (Array.isArray(data.views)) for (const v of data.views) if (typeof v?.name === 'string') list.push({ name: v.name, state: parseViewState(v.state) });
    if (!list.length && data.current) list.push({ name: f.name.replace(/\.json$/i, ''), state: parseViewState(data.current) });
    if (!list.length) list.push({ name: f.name.replace(/\.json$/i, ''), state: parseViewState(data) });
    customViews = [...customViews, ...list];
    storeCustomViews(customViews);
    renderViewChips();
    applyState(list[0].state);
    toast(`Imported ${list.length} view${list.length === 1 ? '' : 's'}`);
  } catch (err) {
    toast(`Couldn't read views: ${(err as Error).message}`);
  }
});

// ---------------------------------------------------------------------------------------
// Loading models

function baseName() {
  return (state.model?.fileName ?? 'model').replace(/\.[^.]+$/, '');
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function loadBuffer(name: string, buffer: ArrayBuffer): Promise<LoadedModel> {
  const kind = fileKind(name);
  if (kind === '3dm') {
    const { load3dm } = await import('./loaders/rhino');
    return load3dm(buffer, name);
  }
  if (kind === 'gltf') {
    const { loadGltf } = await import('./loaders/gltf');
    return loadGltf(buffer, name, `${import.meta.env.BASE_URL}models/`);
  }
  throw new Error('Unsupported file — drop a .3dm, .glb or .gltf');
}

async function withLoading<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  el.loadingText.textContent = label;
  el.loading.hidden = false;
  try {
    return await fn();
  } catch (err) {
    console.error(err);
    showBanner(`Couldn't load the model: ${(err as Error).message ?? err}`);
    return undefined;
  } finally {
    el.loading.hidden = true;
  }
}

async function openFile(file: File) {
  if (!fileKind(file.name)) {
    toast('Unsupported file — use .3dm, .glb or .gltf');
    return;
  }
  const model = await withLoading(`Loading ${file.name}…`, async () => loadBuffer(file.name, await file.arrayBuffer()));
  if (model) {
    state.modelParam = null;
    const url = new URL(location.href);
    url.searchParams.delete('model');
    url.hash = '';
    history.replaceState(null, '', url);
    setModel(model);
  }
}

async function openUrlModel(name: string): Promise<boolean> {
  const model = await withLoading(`Loading ${name}…`, async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}models/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`models/${name} returned ${res.status}`);
    return loadBuffer(name, await res.arrayBuffer());
  });
  if (!model) return false;
  state.modelParam = name;
  setModel(model, { intro: !decodeViewHash(location.hash) });
  return true;
}

el.openBtn.addEventListener('click', () => el.fileInput.click());
el.dropZone.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => {
  const f = el.fileInput.files?.[0];
  el.fileInput.value = '';
  if (f) void openFile(f);
});

// drag & drop anywhere on the window (viewport shows the overlay)
let dragDepth = 0;
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  document.body.classList.add('is-dragging-file');
  el.dropZone.classList.add('is-over');
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) {
    document.body.classList.remove('is-dragging-file');
    el.dropZone.classList.remove('is-over');
  }
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('is-dragging-file');
  el.dropZone.classList.remove('is-over');
  const f = e.dataTransfer?.files?.[0];
  if (f) void openFile(f);
});

// ---------------------------------------------------------------------------------------
// Controls

function onSeg(seg: HTMLElement, fn: (value: string) => void) {
  seg.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-value]');
    if (b) fn(b.dataset.value!);
  });
}

el.explodeSlider.addEventListener('input', () => setExplode({ factor: Number(el.explodeSlider.value) / 100 }));
el.gapSlider.addEventListener('input', () => setExplode({ gap: Math.round((Number(el.gapSlider.value) / 100) * state.gapMax * 100) / 100 }));
onSeg(el.spacingSeg, (v) => setExplode({ spacing: v as Spacing }));
onSeg(el.directionSeg, (v) => setExplode({ direction: v as Direction }));
el.guidesToggle.addEventListener('change', () => setExplode({ guides: el.guidesToggle.checked }, false));
el.labelsToggle.addEventListener('change', () => setExplode({ labels: el.labelsToggle.checked }, false));

el.offsetSlider.addEventListener('input', () => {
  if (!state.selected) return;
  const m = Number(el.offsetSlider.value) / 1000;
  state.layers[state.selected].offset = m;
  viewer.setExtraOffset(state.selected, m);
  renderSelected();
  scheduleHash();
});
el.opacitySlider.addEventListener('input', () => {
  if (!state.selected) return;
  const o = Number(el.opacitySlider.value) / 100;
  state.layers[state.selected].opacity = o;
  viewer.setLayerOpacity(state.selected, o);
  renderSelected();
  scheduleHash();
});

el.sectionToggle.addEventListener('change', () => {
  state.section.enabled = el.sectionToggle.checked;
  viewer.setSection(state.section.enabled, state.section.position);
  renderControls();
  scheduleHash();
});
el.sectionSlider.addEventListener('input', () => {
  state.section.position = Number(el.sectionSlider.value) / 100;
  viewer.setSection(state.section.enabled, state.section.position);
  setFill(el.sectionSlider);
  scheduleHash();
});

onSeg(el.presetSeg, (v) => viewer.setPreset(v as ViewPreset));
onSeg(el.projSeg, (v) => viewer.setProjection(v as Projection));
onSeg(el.styleSeg, (v) => {
  state.style = v as RenderStyle;
  viewer.setStyle(state.style);
  syncSeg(el.styleSeg, state.style);
  scheduleHash();
});

el.bannerClose.addEventListener('click', () => showBanner(null));
el.shareBtn.addEventListener('click', () => void shareView());

// export popover
let exportScale = 2;
const closeExport = () => {
  el.exportMenu.hidden = true;
  el.exportBtn.setAttribute('aria-expanded', 'false');
};
el.exportBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  el.exportMenu.hidden = !el.exportMenu.hidden;
  el.exportBtn.setAttribute('aria-expanded', String(!el.exportMenu.hidden));
});
el.exportMenu.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', closeExport);
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeExport());
onSeg(el.exportScale, (v) => {
  exportScale = Number(v);
  syncSeg(el.exportScale, v);
});
el.exportGo.addEventListener('click', async () => {
  closeExport();
  try {
    const blob = await viewer.exportPNG(exportScale, el.exportTransparent.checked);
    download(blob, `${baseName()}-exploded@${exportScale}x.png`);
  } catch (err) {
    toast(`Export failed: ${(err as Error).message}`);
  }
});

// keyboard: 0–9 explode shortcuts are handy when presenting
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
  if (e.key === 'e') setExplode({ factor: state.explode.factor > 0.5 ? 0 : 1 });
});

// ---------------------------------------------------------------------------------------
// Boot

async function boot() {
  renderStatus();
  const params = new URLSearchParams(location.search);
  const name = safeModelName(params.get('model'));
  let ok = false;
  if (name) ok = await openUrlModel(name);
  else if (params.get('model')) showBanner('Ignored ?model= — use a file name from /models/, e.g. ?model=station.3dm');
  if (!ok) {
    state.modelParam = null;
    setModel(buildStation(), { intro: !decodeViewHash(location.hash) });
  }
  const shared = decodeViewHash(location.hash);
  if (shared) applyState(shared);
}

void boot();

// expose for debugging / automated screenshots
(window as unknown as { detailExplorer: unknown }).detailExplorer = { viewer, state, applyState, captureState };
