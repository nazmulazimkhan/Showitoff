import { describe, expect, it } from 'vitest';
import {
  Bounds,
  ExplodeLayer,
  computeExplode,
  easeInOutCubic,
  fullTravel,
  gapsFor,
  guideCorners,
  overlapAlong,
  translateBounds,
} from './explode';

const box = (min: [number, number, number], max: [number, number, number]): Bounds => ({ min, max });

// Station-like stack, top first.
const station: ExplodeLayer[] = [
  { id: 'cladding', bounds: box([-17, -8, 6.6], [17, 8, 8.25]) },
  { id: 'facade', bounds: box([-15, -6, 0.4], [15, 6, 7.6]) },
  { id: 'structure', bounds: box([-15, -6, 0], [15, 6, 7.8]) },
  { id: 'landscape', bounds: box([-19, -10, -0.3], [19, 10, 3.2]) },
];

describe('overlapAlong', () => {
  it('is the intersection for partially overlapping boxes', () => {
    expect(overlapAlong(box([0, 0, 5], [1, 1, 10]), box([0, 0, 0], [1, 1, 7]), 2)).toBe(2);
  });
  it('is zero for separated boxes', () => {
    expect(overlapAlong(box([0, 0, 8], [1, 1, 10]), box([0, 0, 0], [1, 1, 7]), 2)).toBe(0);
  });
  it('covers the full lower height when the upper box starts at the same base', () => {
    expect(overlapAlong(box([0, 0, 0], [1, 1, 3]), box([0, 0, 0], [1, 1, 8]), 2)).toBe(8);
  });
});

describe('computeExplode (axis)', () => {
  it('leaves everything in place at factor 0', () => {
    const r = computeExplode(station, { factor: 0, gap: 1.5, spacing: 'even', direction: 'z' });
    for (const l of station) expect(r.offsets[l.id]).toEqual([0, 0, 0]);
    expect(r.recenter[2]).toBeCloseTo(0);
  });

  it('keeps the bottom layer fixed', () => {
    const r = computeExplode(station, { factor: 1, gap: 1.5, spacing: 'even', direction: 'z' });
    expect(r.offsets.landscape).toEqual([0, 0, 0]);
  });

  it('uses (overlap + gap) × factor between consecutive layers', () => {
    const f = 0.6;
    const gap = 1.5;
    const r = computeExplode(station, { factor: f, gap, spacing: 'even', direction: 'z' });
    const dz = (a: string, b: string) => r.offsets[a][2] - r.offsets[b][2];
    expect(dz('structure', 'landscape')).toBeCloseTo((3.2 - 0 + gap) * f);
    expect(dz('facade', 'structure')).toBeCloseTo((7.8 - 0.4 + gap) * f);
    expect(dz('cladding', 'facade')).toBeCloseTo((7.6 - 6.6 + gap) * f);
  });

  it('fully clears overlapping layers at factor 1 with exactly the gap between consecutive ones', () => {
    const gap = 2;
    const r = computeExplode(station, { factor: 1, gap, spacing: 'even', direction: 'z' });
    const moved = station.map((l) => translateBounds(l.bounds, r.offsets[l.id]));
    for (let i = 0; i < moved.length - 1; i++) {
      const clearance = moved[i].min[2] - moved[i + 1].max[2];
      expect(clearance).toBeGreaterThanOrEqual(gap - 1e-9);
    }
    expect(moved[0].min[2] - moved[1].max[2]).toBeCloseTo(gap);
  });

  it('clears non-adjacent layers too (thin layer between tall ones)', () => {
    const layers: ExplodeLayer[] = [
      { id: 'top', bounds: box([0, 0, 1], [1, 1, 2]) },
      { id: 'thin', bounds: box([0, 0, 0], [1, 1, 0.1]) },
      { id: 'tall', bounds: box([0, 0, 0], [1, 1, 10]) },
    ];
    const r = computeExplode(layers, { factor: 1, gap: 0.5, spacing: 'even', direction: 'z' });
    const top = translateBounds(layers[0].bounds, r.offsets.top);
    const tall = translateBounds(layers[2].bounds, r.offsets.tall);
    expect(top.min[2] - tall.max[2]).toBeGreaterThanOrEqual(0.5 - 1e-9);
  });

  it('re-centres the exploded stack on the assembled centre', () => {
    const r = computeExplode(station, { factor: 1, gap: 1.5, spacing: 'even', direction: 'z' });
    const moved = station.map((l) =>
      translateBounds(translateBounds(l.bounds, r.offsets[l.id]), r.recenter),
    );
    const lo = Math.min(...moved.map((b) => b.min[2]));
    const hi = Math.max(...moved.map((b) => b.max[2]));
    expect((lo + hi) / 2).toBeCloseTo((-0.3 + 8.25) / 2);
  });

  it('explodes along X and Y', () => {
    const rx = computeExplode(station, { factor: 1, gap: 1, spacing: 'even', direction: 'x' });
    expect(rx.offsets.cladding[0]).toBeGreaterThan(0);
    expect(rx.offsets.cladding[1]).toBe(0);
    expect(rx.offsets.cladding[2]).toBe(0);
    const ry = computeExplode(station, { factor: 1, gap: 1, spacing: 'even', direction: 'y' });
    expect(ry.offsets.cladding[1]).toBeGreaterThan(0);
    expect(ry.axis).toEqual([0, 1, 0]);
  });

  it('adds extra offset unscaled by factor', () => {
    const r = computeExplode(station, {
      factor: 0,
      gap: 1,
      spacing: 'even',
      direction: 'z',
      extra: { facade: 2.5 },
    });
    expect(r.offsets.facade).toEqual([0, 0, 2.5]);
  });

  it('clamps factor to [0, 1]', () => {
    const a = computeExplode(station, { factor: 5, gap: 1, spacing: 'even', direction: 'z' });
    const b = computeExplode(station, { factor: 1, gap: 1, spacing: 'even', direction: 'z' });
    expect(a.offsets).toEqual(b.offsets);
  });

  it('respects reordering: a layer moved to the top clears everything below', () => {
    const reordered = [station[3], station[0], station[1], station[2]];
    const r = computeExplode(reordered, { factor: 1, gap: 1, spacing: 'even', direction: 'z' });
    const moved = reordered.map((l) => translateBounds(l.bounds, r.offsets[l.id]));
    const highestBelow = Math.max(...moved.slice(1).map((b) => b.max[2]));
    expect(moved[0].min[2]).toBeGreaterThanOrEqual(highestBelow + 1 - 1e-9);
  });

  it('handles empty and single layer input', () => {
    expect(computeExplode([], { factor: 1, gap: 1, spacing: 'even', direction: 'z' }).offsets).toEqual({});
    const one = computeExplode([station[0]], { factor: 1, gap: 1, spacing: 'even', direction: 'z' });
    expect(one.offsets.cladding).toEqual([0, 0, 0]);
  });
});

describe('spacing', () => {
  it('even gives the same gap for every layer', () => {
    expect(gapsFor(station, 2, 'even', 2)).toEqual([2, 2, 2, 2]);
  });
  it('by thickness scales gaps by relative thickness', () => {
    const g = gapsFor(station, 2, 'thickness', 2);
    const mean = g.reduce((a, b) => a + b, 0) / g.length;
    expect(mean).toBeCloseTo(2);
    expect(g[1]).toBeGreaterThan(g[0]); // facade thicker than cladding
  });
  it('by thickness changes the travel', () => {
    const even = fullTravel(station, 2, 'even', 2);
    const thick = fullTravel(station, 2, 'thickness', 2);
    expect(thick).not.toEqual(even);
    expect(thick[3]).toBe(0);
  });
});

describe('radial', () => {
  it('moves concentric layers apart and keeps factor 0 assembled', () => {
    const r0 = computeExplode(station, { factor: 0, gap: 1, spacing: 'even', direction: 'radial' });
    for (const l of station) expect(r0.offsets[l.id].every((v) => Math.abs(v) < 1e-12)).toBe(true);
    const r1 = computeExplode(station, { factor: 1, gap: 1, spacing: 'even', direction: 'radial' });
    expect(r1.offsets.cladding[2]).toBeGreaterThan(0);
    expect(r1.offsets.landscape[2]).toBeLessThan(0);
  });
  it('keeps the vertical clearance of the Z mode', () => {
    const r = computeExplode(station, { factor: 1, gap: 1, spacing: 'even', direction: 'radial' });
    const moved = station.map((l) => translateBounds(l.bounds, r.offsets[l.id]));
    for (let i = 0; i < moved.length - 1; i++) {
      expect(moved[i].min[2] - moved[i + 1].max[2]).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });
  it('pushes off-centre layers outward horizontally', () => {
    const layers: ExplodeLayer[] = [
      { id: 'east', bounds: box([5, -1, 0], [7, 1, 1]) },
      { id: 'west', bounds: box([-7, -1, 0], [-5, 1, 1]) },
    ];
    const r = computeExplode(layers, { factor: 1, gap: 0, spacing: 'even', direction: 'radial' });
    expect(r.offsets.east[0]).toBeGreaterThan(0);
    expect(r.offsets.west[0]).toBeLessThan(0);
  });
});

describe('helpers', () => {
  it('easeInOutCubic hits endpoints and midpoint', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
  });
  it('guideCorners returns 3 corners on the trailing face', () => {
    const c = guideCorners(box([0, 0, 1], [2, 3, 4]), 'z');
    expect(c).toHaveLength(3);
    for (const p of c) expect(p[2]).toBe(1);
    const cx = guideCorners(box([0, 0, 1], [2, 3, 4]), 'x');
    for (const p of cx) expect(p[0]).toBe(0);
  });
});
