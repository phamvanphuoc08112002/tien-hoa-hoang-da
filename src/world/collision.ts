import { BALANCE } from '../config/balance';
import { BLK, TT, isDrinkableTile, type WorldData } from './tiles';

const T = BALANCE.tile;

export function isSolidTile(world: WorldData, tx: number, ty: number, canClimb: boolean): boolean {
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return true;
  const b = world.blocked[ty * world.w + tx];
  return b === BLK.SOLID || b === BLK.WATER || (b === BLK.LEDGE && !canClimb);
}

function circleHitsSolid(world: WorldData, cx: number, cy: number, r: number, canClimb: boolean): boolean {
  const minTx = Math.floor((cx - r) / T);
  const maxTx = Math.floor((cx + r) / T);
  const minTy = Math.floor((cy - r) / T);
  const maxTy = Math.floor((cy + r) / T);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!isSolidTile(world, tx, ty, canClimb)) continue;
      const nx = Math.max(tx * T, Math.min(cx, tx * T + T));
      const ny = Math.max(ty * T, Math.min(cy, ty * T + T));
      const dx = cx - nx;
      const dy = cy - ny;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

export interface MoveResult {
  x: number;
  y: number;
  blockedX: boolean;
  blockedY: boolean;
}

/** Moves a circle by (dx, dy) with axis-separated sliding against solid tiles. */
export function moveCircle(world: WorldData, x: number, y: number, dx: number, dy: number, r: number, canClimb: boolean): MoveResult {
  const len = Math.hypot(dx, dy);
  const maxStep = Math.max(2, r * 0.5);
  const steps = Math.max(1, Math.ceil(len / maxStep));
  const sx = dx / steps;
  const sy = dy / steps;
  let blockedX = false;
  let blockedY = false;
  for (let s = 0; s < steps; s++) {
    if (sx !== 0) {
      if (!circleHitsSolid(world, x + sx, y, r, canClimb)) x += sx;
      else blockedX = true;
    }
    if (sy !== 0) {
      if (!circleHitsSolid(world, x, y + sy, r, canClimb)) y += sy;
      else blockedY = true;
    }
  }
  return { x, y, blockedX, blockedY };
}

export function isPositionFree(world: WorldData, x: number, y: number, r: number, canClimb: boolean): boolean {
  return !circleHitsSolid(world, x, y, r, canClimb);
}

/** True if no solid object/wall lies on the segment (water and ledges are ignored). */
export function segmentClear(world: WorldData, x0: number, y0: number, x1: number, y1: number): boolean {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(len / 6));
  for (let s = 1; s < steps; s++) {
    const px = x0 + ((x1 - x0) * s) / steps;
    const py = y0 + ((y1 - y0) * s) / steps;
    const tx = Math.floor(px / T);
    const ty = Math.floor(py / T);
    if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return false;
    if (world.blocked[ty * world.w + tx] === BLK.SOLID) return false;
  }
  return true;
}

/**
 * Finds drinkable water within `range` px of the creature's edge with a clear line.
 * Returns the water point or null.
 */
export function findDrinkableWater(world: WorldData, x: number, y: number, r: number, range: number): { x: number; y: number } | null {
  const ctx = Math.floor(x / T);
  const cty = Math.floor(y / T);
  // Standing in a ford counts as being at the water.
  if (ctx >= 0 && cty >= 0 && ctx < world.w && cty < world.h && world.tiles[cty * world.w + ctx] === TT.FORD) return { x, y };
  const reach = r + range;
  const rt = Math.ceil(reach / T);
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let ty = cty - rt; ty <= cty + rt; ty++) {
    for (let tx = ctx - rt; tx <= ctx + rt; tx++) {
      if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) continue;
      if (!isDrinkableTile(world.tiles[ty * world.w + tx])) continue;
      const nx = Math.max(tx * T, Math.min(x, tx * T + T));
      const ny = Math.max(ty * T, Math.min(y, ty * T + T));
      const d = Math.hypot(nx - x, ny - y);
      if (d > reach || d >= bestD) continue;
      if (!segmentClear(world, x, y, nx, ny)) continue;
      bestD = d;
      best = { x: nx, y: ny };
    }
  }
  return best;
}
