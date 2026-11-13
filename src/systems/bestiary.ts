import { NPC_LIST } from '../data/npcs';
import type { PlayerState } from './playerState';

export interface BestiaryEntry {
  seen: boolean;
  killed: boolean;
}

export type BestiaryMap = Record<string, BestiaryEntry>;

export const BESTIARY_REWARD = {
  seen: { coins: 1, exp: 4 },
  killed: { coins: 3, exp: 12 },
};

/** Non-guardian catalogue entries (guardians still trackable but rare). */
export function bestiaryCatalog(): { id: string; name: string; diet: string; temperament: string }[] {
  return NPC_LIST.map((n) => ({
    id: n.id,
    name: n.name,
    diet: n.diet,
    temperament: n.temperament,
  }));
}

export function ensureBestiary(s: PlayerState): BestiaryMap {
  if (!s.bestiary || typeof s.bestiary !== 'object') s.bestiary = {};
  return s.bestiary;
}

export function noteBestiary(
  s: PlayerState,
  npcId: string,
  kind: 'seen' | 'killed',
): { first: boolean; coins: number; exp: number } | null {
  const map = ensureBestiary(s);
  const e = map[npcId] ?? { seen: false, killed: false };
  map[npcId] = e;
  if (kind === 'seen') {
    if (e.seen) return null;
    e.seen = true;
    return { first: true, ...BESTIARY_REWARD.seen };
  }
  if (e.killed) return null;
  e.killed = true;
  e.seen = true;
  return { first: true, ...BESTIARY_REWARD.killed };
}

export function bestiaryStats(s: PlayerState): { seen: number; killed: number; total: number } {
  const map = ensureBestiary(s);
  const total = NPC_LIST.length;
  let seen = 0;
  let killed = 0;
  for (const n of NPC_LIST) {
    const e = map[n.id];
    if (e?.seen) seen++;
    if (e?.killed) killed++;
  }
  return { seen, killed, total };
}
