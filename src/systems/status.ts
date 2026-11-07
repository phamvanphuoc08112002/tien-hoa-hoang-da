import type { StatusKind } from '../data/types';

export const STATUS_INFO: Record<StatusKind, { name: string; icon: string; tint: number }> = {
  burn: { name: 'Bỏng', icon: '🔥', tint: 0xff9a4a },
  poison: { name: 'Trúng độc', icon: '☠', tint: 0x9ae06a },
  slow: { name: 'Chậm', icon: '🐌', tint: 0x8ac8ff },
  stun: { name: 'Choáng', icon: '💫', tint: 0xfff07a },
};

const DOT_KINDS: StatusKind[] = ['burn', 'poison'];
export const DOT_INTERVAL_SEC = 0.5;

interface Active<S> {
  left: number;
  mag: number;
  source: S | null;
}

/**
 * Timed status effects on one creature. Re-applying keeps the longer duration
 * and the stronger magnitude instead of stacking.
 */
export class StatusEffects<S = unknown> {
  private m = new Map<StatusKind, Active<S>>();
  private dotT = 0;
  /** Duration multiplier for crowd control (bosses resist stun/slow). */
  ccResist = 1;

  apply(kind: StatusKind, sec: number, mag: number, source: S | null): void {
    const dur = kind === 'stun' || kind === 'slow' ? sec * this.ccResist : sec;
    if (dur <= 0) return;
    const cur = this.m.get(kind);
    if (cur) {
      cur.left = Math.max(cur.left, dur);
      cur.mag = Math.max(cur.mag, mag);
      cur.source = source ?? cur.source;
    } else this.m.set(kind, { left: dur, mag, source });
  }

  has(kind: StatusKind): boolean {
    return (this.m.get(kind)?.left ?? 0) > 0;
  }

  left(kind: StatusKind): number {
    return Math.max(0, this.m.get(kind)?.left ?? 0);
  }

  get stunned(): boolean {
    return this.has('stun');
  }

  speedMult(): number {
    const s = this.m.get('slow');
    return s && s.left > 0 ? Math.max(0.25, 1 - s.mag) : 1;
  }

  clear(kind?: StatusKind): void {
    if (kind) this.m.delete(kind);
    else this.m.clear();
  }

  list(): StatusKind[] {
    return [...this.m.entries()].filter(([, a]) => a.left > 0).map(([k]) => k);
  }

  /** Advances timers; returns damage-over-time due this tick (delivered in chunks every 0.5 s). */
  tick(dt: number): { damage: number; source: S | null; kind: StatusKind | null } {
    let damage = 0;
    let source: S | null = null;
    let kind: StatusKind | null = null;
    const anyDot = DOT_KINDS.some((k) => this.has(k));
    if (anyDot) {
      this.dotT += dt;
      while (this.dotT >= DOT_INTERVAL_SEC) {
        this.dotT -= DOT_INTERVAL_SEC;
        for (const k of DOT_KINDS) {
          const a = this.m.get(k);
          if (!a || a.left <= 0) continue;
          damage += a.mag * DOT_INTERVAL_SEC;
          source = a.source ?? source;
          kind = k;
        }
      }
    } else this.dotT = 0;
    for (const [k, a] of this.m) {
      a.left -= dt;
      if (a.left <= 0) this.m.delete(k);
    }
    return { damage, source, kind };
  }
}
