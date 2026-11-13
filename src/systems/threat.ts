import { BALANCE } from '../config/balance';
import { realmOf } from '../data/realms';
import type { NpcDef, StatusSpec } from '../data/types';

export type EliteAffix = 'hung_bao' | 'giap_da' | 'kich_doc' | 'hoa_nguc' | 'hut_mau';

export const AFFIXES: Record<EliteAffix, { name: string; desc: string; tint: number; status?: StatusSpec }> = {
  hung_bao: { name: 'Hung Bạo', desc: 'nhanh và tấn công dồn dập', tint: 0xff8a8a },
  giap_da: { name: 'Giáp Đá', desc: 'phòng thủ cực dày', tint: 0xc8c0b0 },
  kich_doc: { name: 'Kịch Độc', desc: 'đòn đánh gây độc', tint: 0xa8f07a, status: { kind: 'poison', sec: 4, mag: 0.3 } },
  hoa_nguc: { name: 'Hỏa Ngục', desc: 'đòn đánh gây bỏng', tint: 0xffb06a, status: { kind: 'burn', sec: 3, mag: 0.35 } },
  hut_mau: { name: 'Hút Máu', desc: 'hồi máu khi gây sát thương', tint: 0xff6aa0 },
};
export const AFFIX_IDS = Object.keys(AFFIXES) as EliteAffix[];

export interface NpcScaling {
  maxHp: number;
  power: number;
  defense: number;
  speed: number;
  level: number;
  expMult: number;
  atkCdMult: number;
  lifesteal: number;
}

/** Danger tier (0..maxTier) from distance to spawn in tiles. */
export function tierAt(distTiles: number): number {
  const t = BALANCE.threat;
  return Math.max(0, Math.min(t.maxTier, Math.floor(distTiles / t.tierTiles)));
}

export function dayBonus(days: number): number {
  const t = BALANCE.threat;
  return Math.min(t.maxDayBonus, Math.max(0, days) * t.perDay);
}

export function canBeElite(def: NpcDef): boolean {
  return !def.unique && def.temperament !== 'prey';
}

export function eliteChance(tier: number, bloodMoon: boolean, realm = 0, eliteBonus = 0): number {
  const t = BALANCE.threat;
  return t.eliteChance + t.eliteChancePerTier * tier + (bloodMoon ? 0.1 : 0) + eliteBonus + realmOf(realm).scaling.eliteChance;
}

/** Effective stats for a creature spawned in a given tier/day/realm, optionally as an elite. */
export function scaleNpc(def: NpcDef, tier: number, days: number, affix: EliteAffix | null, realm = 0): NpcScaling {
  if (def.guardian) {
    return { maxHp: def.stats.maxHp, power: def.stats.power, defense: def.stats.defense, speed: def.stats.speed, level: def.level, expMult: 1, atkCdMult: 1, lifesteal: 0 };
  }
  const t = BALANCE.threat;
  const rs = realmOf(realm).scaling;
  const db = dayBonus(days);
  const elite = affix !== null;
  let maxHp = def.stats.maxHp * (1 + t.hpPerTier * tier + db) * rs.hp;
  let power = def.stats.power * (1 + t.powerPerTier * tier + db * 0.75) * rs.power;
  let defense = def.stats.defense * (1 + t.defensePerTier * tier) * rs.defense;
  let speed = def.stats.speed;
  let atkCdMult = 1;
  let lifesteal = 0;
  if (elite) {
    maxHp *= t.eliteHp;
    power *= t.elitePower;
    defense *= t.eliteDefense;
    speed *= t.eliteSpeed;
    if (affix === 'hung_bao') {
      speed *= 1.15;
      atkCdMult = 0.7;
    } else if (affix === 'giap_da') defense *= 1.5;
    else if (affix === 'hut_mau') lifesteal = 0.3;
  }
  return {
    maxHp: Math.round(maxHp),
    power,
    defense,
    speed,
    level: def.level + t.levelPerTier * tier + (elite ? t.eliteLevel : 0) + rs.level,
    expMult: (1 + 0.25 * tier + db) * (elite ? t.eliteExp : 1) * rs.exp,
    atkCdMult,
    lifesteal,
  };
}

/** Night number since start (night of day 1 = 1). Blood moon on every Nth night. */
export function isBloodMoonNight(day: number): boolean {
  return day > 0 && day % BALANCE.threat.bloodMoonEvery === 0;
}
