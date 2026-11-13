/**
 * Pure explode maths. No three.js dependency so it can be unit-tested in isolation.
 *
 * Coordinates are the model frame (Rhino convention: Z-up, metres).
 * Layers are given in explode order, TOP FIRST (the order shown in the layer panel).
 * The last layer is the base: it never moves.
 */

export type Vec3 = [number, number, number];

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface ExplodeLayer {
  id: string;
  bounds: Bounds;
}

export type Direction = 'x' | 'y' | 'z' | 'radial';
export type Spacing = 'even' | 'thickness';

export interface ExplodeParams {
  /** 0 = assembled, 1 = fully exploded */
  factor: number;
  /** clear gap between consecutive layers at full explode, model units */
  gap: number;
  spacing: Spacing;
  direction: Direction;
  /** extra per-layer offset along the explode direction, model units (not scaled by factor) */
  extra?: Record<string, number>;
}

export interface ExplodeResult {
  /** translation to apply to each layer */
  offsets: Record<string, Vec3>;
  /** translation for the whole model so the exploded stack stays centred on the assembled centre */
  recenter: Vec3;
  /** unit vector used for axis modes (zero for radial) */
  axis: Vec3;
}

const AXES: Record<Exclude<Direction, 'radial'>, Vec3> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function boundsCenter(b: Bounds): Vec3 {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (list.length === 0) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const b of list) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], b.min[i]);
      max[i] = Math.max(max[i], b.max[i]);
    }
  }
  return { min, max };
}

export function translateBounds(b: Bounds, t: Vec3): Bounds {
  return {
    min: [b.min[0] + t[0], b.min[1] + t[1], b.min[2] + t[2]],
    max: [b.max[0] + t[0], b.max[1] + t[1], b.max[2] + t[2]],
  };
}

/** Interval of a box projected on a principal axis. */
function interval(b: Bounds, axisIndex: number): [number, number] {
  return [b.min[axisIndex], b.max[axisIndex]];
}

/**
 * How far `upper` has to move along the axis so its low face sits on `lower`'s high face.
 * This is the "vertical overlap" of the two boxes in the clearance sense: it is the
 * intersection length for partially overlapping boxes and grows to the full height of
 * `lower` when `upper` sits inside or below it. Never negative.
 */
export function overlapAlong(upper: Bounds, lower: Bounds, axisIndex: number): number {
  const [uLo] = interval(upper, axisIndex);
  const [, lHi] = interval(lower, axisIndex);
  return Math.max(0, lHi - uLo);
}

export function thicknessAlong(b: Bounds, axisIndex: number): number {
  return Math.max(0, b.max[axisIndex] - b.min[axisIndex]);
}

/**
 * Gap used above each layer. "even" = constant gap; "thickness" = gap scaled by the
 * moving layer's thickness relative to the mean thickness, so thick layers get more air.
 */
export function gapsFor(layers: ExplodeLayer[], gap: number, spacing: Spacing, axisIndex: number): number[] {
  if (spacing === 'even' || layers.length === 0) return layers.map(() => gap);
  const t = layers.map((l) => thicknessAlong(l.bounds, axisIndex));
  const mean = t.reduce((a, b) => a + b, 0) / t.length;
  if (mean <= 0) return layers.map(() => gap);
  return t.map((v) => (gap * v) / mean);
}

/**
 * Full-explode travel (factor = 1) for each layer along a principal axis, TOP FIRST order.
 * Walks from the base upward. Each layer travels at least
 *   travel(lower) + overlap(upper, lower) + gap
 * relative to the layer directly below it, and additionally far enough to clear every
 * other layer below it (so a thin layer between two tall ones cannot cause a clash).
 */
export function fullTravel(layers: ExplodeLayer[], gap: number, spacing: Spacing, axisIndex: number): number[] {
  const n = layers.length;
  const travel = new Array<number>(n).fill(0);
  const gaps = gapsFor(layers, gap, spacing, axisIndex);
  for (let i = n - 2; i >= 0; i--) {
    const upper = layers[i].bounds;
    const below = layers[i + 1];
    let t = travel[i + 1] + overlapAlong(upper, below.bounds, axisIndex) + gaps[i];
    for (let j = i + 2; j < n; j++) {
      const lower = layers[j].bounds;
      t = Math.max(t, lower.max[axisIndex] + travel[j] + gaps[i] - upper.min[axisIndex]);
    }
    travel[i] = t;
  }
  return travel;
}

function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function computeExplode(layers: ExplodeLayer[], params: ExplodeParams): ExplodeResult {
  const f = clamp01(params.factor);
  const extra = params.extra ?? {};
  const offsets: Record<string, Vec3> = {};
  if (layers.length === 0) return { offsets, recenter: [0, 0, 0], axis: [0, 0, 0] };

  if (params.direction === 'radial') {
    return radial(layers, f, params.gap, params.spacing, extra);
  }

  const axis = AXES[params.direction];
  const ai = axis.indexOf(1);
  const travel = fullTravel(layers, params.gap, params.spacing, ai);
  layers.forEach((l, i) => {
    offsets[l.id] = scale(axis, travel[i] * f + (extra[l.id] ?? 0));
  });

  // Re-centre: keep the centre of the exploded stack where the assembled centre was.
  const assembled = unionBounds(layers.map((l) => l.bounds))!;
  const exploded = unionBounds(layers.map((l) => translateBounds(l.bounds, offsets[l.id])))!;
  const shift = (assembled.min[ai] + assembled.max[ai]) / 2 - (exploded.min[ai] + exploded.max[ai]) / 2;
  return { offsets, recenter: scale(axis, shift), axis };
}

/**
 * Radial: layers spread outward from the model centre. Vertically they get the same
 * clearance as the Z mode but split symmetrically about the middle of the stack (upper
 * layers rise, lower ones sink); horizontally each layer is pushed away from the centre
 * in proportion to how far its own centre sits from it (so off-centre parts fan out).
 */
function radial(layers: ExplodeLayer[], f: number, gap: number, spacing: Spacing, extra: Record<string, number>): ExplodeResult {
  const offsets: Record<string, Vec3> = {};
  const all = unionBounds(layers.map((l) => l.bounds))!;
  const c = boundsCenter(all);
  const travel = fullTravel(layers, gap, spacing, 2);
  const mid = (travel[0] + travel[travel.length - 1]) / 2;
  layers.forEach((l, i) => {
    const lc = boundsCenter(l.bounds);
    const h: Vec3 = [lc[0] - c[0], lc[1] - c[1], 0];
    const v = (travel[i] - mid) * f;
    const off: Vec3 = [h[0] * f, h[1] * f, v];
    const len = Math.hypot(off[0], off[1], off[2]);
    const e = extra[l.id] ?? 0;
    if (e) {
      const dir: Vec3 = len > 1e-9 ? [off[0] / len, off[1] / len, off[2] / len] : [0, 0, 1];
      off[0] += dir[0] * e;
      off[1] += dir[1] * e;
      off[2] += dir[2] * e;
    }
    offsets[l.id] = off;
  });
  return { offsets, recenter: [0, 0, 0], axis: [0, 0, 0] };
}

/** Ease in-out cubic, t in [0,1]. */
export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Corners used for guide lines: three corners of the box face that trails the explode
 * direction (the bottom face for Z). Returned in model coordinates of the assembled box.
 */
export function guideCorners(b: Bounds, direction: Direction): Vec3[] {
  const ai = direction === 'x' ? 0 : direction === 'y' ? 1 : 2;
  const [u, v] = [0, 1, 2].filter((k) => k !== ai);
  const pick = (cu: number, cv: number): Vec3 => {
    const p: Vec3 = [0, 0, 0];
    p[ai] = b.min[ai];
    p[u] = cu;
    p[v] = cv;
    return p;
  };
  return [pick(b.min[u], b.min[v]), pick(b.max[u], b.min[v]), pick(b.max[u], b.max[v])];
}
