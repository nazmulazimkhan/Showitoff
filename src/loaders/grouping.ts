/** Pure helpers for grouping imported objects into explodable layers. */

export interface RhinoLayerInfo {
  index: number;
  name: string;
  fullPath?: string;
  color?: { r: number; g: number; b: number; a?: number };
  visible?: boolean;
}

export interface LayerBucket<T> {
  key: string;
  name: string;
  /** Rhino layer table position, used for ordering */
  order: number;
  color?: string;
  visible: boolean;
  items: T[];
}

export function rgbToHex(c: { r: number; g: number; b: number }): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/**
 * Bucket objects by Rhino layer index. Buckets come out in Rhino layer table order
 * (the order of the Layers panel, top first); empty layers are dropped. Objects with an
 * unknown layer go to a trailing "Default" bucket.
 */
export function groupByLayer<T>(items: T[], layerOf: (item: T) => number | undefined, layers: RhinoLayerInfo[]): LayerBucket<T>[] {
  const byIndex = new Map<number, LayerBucket<T>>();
  layers.forEach((l, pos) => {
    byIndex.set(l.index ?? pos, {
      key: `layer-${l.index ?? pos}`,
      name: displayName(l),
      order: pos,
      color: l.color ? rgbToHex(l.color) : undefined,
      visible: l.visible !== false,
      items: [],
    });
  });
  let fallback: LayerBucket<T> | undefined;
  for (const item of items) {
    const idx = layerOf(item);
    let bucket = idx === undefined ? undefined : byIndex.get(idx);
    if (!bucket) {
      fallback ??= { key: 'layer-default', name: 'Default', order: Number.MAX_SAFE_INTEGER, visible: true, items: [] };
      bucket = fallback;
    }
    bucket.items.push(item);
  }
  const out = [...byIndex.values()].filter((b) => b.items.length > 0);
  if (fallback) out.push(fallback);
  return out.sort((a, b) => a.order - b.order);
}

/** "Building::Facade::Glass" → "Glass"; keeps the leaf name readable in the panel. */
export function displayName(l: Pick<RhinoLayerInfo, 'name' | 'fullPath'>): string {
  const n = l.name || l.fullPath || 'Layer';
  return n.includes('::') ? n.split('::').pop()! : n;
}

/** Make ids unique and URL-safe for view state. */
export function uniqueIds(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const base = n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'layer';
    const k = seen.get(base) ?? 0;
    seen.set(base, k + 1);
    return k === 0 ? base : `${base}-${k + 1}`;
  });
}

/** Model-file name for a ?model= parameter; rejects paths so only /models/<file> can load. */
export function safeModelName(param: string | null): string | null {
  if (!param) return null;
  const name = param.trim();
  if (!/^[\w][\w.\- ]*\.(3dm|glb|gltf)$/i.test(name)) return null;
  return name;
}

export function fileKind(name: string): '3dm' | 'gltf' | null {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === '3dm') return '3dm';
  if (ext === 'glb' || ext === 'gltf') return 'gltf';
  return null;
}
