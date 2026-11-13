import type { Direction, Spacing } from './explode';

export type RenderStyle = 'shaded' | 'clay' | 'line';
export type ViewPreset = 'isometric' | 'dimetric' | 'planometric' | 'front' | 'top' | 'custom';
export type Projection = 'orthographic' | 'perspective';

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
  projection: Projection;
  preset: ViewPreset;
}

export interface LayerViewState {
  visible: boolean;
  opacity: number;
  /** extra offset in metres */
  offset: number;
}

export interface ViewState {
  v: 1;
  camera?: CameraState;
  explode: {
    factor: number;
    gap: number;
    spacing: Spacing;
    direction: Direction;
    guides: boolean;
    labels: boolean;
  };
  style: RenderStyle;
  section: { enabled: boolean; position: number };
  /** explode order, top first, by layer name */
  order: string[];
  layers: Record<string, LayerViewState>;
  selected?: string;
}

export const DEFAULT_EXPLODE: ViewState['explode'] = {
  factor: 1,
  gap: 1.5,
  spacing: 'even',
  direction: 'z',
  guides: true,
  labels: true,
};

const DIRECTIONS: Direction[] = ['x', 'y', 'z', 'radial'];
const SPACINGS: Spacing[] = ['even', 'thickness'];
const STYLES: RenderStyle[] = ['shaded', 'clay', 'line'];
const PRESETS: ViewPreset[] = ['isometric', 'dimetric', 'planometric', 'front', 'top', 'custom'];

const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d;
const vec3 = (v: unknown): [number, number, number] | null =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
    ? [v[0], v[1], v[2]]
    : null;

/** Validate arbitrary JSON into a ViewState, filling defaults. Throws on non-objects. */
export function parseViewState(input: unknown): ViewState {
  if (!input || typeof input !== 'object') throw new Error('View state must be an object');
  const o = input as Record<string, any>;
  const e = (o.explode ?? {}) as Record<string, unknown>;
  const state: ViewState = {
    v: 1,
    explode: {
      factor: num(e.factor, DEFAULT_EXPLODE.factor, 0, 1),
      gap: num(e.gap, DEFAULT_EXPLODE.gap, 0),
      spacing: oneOf(e.spacing, SPACINGS, DEFAULT_EXPLODE.spacing),
      direction: oneOf(e.direction, DIRECTIONS, DEFAULT_EXPLODE.direction),
      guides: bool(e.guides, DEFAULT_EXPLODE.guides),
      labels: bool(e.labels, DEFAULT_EXPLODE.labels),
    },
    style: oneOf(o.style, STYLES, 'shaded'),
    section: {
      enabled: bool(o.section?.enabled, false),
      position: num(o.section?.position, 0.5, 0, 1),
    },
    order: Array.isArray(o.order) ? o.order.filter((s: unknown): s is string => typeof s === 'string') : [],
    layers: {},
  };
  if (typeof o.selected === 'string') state.selected = o.selected;
  if (o.layers && typeof o.layers === 'object') {
    for (const [name, l] of Object.entries(o.layers as Record<string, any>)) {
      if (!l || typeof l !== 'object') continue;
      state.layers[name] = {
        visible: bool(l.visible, true),
        opacity: num(l.opacity, 1, 0, 1),
        offset: num(l.offset, 0),
      };
    }
  }
  const c = o.camera;
  if (c && typeof c === 'object') {
    const position = vec3(c.position);
    const target = vec3(c.target);
    if (position && target) {
      state.camera = {
        position,
        target,
        zoom: num(c.zoom, 1, 1e-4),
        projection: oneOf(c.projection, ['orthographic', 'perspective'] as const, 'orthographic'),
        preset: oneOf(c.preset, PRESETS, 'custom'),
      };
    }
  }
  return state;
}

// --- URL hash encoding (base64url of UTF-8 JSON) -------------------------------------

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const round = (v: number, p = 4) => Math.round(v * 10 ** p) / 10 ** p;

/** Compact numbers so links stay short. */
function compact(state: ViewState): ViewState {
  const c = state.camera;
  return {
    ...state,
    camera: c && {
      ...c,
      position: c.position.map((v) => round(v, 3)) as [number, number, number],
      target: c.target.map((v) => round(v, 3)) as [number, number, number],
      zoom: round(c.zoom),
    },
    explode: { ...state.explode, factor: round(state.explode.factor), gap: round(state.explode.gap, 3) },
  };
}

export function encodeViewHash(state: ViewState): string {
  return 'view=' + toBase64Url(JSON.stringify(compact(state)));
}

/** Returns null when the hash holds no (valid) view. Accepts with or without leading '#'. */
export function decodeViewHash(hash: string): ViewState | null {
  const h = hash.replace(/^#/, '');
  const part = h.split('&').find((p) => p.startsWith('view='));
  if (!part) return null;
  try {
    return parseViewState(JSON.parse(fromBase64Url(part.slice(5))));
  } catch {
    return null;
  }
}
