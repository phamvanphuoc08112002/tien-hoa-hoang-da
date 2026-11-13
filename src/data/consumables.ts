import type { BuffDef, StatusKind } from './types';

export type ConsumableUse = 'antidote' | 'salve' | 'tonic' | 'bait' | 'ration';

export interface ConsumableDef {
  id: string;
  name: string;
  desc: string;
  cost: number;
  /** Short label on bag slot. */
  icon: string;
  use: ConsumableUse;
  /** Clear these statuses (antidote/salve). */
  clear?: StatusKind[];
  durationSec?: number;
  buff?: BuffDef;
  /** Flat heal for ration. */
  heal?: number;
  hunger?: number;
  color: number;
}

export const CONSUMABLES: Record<string, ConsumableDef> = {
  binh_giai_doc: {
    id: 'binh_giai_doc',
    name: 'Thuốc Giải Độc',
    desc: 'Xóa độc đang hành hạ cơ thể.',
    cost: 6,
    icon: '🧪',
    use: 'antidote',
    clear: ['poison'],
    color: 0x9ae06a,
  },
  cao_lam_lanh: {
    id: 'cao_lam_lanh',
    name: 'Cao Làm Lành',
    desc: 'Dập tắt bỏng và làm dịu cơ thể.',
    cost: 6,
    icon: '🧴',
    use: 'salve',
    clear: ['burn'],
    color: 0x7ad0ff,
  },
  tonic_suc_manh: {
    id: 'tonic_suc_manh',
    name: 'Tonic Sức Mạnh',
    desc: '+35% sát thương trong 12 giây.',
    cost: 12,
    icon: '💪',
    use: 'tonic',
    durationSec: 12,
    buff: { powerMult: 1.35 },
    color: 0xff8a4a,
  },
  tonic_giap: {
    id: 'tonic_giap',
    name: 'Tonic Giáp',
    desc: '+60% phòng thủ trong 12 giây.',
    cost: 12,
    icon: '🛡️',
    use: 'tonic',
    durationSec: 12,
    buff: { defenseMult: 1.6 },
    color: 0xc0d0e8,
  },
  moi_thit: {
    id: 'moi_thit',
    name: 'Mồi Thịt',
    desc: 'Ném mồi — thú săn gần đó bị dụ trong vài giây.',
    cost: 8,
    icon: '🥩',
    use: 'bait',
    durationSec: 10,
    color: 0xc04040,
  },
  banh_phuc_hoi: {
    id: 'banh_phuc_hoi',
    name: 'Bánh Phục Hồi',
    desc: 'Hồi 40 máu và +20 độ no (mọi khẩu vị).',
    cost: 10,
    icon: '🍪',
    use: 'ration',
    heal: 40,
    hunger: 20,
    color: 0xffd84a,
  },
};

export const CONSUMABLE_LIST = Object.values(CONSUMABLES);

export function isConsumable(id: string): boolean {
  return !!CONSUMABLES[id];
}

export function itemName(id: string): string {
  return CONSUMABLES[id]?.name ?? id;
}
