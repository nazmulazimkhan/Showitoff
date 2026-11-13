/**
 * 1-D label de-overlap: given desired vertical positions (screen px, label centres) and a
 * label height, return positions that keep every pair at least `height + spacing` apart,
 * stay inside [minY, maxY] when possible and move labels as little as possible.
 * Order is preserved (labels never swap), so leader lines never cross.
 */
export interface LabelLayoutOptions {
  height: number;
  spacing?: number;
  minY?: number;
  maxY?: number;
}

export function layoutLabels(desired: number[], opts: LabelLayoutOptions): number[] {
  const n = desired.length;
  if (n === 0) return [];
  const step = opts.height + (opts.spacing ?? 0);
  const half = opts.height / 2;
  const minY = (opts.minY ?? -Infinity) + half;
  const maxY = (opts.maxY ?? Infinity) - half;

  const order = desired.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i);

  // Cluster-merge (classic "force-free" layout): each cluster is a run of labels packed at
  // `step`, centred on the mean of their desired positions. Merge clusters that collide.
  type Cluster = { start: number; count: number; sum: number; top: number };
  const clusters: Cluster[] = [];
  const place = (c: Cluster) => {
    // top position minimising squared displacement = mean(desired) - (count-1)/2 * step
    let top = c.sum / c.count - ((c.count - 1) / 2) * step;
    const span = (c.count - 1) * step;
    if (top < minY) top = minY;
    if (top + span > maxY) top = Math.max(minY, maxY - span);
    c.top = top;
  };
  for (let k = 0; k < order.length; k++) {
    const c: Cluster = { start: k, count: 1, sum: order[k].y, top: 0 };
    place(c);
    clusters.push(c);
    while (clusters.length > 1) {
      const b = clusters[clusters.length - 1];
      const a = clusters[clusters.length - 2];
      if (a.top + (a.count - 1) * step + step <= b.top + 1e-9) break;
      a.count += b.count;
      a.sum += b.sum;
      clusters.pop();
      place(a);
    }
  }

  const out = new Array<number>(n);
  for (const c of clusters) {
    for (let k = 0; k < c.count; k++) out[order[c.start + k].i] = c.top + k * step;
  }
  return out;
}
