import { BALANCE } from '../config/balance';
import { isBloodMoonNight } from './threat';

export type WorldEventId = 'none' | 'blood_moon' | 'migration' | 'toxic_fog' | 'ember_winds' | 'crystal_rain';

export interface EventMods {
  id: WorldEventId;
  name: string;
  icon: string;
  toast: string;
  power: number;
  detect: number;
  population: number;
  eliteBonus: number;
  /** Optional aura status applied rarely to player outdoors. */
  playerAura?: { kind: 'poison' | 'burn'; chancePerSec: number; sec: number; mag: number };
}

const TABLE: Omit<EventMods, 'id'>[] = [
  {
    name: 'Trăng Máu',
    icon: '🩸',
    toast: 'Trăng Máu đã mọc! Thú săn mạnh hơn và đông hơn.',
    power: BALANCE.threat.bloodMoonPower,
    detect: BALANCE.threat.bloodMoonDetect,
    population: BALANCE.threat.bloodMoonPopulation,
    eliteBonus: 0.1,
  },
  {
    name: 'Đàn Di Cư',
    icon: '🦌',
    toast: 'Đàn thú di cư — sinh vật xuất hiện dày hơn khắp bản đồ.',
    power: 1.05,
    detect: 1.1,
    population: 1.55,
    eliteBonus: 0.03,
  },
  {
    name: 'Sương Độc',
    icon: '☠',
    toast: 'Sương độc lan trong đêm — đứng ngoài trời có thể trúng độc.',
    power: 1.1,
    detect: 1.15,
    population: 1.1,
    eliteBonus: 0.04,
    playerAura: { kind: 'poison', chancePerSec: 0.08, sec: 3, mag: 0.22 },
  },
  {
    name: 'Gió Than',
    icon: '🔥',
    toast: 'Gió than nóng — ngoài trời có nguy cơ bị bỏng nhẹ.',
    power: 1.15,
    detect: 1.05,
    population: 1.05,
    eliteBonus: 0.05,
    playerAura: { kind: 'burn', chancePerSec: 0.07, sec: 2.5, mag: 0.25 },
  },
  {
    name: 'Mưa Tinh Thể',
    icon: '💎',
    toast: 'Mưa tinh thể — thú dữ yếu hơn một chút, dễ săn hơn.',
    power: 0.92,
    detect: 0.95,
    population: 1.2,
    eliteBonus: 0.02,
  },
];

const NONE: EventMods = {
  id: 'none',
  name: '',
  icon: '',
  toast: '',
  power: 1,
  detect: 1,
  population: 1,
  eliteBonus: 0,
};

function hashNight(seed: string, night: number): number {
  let h = night * 2654435761;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 1597334677);
  return (h >>> 0) / 4294967296;
}

/** Deterministic night event (blood moon nights always win). */
export function nightEventId(seed: string, nightIndex: number): WorldEventId {
  if (nightIndex <= 0) return 'none';
  if (isBloodMoonNight(nightIndex)) return 'blood_moon';
  const r = hashNight(seed, nightIndex);
  if (r < 0.22) return 'migration';
  if (r < 0.4) return 'toxic_fog';
  if (r < 0.55) return 'ember_winds';
  if (r < 0.7) return 'crystal_rain';
  return 'none';
}

export function eventMods(id: WorldEventId): EventMods {
  if (id === 'none') return NONE;
  if (id === 'blood_moon') return { id, ...TABLE[0] };
  if (id === 'migration') return { id, ...TABLE[1] };
  if (id === 'toxic_fog') return { id, ...TABLE[2] };
  if (id === 'ember_winds') return { id, ...TABLE[3] };
  if (id === 'crystal_rain') return { id, ...TABLE[4] };
  return NONE;
}

export function eventModsForNight(seed: string, nightIndex: number, isNight: boolean): EventMods {
  if (!isNight) return NONE;
  return eventMods(nightEventId(seed, nightIndex));
}
