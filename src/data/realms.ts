/** Terrain knobs for world generation. Realm 0 uses the original values so existing seeds are unchanged. */
export interface RealmGen {
  /** Share of grassland kept as grass; lower turns more of it into forest. */
  forestQuantile: number;
  /** Swamp radius as a fraction of map width. */
  swampFrac: number;
  /** Added to rockiness everywhere: positive grows the rocky region and plateau. */
  rockBias: number;
  /** Multiplier on the central lake radius. */
  lakeMult: number;
  /** Spawn keeps at least `swampR * swampAvoid + swampPad` tiles from the swamp centre. */
  swampAvoid: number;
  swampPad: number;
}

/** Difficulty multipliers applied on top of the normal distance/day scaling. */
export interface RealmScaling {
  hp: number;
  power: number;
  defense: number;
  level: number;
  exp: number;
  eliteChance: number;
}

export interface RealmDef {
  id: string;
  name: string;
  desc: string;
  /** Ambient light multiplier colour (white = unchanged). */
  tint: number;
  gen: RealmGen;
  scaling: RealmScaling;
  /** NPC id of the gate guardian summoned at this realm's portal. */
  guardian: string;
  /** Coins awarded for defeating the guardian. */
  guardianCoins: number;
}

const BASE_GEN: RealmGen = { forestQuantile: 0.6, swampFrac: 0.2, rockBias: 0, lakeMult: 1, swampAvoid: 1, swampPad: 25 };

export const REALMS: RealmDef[] = [
  {
    id: 'khoi_nguyen',
    name: 'Thung Lũng Khởi Nguyên',
    desc: 'Vùng đất nơi mọi sinh vật bắt đầu hành trình.',
    tint: 0xffffff,
    gen: BASE_GEN,
    scaling: { hp: 1, power: 1, defense: 1, level: 0, exp: 1, eliteChance: 0 },
    guardian: 'moc_than',
    guardianCoins: 25,
  },
  {
    id: 'suong_mu',
    name: 'Rừng Sương Mù',
    desc: 'Rừng già phủ sương quanh năm, kẻ săn mồi ẩn mình khắp nơi.',
    tint: 0xd4def2,
    gen: { forestQuantile: 0.35, swampFrac: 0.16, rockBias: -0.04, lakeMult: 1.1, swampAvoid: 0.9, swampPad: 10 },
    scaling: { hp: 1.5, power: 1.3, defense: 1.2, level: 5, exp: 1.8, eliteChance: 0.04 },
    guardian: 'suong_lang_vuong',
    guardianCoins: 40,
  },
  {
    id: 'ham_lay',
    name: 'Đầm Lầy Hắc Ám',
    desc: 'Bùn lầy và nọc độc trải dài, mỗi bước đi đều nguy hiểm.',
    tint: 0xcadcb6,
    gen: { forestQuantile: 0.55, swampFrac: 0.3, rockBias: -0.06, lakeMult: 0.9, swampAvoid: 0.75, swampPad: 6 },
    scaling: { hp: 2.1, power: 1.65, defense: 1.4, level: 10, exp: 2.7, eliteChance: 0.08 },
    guardian: 'hac_ngac_chua',
    guardianCoins: 60,
  },
  {
    id: 'hoa_nguc',
    name: 'Cao Nguyên Hỏa Ngục',
    desc: 'Đá nóng rực và dung nham, chỉ kẻ mạnh nhất mới sống sót.',
    tint: 0xffd6b4,
    gen: { forestQuantile: 0.78, swampFrac: 0.12, rockBias: 0.16, lakeMult: 0.75, swampAvoid: 1, swampPad: 15 },
    scaling: { hp: 2.8, power: 2.0, defense: 1.6, level: 15, exp: 3.6, eliteChance: 0.12 },
    guardian: 'hoa_long_de',
    guardianCoins: 80,
  },
  {
    id: 'hu_khong',
    name: 'Vực Hư Không',
    desc: 'Ranh giới cuối cùng giữa các thế giới. Mọi sinh vật ở đây đều đã được tôi luyện.',
    tint: 0xccc0ec,
    gen: { forestQuantile: 0.5, swampFrac: 0.22, rockBias: 0.08, lakeMult: 1.2, swampAvoid: 0.85, swampPad: 10 },
    scaling: { hp: 3.6, power: 2.4, defense: 1.85, level: 20, exp: 4.6, eliteChance: 0.16 },
    guardian: 'hu_khong_than',
    guardianCoins: 120,
  },
];

export const LAST_REALM = REALMS.length - 1;

export function realmOf(i: number): RealmDef {
  return REALMS[Math.max(0, Math.min(LAST_REALM, Math.floor(i)))];
}

/** Each realm gets its own map; realm 0 keeps the original seed so old runs look the same. */
export function realmSeed(seed: string, realm: number): string {
  return realm <= 0 ? seed : `${seed}~${REALMS[realm].id}`;
}

/** Permanent player bonus per gate crossed. */
export const REALM_PLAYER_BONUS = { hp: 0.15, power: 0.12, defense: 0.1 };
