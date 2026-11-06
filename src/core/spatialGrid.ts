export interface Positioned {
  x: number;
  y: number;
}

/**
 * Uniform-cell spatial hash for near-neighbour queries.
 * Items are re-bucketed with `update` when they move.
 */
export class SpatialGrid<T extends Positioned> {
  private cells = new Map<number, T[]>();
  private where = new Map<T, number>();

  constructor(private cellSize: number) {}

  private key(cx: number, cy: number): number {
    return (cx + 1024) * 4096 + (cy + 1024);
  }

  private cellOf(x: number, y: number): number {
    return this.key(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize));
  }

  insert(item: T): void {
    const k = this.cellOf(item.x, item.y);
    let arr = this.cells.get(k);
    if (!arr) {
      arr = [];
      this.cells.set(k, arr);
    }
    arr.push(item);
    this.where.set(item, k);
  }

  remove(item: T): void {
    const k = this.where.get(item);
    if (k === undefined) return;
    const arr = this.cells.get(k);
    if (arr) {
      const i = arr.indexOf(item);
      if (i >= 0) {
        arr[i] = arr[arr.length - 1];
        arr.pop();
      }
    }
    this.where.delete(item);
  }

  update(item: T): void {
    const k = this.cellOf(item.x, item.y);
    const old = this.where.get(item);
    if (old === k) return;
    this.remove(item);
    this.insert(item);
  }

  clear(): void {
    this.cells.clear();
    this.where.clear();
  }

  /** Calls `fn` for every item within `radius` of (x, y). */
  forEachInRadius(x: number, y: number, radius: number, fn: (item: T, d2: number) => void): void {
    const r2 = radius * radius;
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize);
    const maxY = Math.floor((y + radius) / this.cellSize);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const arr = this.cells.get(this.key(cx, cy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const it = arr[i];
          const dx = it.x - x;
          const dy = it.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) fn(it, d2);
        }
      }
    }
  }

  queryRadius(x: number, y: number, radius: number): T[] {
    const out: T[] = [];
    this.forEachInRadius(x, y, radius, (it) => out.push(it));
    return out;
  }

  nearest(x: number, y: number, radius: number, filter: (item: T) => boolean): T | null {
    let best: T | null = null;
    let bestD = Infinity;
    this.forEachInRadius(x, y, radius, (it, d2) => {
      if (d2 < bestD && filter(it)) {
        bestD = d2;
        best = it;
      }
    });
    return best;
  }
}
