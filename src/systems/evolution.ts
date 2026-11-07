import { BALANCE } from '../config/balance';
import { computeStats, type PlayerState } from './playerState';
import { isMaturityFull } from './progression';

export interface EvoContext {
  inCombat: boolean;
  inShelter: boolean;
}

export interface EvoCheck {
  id: 'final' | 'maturity' | 'level' | 'trial' | 'hunger' | 'thirst' | 'combat' | 'shelter';
  label: string;
  ok: boolean;
}

export function evolutionChecks(s: PlayerState, ctx: EvoContext): EvoCheck[] {
  const E = BALANCE.evolution;
  if (s.form >= 2) return [{ id: 'final', label: 'Đã đạt dạng tiến hóa cuối cùng', ok: false }];
  const reqLv = E.requiredLevel[s.form];
  const reqElites = E.requiredElites[s.form] ?? 0;
  const checks: EvoCheck[] = [
    { id: 'maturity', label: `Thanh trưởng thành đầy (${Math.floor(s.maturity)}/${BALANCE.maturity.max})`, ok: isMaturityFull(s) },
    { id: 'level', label: `Cấp độ ≥ ${reqLv} (hiện tại ${s.level})`, ok: s.level >= reqLv },
  ];
  if (reqElites > 0) {
    const have = s.stats.elites ?? 0;
    checks.push({ id: 'trial', label: `Thử thách: hạ gục ${reqElites} sinh vật Tinh anh ★ (${Math.min(have, reqElites)}/${reqElites})`, ok: have >= reqElites });
  }
  return [
    ...checks,
    { id: 'hunger', label: `Độ no ≥ ${E.minHunger}%`, ok: s.hunger >= E.minHunger },
    { id: 'thirst', label: `Lượng nước ≥ ${E.minThirst}%`, ok: s.thirst >= E.minThirst },
    { id: 'combat', label: 'Không đang chiến đấu', ok: !ctx.inCombat },
    { id: 'shelter', label: 'Đang ở trong nơi trú ẩn', ok: ctx.inShelter },
  ];
}

export function canEvolve(s: PlayerState, ctx: EvoContext): boolean {
  return evolutionChecks(s, ctx).every((c) => c.ok);
}

export function evolutionDuration(form: number): number {
  return BALANCE.evolution.durationSec[form] ?? 0;
}

export type EvoUpdate = 'idle' | 'running' | 'done';

/**
 * Time-based evolution. Interruption keeps maturity; only `complete` resets it.
 */
export class EvolutionProcess {
  active = false;
  elapsed = 0;
  duration = 0;
  lastInterruptReason: string | null = null;

  start(s: PlayerState, ctx: EvoContext): { ok: boolean; reason?: string } {
    if (this.active) return { ok: false, reason: 'Đang tiến hóa' };
    const checks = evolutionChecks(s, ctx);
    const fail = checks.find((c) => !c.ok);
    if (fail) return { ok: false, reason: fail.label };
    this.active = true;
    this.elapsed = 0;
    this.duration = evolutionDuration(s.form);
    this.lastInterruptReason = null;
    return { ok: true };
  }

  update(dt: number): EvoUpdate {
    if (!this.active) return 'idle';
    this.elapsed += dt;
    if (this.elapsed >= this.duration) {
      this.active = false;
      return 'done';
    }
    return 'running';
  }

  interrupt(reason: string): boolean {
    if (!this.active) return false;
    this.active = false;
    this.elapsed = 0;
    this.lastInterruptReason = reason;
    return true;
  }

  get progress(): number {
    return this.duration > 0 ? Math.min(1, this.elapsed / this.duration) : 0;
  }
}

/** Applies a successful evolution: next form, maturity reset, full heal. */
export function completeEvolution(s: PlayerState): void {
  if (s.form >= 2) return;
  s.form += 1;
  s.maturity = 0;
  s.satiation = 0;
  const st = computeStats(s);
  s.hp = st.maxHp;
  s.stamina = st.stamina;
  s.stats.evolutions++;
}
