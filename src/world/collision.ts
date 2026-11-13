import { BALANCE } from '../config/balance';
import { BLK, TT, isDrinkableTile, type WorldData } from './tiles';

const T = BALANCE.tile;

/** Collision radius used for walking (visual radius may be larger after evolution). */
export function moveRadiusFor(visualRadius: number): number {
  return Math.max(6, Math.min(visualRadius, BALANCE.world.maxMoveRadius));
}

export function isSolidTile(world: WorldData, tx: number, ty: number, canClimb: boolean): boolean {
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return true;
  const b = world.blocked[ty * world.w + tx];
  // Water is swimmable (rivers / lakes); only walls and unclimbable ledges block.
  return b === BLK.SOLID || (b === BLK.LEDGE && !canClimb);
}

/** True when the tile is water that slows grounded movement (fords stay normal speed). */
export function isSwimTile(world: WorldData, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return false;
  const t = world.tiles[ty * world.w + tx];
  return t === TT.WATER || t === TT.DEEP;
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

/**
 * If the circle is embedded in solids (dash / growth / knockback), slide to the
 * nearest free spot so the creature is never permanently stuck.
 */
export function unstuckCircle(
  world: WorldData,
  x: number,
  y: number,
  r: number,
  canClimb: boolean,
  maxDist = 96,
): { x: number; y: number; moved: boolean } {
  if (!circleHitsSolid(world, x, y, r, canClimb)) return { x, y, moved: false };
  // Prefer the center of the current tile first.
  const cx = Math.floor(x / T) * T + T / 2;
  const cy = Math.floor(y / T) * T + T / 2;
  if (!circleHitsSolid(world, cx, cy, r, canClimb)) return { x: cx, y: cy, moved: true };
  for (let rad = 4; rad <= maxDist; rad += 4) {
    const steps = Math.max(8, rad);
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const nx = x + Math.cos(a) * rad;
      const ny = y + Math.sin(a) * rad;
      if (!circleHitsSolid(world, nx, ny, r, canClimb)) return { x: nx, y: ny, moved: true };
    }
  }
  return { x, y, moved: false };
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
