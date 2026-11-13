import type { PlayerState } from '../systems/playerState';
import { realmOf } from './realms';

export interface QuestDef {
  id: string;
  /** If set, only shown in that realm index. */
  realm?: number;
  title: string;
  desc: string;
  /** How progress is measured. */
  kind: 'milestone' | 'stat' | 'biome' | 'bestiary_kills' | 'guardian';
  /** Milestone id, stat key, biome id, or kill count target. */
  key: string;
  target: number;
}

/** Mid-run objectives — keep the player pointed at the next meaningful step. */
export const QUESTS: QuestDef[] = [
  { id: 'q_first_meal', title: 'Ăn no lần đầu', desc: 'Ăn một món phù hợp khẩu vị.', kind: 'milestone', key: 'first_meal', target: 1 },
  { id: 'q_first_drink', title: 'Tìm nước uống', desc: 'Uống nước ở hồ / suối / bến cạn.', kind: 'milestone', key: 'first_drink', target: 1 },
  { id: 'q_first_kill', title: 'Hạ gục đầu tiên', desc: 'Đánh bại một sinh vật.', kind: 'milestone', key: 'first_kill', target: 1 },
  { id: 'q_explore', title: 'Khám phá 5 vùng', desc: 'Đặt chân tới cỏ, rừng, hồ, đá và đầm.', kind: 'milestone', key: 'all_biomes', target: 1 },
  { id: 'q_elite', title: 'Săn Tinh anh ★', desc: 'Hạ một sinh vật Tinh anh.', kind: 'milestone', key: 'elite_1', target: 1 },
  { id: 'q_evolve1', title: 'Tiến hóa lần đầu', desc: 'Hoàn tất nghi thức tiến hóa dạng 2.', kind: 'milestone', key: 'evolve_1', target: 1 },
  { id: 'q_evolve2', title: 'Đủ sức mở Cổng', desc: 'Đạt dạng 3 để thách đấu Boss Giữ Cổng.', kind: 'milestone', key: 'evolve_2', target: 1 },
  { id: 'q_hunter', title: 'Thợ săn (10)', desc: 'Hạ tổng cộng 10 sinh vật.', kind: 'stat', key: 'kills', target: 10 },
  { id: 'q_bestiary3', title: 'Sổ sinh vật', desc: 'Hạ ít nhất 3 loài khác nhau.', kind: 'bestiary_kills', key: 'killed', target: 3 },
  { id: 'q_guardian', title: 'Mở Cổng Cổ', desc: 'Hạ Boss Giữ Cổng của vùng đất hiện tại.', kind: 'guardian', key: 'guardian', target: 1 },
  // Realm flavour (optional extras)
  { id: 'q_r0_stone', realm: 0, title: 'Đá Cổ', desc: 'Tìm và dùng Đá Cổ trên bản đồ.', kind: 'stat', key: 'stones', target: 1 },
  { id: 'q_r1_fog', realm: 1, title: 'Sống trong sương', desc: 'Sống sót qua 2 bình minh ở Rừng Sương Mù.', kind: 'stat', key: 'daysSurvived', target: 2 },
];

export interface QuestProgress {
  id: string;
  title: string;
  desc: string;
  progress: number;
  target: number;
  done: boolean;
}

function bestiaryKilled(s: PlayerState): number {
  const b = s.bestiary ?? {};
  return Object.values(b).filter((e) => e.killed).length;
}

function progressOf(q: QuestDef, s: PlayerState, guardianDown: boolean): number {
  switch (q.kind) {
    case 'milestone':
      return s.milestones.includes(q.key) ? 1 : 0;
    case 'stat': {
      const v = (s.stats as unknown as Record<string, number>)[q.key];
      return typeof v === 'number' ? v : 0;
    }
    case 'biome':
      return s.discoveredBiomes.includes(q.key) ? 1 : 0;
    case 'bestiary_kills':
      return bestiaryKilled(s);
    case 'guardian':
      return guardianDown ? 1 : 0;
    default:
      return 0;
  }
}

/** Active (incomplete first, then recently done) objectives for this realm. */
export function listQuests(s: PlayerState, guardianDown: boolean): QuestProgress[] {
  const realm = s.realm ?? 0;
  return QUESTS.filter((q) => q.realm === undefined || q.realm === realm)
    .map((q) => {
      const progress = Math.min(q.target, progressOf(q, s, guardianDown));
      return {
        id: q.id,
        title: q.title,
        desc: q.desc,
        progress,
        target: q.target,
        done: progress >= q.target,
      };
    })
    .sort((a, b) => Number(a.done) - Number(b.done));
}

/** Single HUD line: first incomplete quest, or realm clear hint. */
export function primaryQuest(s: PlayerState, guardianDown: boolean): QuestProgress | null {
  const list = listQuests(s, guardianDown);
  const open = list.find((q) => !q.done);
  if (open) return open;
  const realm = realmOf(s.realm ?? 0);
  return {
    id: 'q_realm_clear',
    title: guardianDown ? `${realm.name}: Cổng đã mở` : `${realm.name}: Hoàn thành mục tiêu`,
    desc: guardianDown ? 'Bước qua Cổng Cổ để tới vùng đất mới.' : 'Tiếp tục khám phá và tiến hóa.',
    progress: 1,
    target: 1,
    done: true,
  };
}
