import { BALANCE } from '../config/balance';
import { BLK, type WorldData } from './tiles';

const N4: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function walkable(world: WorldData, i: number, canClimb: boolean): boolean {
  const b = world.blocked[i];
  return b === BLK.FREE || b === BLK.WATER || (canClimb && b === BLK.LEDGE);
}

/** Nearest walkable tile within `radius` (Chebyshev), or null. */
function nearestWalkable(world: WorldData, tx: number, ty: number, canClimb: boolean, radius = 10): { tx: number; ty: number } | null {
  const { w: W, h: H } = world;
  if (tx >= 0 && ty >= 0 && tx < W && ty < H && walkable(world, ty * W + tx, canClimb)) return { tx, ty };
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx;
        const y = ty + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (walkable(world, y * W + x, canClimb)) return { tx: x, ty: y };
      }
    }
  }
  return null;
}

/**
 * Tile BFS path from world pixels → world-pixel tile centers.
 * Returns null if unreachable.
 */
export function findPath(
  world: WorldData,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  canClimb: boolean,
): { x: number; y: number }[] | null {
  const T = BALANCE.tile;
  const { w: W, h: H } = world;
  const N = W * H;
  const start = nearestWalkable(world, Math.floor(fromX / T), Math.floor(fromY / T), canClimb);
  const end = nearestWalkable(world, Math.floor(toX / T), Math.floor(toY / T), canClimb);
  if (!start || !end) return null;

  const s = start.ty * W + start.tx;
  const e = end.ty * W + end.tx;
  if (s === e) {
    return [{ x: end.tx * T + T / 2, y: end.ty * T + T / 2 }];
  }

  const parent = new Int32Array(N).fill(-1);
  const q = new Int32Array(N);
  let head = 0;
  let tail = 0;
  q[tail++] = s;
  parent[s] = s;
  let found = false;
  while (head < tail) {
    const i = q[head++];
    if (i === e) {
      found = true;
      break;
    }
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of N4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (parent[j] !== -1 || !walkable(world, j, canClimb)) continue;
      parent[j] = i;
      q[tail++] = j;
    }
  }
  if (!found) return null;

  const tiles: number[] = [];
  for (let i = e; ; i = parent[i]) {
    tiles.push(i);
    if (i === s) break;
  }
  tiles.reverse();

  // Thin the polyline: keep every Nth tile + last for map readability.
  const step = Math.max(1, Math.floor(tiles.length / 80));
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (i !== 0 && i !== tiles.length - 1 && i % step !== 0) continue;
    const ti = tiles[i];
    out.push({ x: (ti % W) * T + T / 2, y: ((ti / W) | 0) * T + T / 2 });
  }
  return out;
}
