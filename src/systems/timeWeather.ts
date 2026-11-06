import { BALANCE } from '../config/balance';
import { lerpColor, multiplyColor } from '../core/math';
import { Rng } from '../core/rng';
import type { Weather } from '../data/types';

/** Simulated clock. `time` is total simulated seconds since the run started. */
export class WorldClock {
  constructor(public time = 0) {}

  get dayLength(): number {
    return BALANCE.time.dayLengthSec;
  }
  /** 0..1, where 0 is midnight. */
  get timeOfDay(): number {
    const t = BALANCE.time.startTimeOfDay + this.time / this.dayLength;
    return t - Math.floor(t);
  }
  get hour(): number {
    return this.timeOfDay * 24;
  }
  /** Day counter starting at 1. */
  get day(): number {
    return Math.floor(BALANCE.time.startTimeOfDay + this.time / this.dayLength) + 1;
  }
  get isNight(): boolean {
    const h = this.hour;
    return h >= BALANCE.time.nightHour || h < BALANCE.time.dawnHour;
  }

  /** Advances time; returns how many dawns (06:00) were crossed. */
  update(dt: number): number {
    const before = this.dawnIndex();
    this.time += dt;
    return this.dawnIndex() - before;
  }

  private dawnIndex(): number {
    const dawnFrac = 6 / 24;
    return Math.floor(BALANCE.time.startTimeOfDay + this.time / this.dayLength - dawnFrac);
  }
}

/** 0 at full day, 1 at deepest night, smooth across dawn/dusk. */
export function nightFactor(hour: number): number {
  const T = BALANCE.time;
  if (hour >= T.dayHour && hour <= T.duskHour) return 0;
  if (hour >= T.nightHour || hour <= T.dawnHour) return 1;
  if (hour > T.duskHour && hour < T.nightHour) return smooth((hour - T.duskHour) / (T.nightHour - T.duskHour));
  return 1 - smooth((hour - T.dawnHour) / (T.dayHour - T.dawnHour));
}

function smooth(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

const KEY_COLORS: [number, number][] = [
  [0, 0x3c4a8c],
  [4.5, 0x3c4a8c],
  [6, 0xffb48a],
  [8, 0xffffff],
  [17, 0xffffff],
  [18.8, 0xffa070],
  [20.5, 0x46549a],
  [24, 0x3c4a8c],
];

/** Multiplicative light tint for the hour and weather. */
export function ambientTint(hour: number, weather: Weather): number {
  let c = 0xffffff;
  for (let k = 0; k < KEY_COLORS.length - 1; k++) {
    const [h0, c0] = KEY_COLORS[k];
    const [h1, c1] = KEY_COLORS[k + 1];
    if (hour >= h0 && hour <= h1) {
      c = lerpColor(c0, c1, (hour - h0) / Math.max(0.0001, h1 - h0));
      break;
    }
  }
  if (weather === 'rain') c = multiplyColor(c, 0xb4bccc);
  else if (weather === 'heat') c = multiplyColor(c, 0xfff0c8);
  return c;
}

export const WEATHER_NAMES: Record<Weather, string> = {
  clear: 'Trời quang',
  rain: 'Mưa',
  heat: 'Nắng nóng',
};

/** Deterministic weather roller (seeded with run seed + roll counter). */
export class WeatherSystem {
  state: Weather = 'clear';
  remaining = 150;
  rolls = 0;

  constructor(private seed: string) {}

  restore(state: Weather, remaining: number, rolls: number): void {
    this.state = state;
    this.remaining = remaining;
    this.rolls = rolls;
  }

  /** Returns true when the weather changed this tick. */
  update(dt: number, hour: number): boolean {
    this.remaining -= dt;
    const isNight = hour >= BALANCE.time.duskHour + 1 || hour < BALANCE.time.dayHour;
    if (this.state === 'heat' && isNight) {
      this.state = 'clear';
      this.remaining = 90;
      return true;
    }
    if (this.remaining > 0) return false;
    const rng = new Rng(`${this.seed}:weather:${this.rolls++}`);
    const W = BALANCE.weather;
    const opts: [Weather, number][] = [
      ['clear', W.weights.clear],
      ['rain', W.weights.rain],
      ['heat', isNight ? 0 : W.weights.heat],
    ];
    const total = opts.reduce((a, [, w]) => a + w, 0);
    let r = rng.next() * total;
    let next: Weather = 'clear';
    for (const [w, wt] of opts) {
      r -= wt;
      if (r <= 0) {
        next = w;
        break;
      }
    }
    const changed = next !== this.state;
    this.state = next;
    this.remaining = rng.range(W.minDurationSec, W.maxDurationSec);
    return changed;
  }
}
