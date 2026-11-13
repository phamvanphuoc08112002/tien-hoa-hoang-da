import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { isPositionFree, moveCircle, moveRadiusFor, unstuckCircle } from '../src/world/collision';
import { BLK, type WorldData } from '../src/world/tiles';
import { generateWorld } from '../src/world/worldGen';

const T = BALANCE.tile;

function blankWorld(w = 8, h = 8): WorldData {
  const N = w * h;
  return {
    w,
    h,
    seed: 't',
    tiles: new Uint8Array(N),
    biome: new Uint8Array(N),
    blocked: new Uint8Array(N),
    reach1: new Uint8Array(N).fill(1),
    reach2: new Uint8Array(N).fill(1),
    objects: [],
    spawn: { tx: 4, ty: 4 },
    shoreTiles: [],
    rockCenter: { tx: 4, ty: 4 },
    lakeCenter: { tx: 4, ty: 4 },
    swampCenter: { tx: 4, ty: 4 },
    portal: null,
  };
}

describe('collision unstuck / move radius', () => {
  it('caps move radius so large forms fit between blockers', () => {
    expect(moveRadiusFor(11)).toBe(11);
    expect(moveRadiusFor(44)).toBe(BALANCE.world.maxMoveRadius);
    expect(BALANCE.world.maxMoveRadius).toBeLessThanOrEqual(T / 2);
  });

  it('pulls a circle out when embedded in a solid tile', () => {
    const world = blankWorld();
    // Solid ring around a free center.
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        world.blocked[y * world.w + x] = x === 0 || y === 0 || x === world.w - 1 || y === world.h - 1 ? BLK.SOLID : BLK.FREE;
      }
    }
    const stuckX = 0 * T + 4;
    const stuckY = 4 * T + T / 2;
    expect(isPositionFree(world, stuckX, stuckY, 12, false)).toBe(false);
    const u = unstuckCircle(world, stuckX, stuckY, 12, false);
    expect(u.moved).toBe(true);
    expect(isPositionFree(world, u.x, u.y, 12, false)).toBe(true);
  });

  it('large capped radius can slide in a 1-tile corridor between solids', () => {
    const world = blankWorld(9, 5);
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        // Free row y=2; solids above/below.
        world.blocked[y * world.w + x] = y === 2 ? BLK.FREE : BLK.SOLID;
      }
    }
    const r = moveRadiusFor(44);
    const y = 2 * T + T / 2;
    const x0 = 2 * T + T / 2;
    expect(isPositionFree(world, x0, y, r, false)).toBe(true);
    const moved = moveCircle(world, x0, y, T * 3, 0, r, false);
    expect(moved.x).toBeGreaterThan(x0 + T);
    expect(isPositionFree(world, moved.x, moved.y, r, false)).toBe(true);
  });

  it('shallow and deep water are swimmable, walls stay solid', () => {
    const world = blankWorld();
    world.blocked[2 * world.w + 2] = BLK.WATER;
    world.tiles[2 * world.w + 2] = 3; // WATER
    const x = 2 * T + T / 2;
    const y = 2 * T + T / 2;
    expect(isPositionFree(world, x, y, 10, false)).toBe(true);
    const moved = moveCircle(world, T + T / 2, y, T, 0, 10, false);
    expect(moved.x).toBeGreaterThan(T + T / 2);
    world.blocked[2 * world.w + 3] = BLK.SOLID;
    const blocked = moveCircle(world, x, y, T, 0, 10, false);
    expect(blocked.blockedX).toBe(true);
  });

  it('generated forests do not mark trees as solid blockers', () => {
    const w = generateWorld('ALPHA');
    let treeTiles = 0;
    let treeSolid = 0;
    for (const o of w.objects) {
      if (o.kind !== 'tree' && o.kind !== 'pine') continue;
      treeTiles++;
      if (w.blocked[o.ty * w.w + o.tx] === BLK.SOLID) treeSolid++;
    }
    expect(treeTiles).toBeGreaterThan(50);
    expect(treeSolid).toBe(0);
  });
});
