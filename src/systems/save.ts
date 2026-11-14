import { BALANCE } from '../config/balance';
import { isConsumable } from '../data/consumables';
import { FOODS } from '../data/foods';
import { LAST_REALM } from '../data/realms';
import { SPECIES, getSpecies } from '../data/species';
import { COLOR_VARIANTS } from '../data/shop';
import type { Weather } from '../data/types';
import type { PlayerState } from './playerState';
import { ensureLives, sanitizePlayerName } from './playerState';
import { ensureSkillState } from './skills';
import { ensureBestiary } from './bestiary';

export const SAVE_KEY = 'tien-hoa-hoang-da.save';
export const SAVE_BACKUP_KEY = 'tien-hoa-hoang-da.save.bak';

export interface ResourceChange {
  /** Portions currently left. */
  p: number;
  /** Simulated time at which the node fully regrows. */
  at: number;
}

export interface WorldSave {
  time: number;
  weather: Weather;
  weatherRemaining: number;
  weatherRolls: number;
  resources: Record<string, ResourceChange>;
  collectedCoins: number[];
  stonesUsed: number[];
  alphaDefeatedAt: number | null;
  /** Simulated time each unique boss was last defeated, by NPC id. */
  bosses: Record<string, number>;
  /** The current realm's gate guardian has been defeated (the gate is open). */
  guardianDown: boolean;
}

export interface SaveData {
  version: number;
  savedAt: number;
  seed: string;
  player: PlayerState;
  world: WorldSave;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type LoadResult =
  | { status: 'none' }
  | { status: 'ok'; data: SaveData }
  | { status: 'error'; message: string };

/** Migrations from older versions: key = version being upgraded from. */
const MIGRATIONS: Record<number, (raw: any) => any> = {};

export function migrate(raw: any): any {
  let v = typeof raw?.version === 'number' ? raw.version : -1;
  while (v < BALANCE.saveVersion && MIGRATIONS[v]) {
    raw = MIGRATIONS[v](raw);
    v = raw.version;
  }
  return raw;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** Returns an error message (Vietnamese) or null if the save is structurally valid. */
export function validateSave(d: any): string | null {
  if (!d || typeof d !== 'object') return 'Dữ liệu không phải đối tượng hợp lệ.';
  if (!isNum(d.version)) return 'Thiếu số phiên bản bản lưu.';
  if (d.version > BALANCE.saveVersion) return `Bản lưu thuộc phiên bản mới hơn (v${d.version}) so với game (v${BALANCE.saveVersion}).`;
  if (d.version < BALANCE.saveVersion) return `Bản lưu phiên bản cũ (v${d.version}) không thể chuyển đổi.`;
  if (!isStr(d.seed) || d.seed.length === 0) return 'Thiếu seed bản đồ.';
  const p = d.player;
  if (!p || typeof p !== 'object') return 'Thiếu dữ liệu nhân vật.';
  if (!SPECIES.some((s) => s.id === p.speciesId)) return 'Loài sinh vật không xác định.';
  if (p.name !== undefined && p.name !== null && !isStr(p.name)) return 'Tên nhân vật không hợp lệ.';
  if (!isNum(p.form) || p.form < 0 || p.form > 4 || Math.floor(p.form) !== p.form) return 'Dạng tiến hóa không hợp lệ.';
  for (const k of ['level', 'exp', 'maturity', 'hp', 'hunger', 'thirst', 'stamina', 'fatigue', 'coins', 'x', 'y', 'slots', 'satiation']) {
    if (!isNum(p[k])) return `Chỉ số "${k}" bị hỏng.`;
  }
  if (p.hp <= 0) return 'Nhân vật trong bản lưu đã chết.';
  if (!Array.isArray(p.inventory) || p.inventory.length !== p.slots) return 'Túi đồ bị hỏng.';
  for (const it of p.inventory) if (it !== null && !(isStr(it) && (FOODS[it] || isConsumable(it)))) return 'Vật phẩm không xác định trong túi đồ.';
  if (!Array.isArray(p.unlockedColors) || !p.unlockedColors.every((c: unknown) => isStr(c) && COLOR_VARIANTS.some((v) => v.id === c))) return 'Danh sách màu bị hỏng.';
  if (!Array.isArray(p.markers) || !Array.isArray(p.milestones) || !Array.isArray(p.discoveredSectors) || !Array.isArray(p.discoveredBiomes)) return 'Dữ liệu khám phá bị hỏng.';
  if (!p.stats || typeof p.stats !== 'object') return 'Thống kê bị hỏng.';
  const w = d.world;
  if (!w || typeof w !== 'object') return 'Thiếu dữ liệu thế giới.';
  if (!isNum(w.time) || w.time < 0) return 'Thời gian mô phỏng bị hỏng.';
  if (!['clear', 'rain', 'heat'].includes(w.weather)) return 'Thời tiết không hợp lệ.';
  if (!w.resources || typeof w.resources !== 'object') return 'Dữ liệu tài nguyên bị hỏng.';
  if (!Array.isArray(w.collectedCoins) || !Array.isArray(w.stonesUsed)) return 'Dữ liệu vật phẩm thế giới bị hỏng.';
  return null;
}

/** Clamps numeric values into legal ranges after validation. */
function sanitize(d: SaveData): SaveData {
  const p = d.player;
  const c = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  p.level = c(Math.floor(p.level), 1, BALANCE.progression.maxLevel);
  p.form = c(Math.floor(p.form), 0, getSpecies(p.speciesId).forms.length - 1);
  p.maturity = c(p.maturity, 0, BALANCE.maturity.max);
  p.hunger = c(p.hunger, 0, 100);
  p.thirst = c(p.thirst, 0, 100);
  p.fatigue = c(p.fatigue, 0, 100);
  p.coins = Math.max(0, Math.floor(p.coins));
  p.slots = c(Math.floor(p.slots), 1, BALANCE.inventory.maxSlots);
  if (!p.unlockedColors.includes(p.colorVariant)) p.colorVariant = 'goc';
  p.name = isStr(p.name) ? sanitizePlayerName(p.name) : '';
  for (const k of ['kills', 'foodEaten', 'drinks', 'daysSurvived', 'timeAlive', 'evolutions', 'elites', 'bosses', 'stones', 'bloodMoons'] as const) {
    if (!isNum(p.stats[k])) p.stats[k] = 0;
  }
  ensureSkillState(p);
  ensureBestiary(p);
  ensureLives(p);
  p.realm = isNum(p.realm) ? c(Math.floor(p.realm), 0, LAST_REALM) : 0;
  const w = d.world;
  w.guardianDown = w.guardianDown === true;
  w.weatherRemaining = isNum(w.weatherRemaining) ? w.weatherRemaining : 60;
  w.weatherRolls = isNum(w.weatherRolls) ? w.weatherRolls : 0;
  w.alphaDefeatedAt = isNum(w.alphaDefeatedAt) ? w.alphaDefeatedAt : null;
  const bosses: Record<string, number> = {};
  if (w.bosses && typeof w.bosses === 'object') for (const [k, v] of Object.entries(w.bosses)) if (isNum(v)) bosses[k] = v;
  if (w.alphaDefeatedAt !== null && bosses.nham_chua === undefined) bosses.nham_chua = w.alphaDefeatedAt;
  w.bosses = bosses;
  return d;
}

export function serializeSave(d: SaveData): string {
  return JSON.stringify(d);
}

export function parseSave(json: string): LoadResult {
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch {
    return { status: 'error', message: 'Bản lưu bị hỏng (không đọc được JSON).' };
  }
  raw = migrate(raw);
  const err = validateSave(raw);
  if (err) return { status: 'error', message: err };
  return { status: 'ok', data: sanitize(raw as SaveData) };
}

export function loadSave(storage: StorageLike): LoadResult {
  let json: string | null;
  try {
    json = storage.getItem(SAVE_KEY);
  } catch {
    return { status: 'error', message: 'Trình duyệt chặn truy cập bộ nhớ cục bộ.' };
  }
  if (!json) return { status: 'none' };
  return parseSave(json);
}

export function writeSave(storage: StorageLike, d: SaveData): { ok: boolean; error?: string } {
  try {
    const prev = storage.getItem(SAVE_KEY);
    const json = serializeSave(d);
    storage.setItem(SAVE_KEY, json);
    if (prev) storage.setItem(SAVE_BACKUP_KEY, prev);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function deleteSave(storage: StorageLike): void {
  try {
    storage.removeItem(SAVE_KEY);
    storage.removeItem(SAVE_BACKUP_KEY);
  } catch {
    /* storage unavailable: nothing to delete */
  }
}

export class MemoryStorage implements StorageLike {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}
