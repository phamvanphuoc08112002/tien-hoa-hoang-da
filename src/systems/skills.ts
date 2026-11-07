import { SKILLS, skillRoot } from '../data/skills';
import { getSpecies } from '../data/species';
import type { LearnReq, SkillDef } from '../data/types';
import { SKILL_SLOTS, type PlayerState } from './playerState';

export const SLOT_KEYS = ['Q', 'R', 'T'] as const;

/** Q and R are open from the start, T opens at form 2 (index 1). */
export function slotUnlocked(s: PlayerState, slot: number): boolean {
  return slot < 2 || s.form >= 1;
}

export function reqMet(s: PlayerState, r: LearnReq): boolean {
  const st = s.stats;
  return (
    (r.level === undefined || s.level >= r.level) &&
    (r.form === undefined || s.form >= r.form) &&
    (r.kills === undefined || st.kills >= r.kills) &&
    (r.elites === undefined || st.elites >= r.elites) &&
    (r.days === undefined || st.daysSurvived >= r.days) &&
    (r.drinks === undefined || st.drinks >= r.drinks) &&
    (r.stones === undefined || st.stones >= r.stones)
  );
}

/** Human-readable requirement, e.g. "Cấp 3" or "Uống nước 10 lần (4/10)". */
export function reqLabel(s: PlayerState, r: LearnReq): string {
  const st = s.stats;
  const parts: string[] = [];
  if (r.level !== undefined) parts.push(`Đạt cấp ${r.level}`);
  if (r.form !== undefined) parts.push(`Tiến hóa lên dạng ${r.form + 1}`);
  if (r.kills !== undefined) parts.push(`Hạ gục ${r.kills} sinh vật (${Math.min(st.kills, r.kills)}/${r.kills})`);
  if (r.elites !== undefined) parts.push(`Hạ ${r.elites} Tinh anh (${Math.min(st.elites, r.elites)}/${r.elites})`);
  if (r.days !== undefined) parts.push(`Sống qua ${r.days} bình minh (${Math.min(st.daysSurvived, r.days)}/${r.days})`);
  if (r.drinks !== undefined) parts.push(`Uống nước ${r.drinks} lần (${Math.min(st.drinks, r.drinks)}/${r.drinks})`);
  if (r.stones !== undefined) parts.push(`Chạm ${r.stones} Đá Cổ (${Math.min(st.stones, r.stones)}/${r.stones})`);
  return parts.join(' · ') || 'Có sẵn';
}

export function knowsLine(s: PlayerState, rootId: string): boolean {
  return s.skills.some((id) => skillRoot(id) === rootId);
}

/** Puts a skill into the first free unlocked slot. */
function autoEquip(s: PlayerState, id: string): void {
  if (s.equipped.includes(id)) return;
  for (let i = 0; i < SKILL_SLOTS; i++) {
    if (slotUnlocked(s, i) && !s.equipped[i]) {
      s.equipped[i] = id;
      return;
    }
  }
}

/** Learns every skill whose requirement is now met. Returns the newly learned ids. */
export function syncLearned(s: PlayerState): string[] {
  const learned: string[] = [];
  for (const e of getSpecies(s.speciesId).learnset) {
    if (knowsLine(s, e.skill) || !reqMet(s, e.req)) continue;
    s.skills.push(e.skill);
    learned.push(e.skill);
    autoEquip(s, e.skill);
  }
  // A newly opened slot gets filled with an unequipped skill.
  for (const id of s.skills) autoEquip(s, id);
  return learned;
}

export interface SkillEvolution {
  from: string;
  to: string;
}

function evolveIfReady(s: PlayerState, id: string): SkillEvolution | null {
  const def = SKILLS[id];
  if (!def?.evolvesTo || !def.mastery) return null;
  if ((s.mastery[id] ?? 0) < def.mastery || s.form < (def.evolveForm ?? 0)) return null;
  const to = def.evolvesTo;
  s.skills = s.skills.map((k) => (k === id ? to : k));
  s.equipped = s.equipped.map((k) => (k === id ? to : k));
  delete s.mastery[id];
  s.mastery[to] = 0;
  return { from: id, to };
}

/** Adds mastery to a learned skill; evolves it when the threshold and form requirement are met. */
export function addMastery(s: PlayerState, id: string, amount: number): SkillEvolution | null {
  if (!s.skills.includes(id)) return null;
  const def = SKILLS[id];
  if (!def?.evolvesTo || !def.mastery) return null;
  s.mastery[id] = Math.min(def.mastery, (s.mastery[id] ?? 0) + amount);
  return evolveIfReady(s, id);
}

/** Evolves mastered skills that were only waiting for a higher form. */
export function evolvePending(s: PlayerState): SkillEvolution[] {
  const out: SkillEvolution[] = [];
  for (const id of [...s.skills]) {
    const e = evolveIfReady(s, id);
    if (e) out.push(e);
  }
  return out;
}

/** Binds a learned skill to a slot, swapping if it was already bound elsewhere. */
export function equipSkill(s: PlayerState, id: string, slot: number): boolean {
  if (!s.skills.includes(id) || slot < 0 || slot >= SKILL_SLOTS || !slotUnlocked(s, slot)) return false;
  const prev = s.equipped.indexOf(id);
  if (prev === slot) return true;
  if (prev >= 0) s.equipped[prev] = s.equipped[slot];
  s.equipped[slot] = id;
  return true;
}

export function equippedSkill(s: PlayerState, slot: number): SkillDef | null {
  if (!slotUnlocked(s, slot)) return null;
  const id = s.equipped[slot];
  return id ? SKILLS[id] ?? null : null;
}

/** Fills in skill fields for saves made before skills could be learned. */
export function ensureSkillState(s: PlayerState): void {
  const sp = getSpecies(s.speciesId);
  const legacy = !Array.isArray(s.skills);
  if (legacy) s.skills = [];
  s.skills = s.skills.filter((id) => SKILLS[id] && sp.learnset.some((e) => e.skill === skillRoot(id)));
  if (s.skills.length === 0) s.skills.push(sp.learnset[0].skill);
  if (!Array.isArray(s.equipped)) s.equipped = [];
  s.equipped = Array.from({ length: SKILL_SLOTS }, (_, i): string | null => {
    const id = s.equipped[i];
    return typeof id === 'string' && s.skills.includes(id) ? id : null;
  });
  if (!s.equipped.some(Boolean)) s.equipped[0] = s.skills[0];
  if (!s.mastery || typeof s.mastery !== 'object') s.mastery = {};
  for (const k of Object.keys(s.mastery)) if (typeof s.mastery[k] !== 'number' || !Number.isFinite(s.mastery[k])) delete s.mastery[k];
  syncLearned(s);
  // Final-form characters from older saves already had their upgraded moves.
  if (legacy && s.form >= 2) {
    for (const id of s.skills) {
      const d = SKILLS[id];
      if (d.mastery && (d.evolveForm ?? 0) <= 1) s.mastery[id] = d.mastery;
    }
    evolvePending(s);
  }
}
