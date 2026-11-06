import type { Biome, ResourceKind } from '../data/types';

/** Terrain tile types. */
export const TT = {
  GRASS: 0,
  FOREST: 1,
  SAND: 2,
  WATER: 3,
  DEEP: 4,
  ROCK: 5,
  PLATEAU: 6,
  LEDGE: 7,
  FORD: 8,
  WALL: 9,
} as const;
export type TileType = (typeof TT)[keyof typeof TT];

export const BIOME_IDS: Biome[] = ['grass', 'forest', 'lake', 'rock'];
export const BIOME_NAMES: Record<Biome, string> = {
  grass: 'Đồng cỏ',
  forest: 'Rừng rậm',
  lake: 'Hồ & suối',
  rock: 'Vùng đá',
};

/** Movement blocking classes stored in WorldData.blocked. */
export const BLK = { FREE: 0, SOLID: 1, WATER: 2, LEDGE: 3 } as const;

export type StructureKind = 'shelter' | 'shrine' | 'stone';
export type ObjKind = 'tree' | 'pine' | 'boulder' | 'coin' | StructureKind | ResourceKind;

export interface WorldObject {
  id: number;
  kind: ObjKind;
  tx: number;
  ty: number;
  x: number;
  y: number;
  blocks: boolean;
  variant: number;
}

export interface WorldData {
  seed: string;
  w: number;
  h: number;
  tiles: Uint8Array;
  biome: Uint8Array;
  blocked: Uint8Array;
  /** 1 if the tile is reachable from spawn without climbing ledges. */
  reach1: Uint8Array;
  /** 1 if the tile is reachable from spawn when ledges can be climbed. */
  reach2: Uint8Array;
  objects: WorldObject[];
  spawn: { tx: number; ty: number };
  /** Walkable tiles 4-adjacent to drinkable water. */
  shoreTiles: number[];
  rockCenter: { tx: number; ty: number };
  lakeCenter: { tx: number; ty: number };
}

export function isWaterTile(t: number): boolean {
  return t === TT.WATER || t === TT.DEEP || t === TT.FORD;
}

export function isDrinkableTile(t: number): boolean {
  return t === TT.WATER || t === TT.DEEP || t === TT.FORD;
}
