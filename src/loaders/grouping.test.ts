import { describe, expect, it } from 'vitest';
import { displayName, fileKind, groupByLayer, rgbToHex, safeModelName, uniqueIds } from './grouping';

describe('groupByLayer', () => {
  const layers = [
    { index: 0, name: 'Cladding', color: { r: 211, g: 208, b: 201 } },
    { index: 1, name: 'Empty' },
    { index: 2, name: 'Structure', visible: false },
    { index: 3, name: 'Landscape' },
  ];
  it('buckets by layer index in Rhino layer order and drops empty layers', () => {
    const items = [
      { id: 'a', l: 3 },
      { id: 'b', l: 0 },
      { id: 'c', l: 2 },
      { id: 'd', l: 0 },
    ];
    const b = groupByLayer(items, (i) => i.l, layers);
    expect(b.map((x) => x.name)).toEqual(['Cladding', 'Structure', 'Landscape']);
    expect(b[0].items.map((i) => i.id)).toEqual(['b', 'd']);
    expect(b[0].color).toBe('#d3d0c9');
    expect(b[1].visible).toBe(false);
  });
  it('puts unknown layers in a trailing Default bucket', () => {
    const b = groupByLayer([{ l: 9 }, { l: undefined }, { l: 0 }], (i) => i.l, layers);
    expect(b.map((x) => x.name)).toEqual(['Cladding', 'Default']);
    expect(b[1].items).toHaveLength(2);
  });
});

describe('helpers', () => {
  it('rgbToHex clamps and pads', () => {
    expect(rgbToHex({ r: 0, g: 15, b: 300 })).toBe('#000fff');
  });
  it('displayName uses the leaf of nested layers', () => {
    expect(displayName({ name: '', fullPath: 'A::B::Glass' })).toBe('Glass');
    expect(displayName({ name: 'Roof' })).toBe('Roof');
  });
  it('uniqueIds de-duplicates', () => {
    expect(uniqueIds(['Glass', 'glass', 'Façade 2', ''])).toEqual(['glass', 'glass-2', 'fa-ade-2', 'layer']);
  });
  it('safeModelName rejects paths and other extensions', () => {
    expect(safeModelName('station.3dm')).toBe('station.3dm');
    expect(safeModelName('my model.glb')).toBe('my model.glb');
    expect(safeModelName('../secret.3dm')).toBeNull();
    expect(safeModelName('https://evil/x.3dm')).toBeNull();
    expect(safeModelName('x.exe')).toBeNull();
    expect(safeModelName(null)).toBeNull();
  });
  it('fileKind', () => {
    expect(fileKind('A.3DM')).toBe('3dm');
    expect(fileKind('a.glb')).toBe('gltf');
    expect(fileKind('a.obj')).toBeNull();
  });
});
