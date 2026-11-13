import { describe, expect, it } from 'vitest';
import { layoutLabels } from './labelLayout';
import { formatMm, resolveUnits } from './units';
import { DEFAULT_EXPLODE, ViewState, decodeViewHash, encodeViewHash, parseViewState } from './viewState';

describe('layoutLabels', () => {
  const H = 20;
  const noOverlap = (ys: number[]) => {
    const s = [...ys].sort((a, b) => a - b);
    for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1]).toBeGreaterThanOrEqual(H - 1e-9);
  };

  it('keeps well-separated labels where they are', () => {
    expect(layoutLabels([10, 100, 200], { height: H })).toEqual([10, 100, 200]);
  });
  it('spreads colliding labels symmetrically', () => {
    const r = layoutLabels([100, 100, 100], { height: H });
    noOverlap(r);
    expect(r).toEqual([80, 100, 120]);
  });
  it('preserves order (no crossing leaders)', () => {
    const r = layoutLabels([50, 45, 40, 300], { height: H, spacing: 4 });
    noOverlap(r);
    expect(r[2]).toBeLessThan(r[1]);
    expect(r[1]).toBeLessThan(r[0]);
    expect(r[3]).toBe(300);
  });
  it('respects bounds', () => {
    const r = layoutLabels([0, 2, 4], { height: H, minY: 0, maxY: 500 });
    noOverlap(r);
    expect(Math.min(...r)).toBeGreaterThanOrEqual(H / 2);
    const r2 = layoutLabels([498, 499, 500], { height: H, minY: 0, maxY: 500 });
    noOverlap(r2);
    expect(Math.max(...r2)).toBeLessThanOrEqual(500 - H / 2);
  });
  it('never overlaps for random input', () => {
    for (let k = 0; k < 50; k++) {
      const ys = Array.from({ length: 8 }, (_, i) => (i * 37 + k * 13) % 200);
      noOverlap(layoutLabels(ys, { height: H, spacing: 2, minY: 0, maxY: 800 }));
    }
  });
});

describe('units', () => {
  it('reads 3DMLoader-style unit objects', () => {
    expect(resolveUnits({ name: 'UnitSystem_Millimeters', value: 2 })).toEqual({
      name: 'Millimeters',
      label: 'mm',
      toMetres: 0.001,
    });
  });
  it('falls back to the numeric value', () => {
    expect(resolveUnits({ name: 'Weird', value: 9 }).label).toBe('ft');
    expect(resolveUnits(3).toMetres).toBe(0.01);
  });
  it('defaults to metres', () => {
    expect(resolveUnits(undefined).toMetres).toBe(1);
    expect(resolveUnits('nonsense').label).toBe('m');
  });
  it('formats mm', () => {
    expect(formatMm(1.25)).toBe('1 250 mm');
    expect(formatMm(0)).toBe('0 mm');
  });
});

describe('view state', () => {
  const state: ViewState = {
    v: 1,
    camera: { position: [10, 12.3456789, -4], target: [0, 1, 0], zoom: 1.5, projection: 'orthographic', preset: 'isometric' },
    explode: { ...DEFAULT_EXPLODE, factor: 0.42, direction: 'radial' },
    style: 'clay',
    section: { enabled: true, position: 0.3 },
    order: ['Cladding', 'Facade', 'Structure', 'Landscape'],
    layers: { Facade: { visible: true, opacity: 0.5, offset: 1.2 }, Landscape: { visible: false, opacity: 1, offset: 0 } },
    selected: 'Facade',
  };

  it('round-trips through the URL hash', () => {
    const hash = '#' + encodeViewHash(state);
    expect(hash.slice('#view='.length)).not.toMatch(/[+/=]/);
    const back = decodeViewHash(hash)!;
    expect(back.explode).toEqual(state.explode);
    expect(back.layers).toEqual(state.layers);
    expect(back.order).toEqual(state.order);
    expect(back.selected).toBe('Facade');
    expect(back.camera!.position[1]).toBeCloseTo(12.346, 3);
    expect(back.style).toBe('clay');
  });
  it('handles unicode layer names', () => {
    const s = { ...state, order: ['Façade — 東'], layers: { 'Façade — 東': { visible: true, opacity: 1, offset: 0 } } };
    expect(decodeViewHash(encodeViewHash(s))!.order).toEqual(['Façade — 東']);
  });
  it('rejects garbage', () => {
    expect(decodeViewHash('#view=!!!')).toBeNull();
    expect(decodeViewHash('#other=1')).toBeNull();
    expect(decodeViewHash('')).toBeNull();
    expect(() => parseViewState(42)).toThrow();
  });
  it('sanitises values', () => {
    const s = parseViewState({ explode: { factor: 3, direction: 'up', gap: -1 }, style: 'neon', layers: { A: { opacity: 9 } } });
    expect(s.explode.factor).toBe(1);
    expect(s.explode.direction).toBe('z');
    expect(s.explode.gap).toBe(0);
    expect(s.style).toBe('shaded');
    expect(s.layers.A.opacity).toBe(1);
    expect(s.camera).toBeUndefined();
  });
});
