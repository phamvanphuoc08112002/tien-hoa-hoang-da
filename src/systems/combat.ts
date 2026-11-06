import { BALANCE } from '../config/balance';
import { angleDiff } from '../core/math';

/** Damage after defense mitigation. `roll` in [0,1) supplies variance deterministically in tests. */
export function computeDamage(power: number, mult: number, defense: number, roll: number): number {
  const C = BALANCE.combat;
  const variance = 1 - C.damageVariance + roll * C.damageVariance * 2;
  const raw = power * mult * variance;
  const mitigated = raw * (C.defenseK / (C.defenseK + Math.max(0, defense)));
  return Math.max(1, Math.round(mitigated));
}

export class Cooldowns {
  private remaining = new Map<string, number>();
  private totals = new Map<string, number>();

  start(id: string, sec: number): void {
    this.remaining.set(id, sec);
    this.totals.set(id, sec);
  }
  ready(id: string): boolean {
    return (this.remaining.get(id) ?? 0) <= 0;
  }
  left(id: string): number {
    return Math.max(0, this.remaining.get(id) ?? 0);
  }
  /** 0 = ready, 1 = just started. */
  fraction(id: string): number {
    const t = this.totals.get(id) ?? 0;
    if (t <= 0) return 0;
    return Math.max(0, Math.min(1, (this.remaining.get(id) ?? 0) / t));
  }
  tick(dt: number): void {
    for (const [k, v] of this.remaining) {
      if (v > 0) this.remaining.set(k, v - dt);
    }
  }
  clear(): void {
    this.remaining.clear();
    this.totals.clear();
  }
}

/** One swing / blast. Each target can be hit at most once per instance. */
export class HitInstance {
  private hitIds = new Set<number>();
  constructor(
    public ownerId: number,
    public damageMult: number,
    public knockback: number,
  ) {}
  tryHit(targetId: number): boolean {
    if (targetId === this.ownerId || this.hitIds.has(targetId)) return false;
    this.hitIds.add(targetId);
    return true;
  }
  get count(): number {
    return this.hitIds.size;
  }
}

/** True if a circle target (tx, ty, tr) overlaps an arc sector centred on (ox, oy). */
export function arcHits(ox: number, oy: number, dir: number, arcRad: number, range: number, tx: number, ty: number, tr: number): boolean {
  const dx = tx - ox;
  const dy = ty - oy;
  const d = Math.hypot(dx, dy);
  if (d > range + tr) return false;
  if (d <= tr) return true;
  const a = Math.atan2(dy, dx);
  const tolerance = Math.asin(Math.min(1, tr / d));
  return Math.abs(angleDiff(dir, a)) <= arcRad / 2 + tolerance;
}

export function circleHits(ox: number, oy: number, r: number, tx: number, ty: number, tr: number): boolean {
  const dx = tx - ox;
  const dy = ty - oy;
  return dx * dx + dy * dy <= (r + tr) * (r + tr);
}
