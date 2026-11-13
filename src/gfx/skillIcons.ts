import { skillRoot, SKILLS } from '../data/skills';
import type { SkillDef, SkillKind } from '../data/types';
import { ellipse, line, makeCanvas, pixelize, poly, rect, shade, upscale } from './pixel';

type Painter = (g: CanvasRenderingContext2D, col: string, hi: string, dark: string, evolved: boolean) => void;

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

function sprite(paint: Painter, color: number, evolved: boolean): HTMLCanvasElement {
  const col = hex(color);
  const hi = shade(col, 0.45);
  const dark = shade(col, -0.45);
  const { c, g } = makeCanvas(16, 16);
  // soft plate behind the glyph
  ellipse(g, 8, 8, 7.2, 7.2, shade(col, -0.55));
  ellipse(g, 8, 8, 6.2, 6.2, shade(col, -0.25));
  paint(g, col, hi, dark, evolved);
  if (evolved) {
    rect(g, 1, 1, 2, 1, '#ffe48a');
    rect(g, 13, 1, 2, 1, '#ffe48a');
    rect(g, 1, 14, 2, 1, '#ffe48a');
    rect(g, 13, 14, 2, 1, '#ffe48a');
  }
  pixelize(c, [{ x: 0, y: 0, w: 16, h: 16 }], null, '#1a1814');
  return upscale(c);
}

const KIND_FALLBACK: Record<SkillKind, Painter> = {
  dash: (g, c, hi, d) => {
    poly(g, [2, 8, 9, 3, 9, 6, 14, 6, 14, 10, 9, 10, 9, 13], c);
    poly(g, [3, 8, 9, 4.5, 9, 7, 13, 7, 13, 9, 9, 9, 9, 11.5], hi);
    line(g, 2, 8, 8, 8, 1, d);
  },
  projectile: (g, c, hi, d) => {
    ellipse(g, 10, 8, 4, 4, c);
    ellipse(g, 9, 7, 2, 2, hi);
    poly(g, [2, 8, 7, 5, 7, 11], d);
    poly(g, [3, 8, 7, 6, 7, 10], c);
  },
  cone: (g, c, hi, d) => {
    poly(g, [3, 8, 14, 2, 14, 14], c);
    poly(g, [5, 8, 13, 4, 13, 12], hi);
    rect(g, 2, 7, 2, 2, d);
  },
  nova: (g, c, hi, d) => {
    ellipse(g, 8, 8, 3.2, 3.2, hi);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      line(g, 8 + Math.cos(a) * 3, 8 + Math.sin(a) * 3, 8 + Math.cos(a) * 7, 8 + Math.sin(a) * 7, 1.4, i % 2 ? c : d);
    }
  },
  buff: (g, c, hi, d) => {
    poly(g, [8, 2, 13, 5, 13, 10, 8, 14, 3, 10, 3, 5], c);
    poly(g, [8, 4, 11, 6, 11, 9.5, 8, 12, 5, 9.5, 5, 6], hi);
    rect(g, 7, 6, 2, 5, d);
    rect(g, 5.5, 7.5, 5, 2, d);
  },
};

/** Theme glyph by skill-line root id. */
const THEMES: Record<string, Painter> = {
  huc_sung: (g, c, hi, d, e) => {
    poly(g, [3, 11, 8, 2, 13, 11], c);
    poly(g, [5, 10, 8, 4, 11, 10], hi);
    rect(g, 7, 10, 2, 4, d);
    if (e) line(g, 4, 7, 12, 7, 1, hi);
  },
  giap_reu: (g, c, hi, d) => {
    poly(g, [8, 2, 13, 5, 13, 10, 8, 14, 3, 10, 3, 5], c);
    ellipse(g, 8, 8, 3, 3, hi);
    rect(g, 6, 5, 1, 1, d);
    rect(g, 10, 9, 1, 1, d);
    line(g, 5, 7, 8, 4, 1, '#3f8a37');
  },
  day_leo: (g, c, hi, d) => {
    line(g, 3, 13, 6, 8, 2, c);
    line(g, 6, 8, 10, 6, 2, hi);
    line(g, 10, 6, 13, 3, 2, c);
    ellipse(g, 13, 3, 2, 2, d);
    ellipse(g, 5, 10, 1.5, 1.5, hi);
  },
  dia_chan: (g, c, hi, d) => {
    ellipse(g, 8, 11, 6, 2.5, d);
    poly(g, [3, 10, 8, 3, 13, 10], c);
    poly(g, [5, 10, 8, 5, 11, 10], hi);
  },
  co_thu_phan: KIND_FALLBACK.nova,
  vo_moi: (g, c, hi, d) => {
    ellipse(g, 8, 9, 5.5, 5, c);
    ellipse(g, 8, 8, 3.5, 3, hi);
    rect(g, 7, 3, 2, 4, d);
    line(g, 5, 5, 7, 3, 1, d);
    line(g, 11, 5, 9, 3, 1, d);
  },
  cuong_no: (g, c, hi, d) => {
    ellipse(g, 8, 9, 5, 5, c);
    poly(g, [5, 7, 8, 3, 11, 7], hi);
    rect(g, 6, 8, 1, 2, d);
    rect(g, 9, 8, 1, 2, d);
    line(g, 6, 12, 10, 12, 1.5, d);
  },
  hoa_cau: (g, c, hi, d) => {
    ellipse(g, 9, 8, 4.5, 4.5, c);
    ellipse(g, 8, 7, 2.5, 2.5, hi);
    poly(g, [3, 10, 6, 5, 5, 11], d);
    rect(g, 8, 5, 1, 1, '#fff0a0');
  },
  hoi_lua: (g, c, hi, d) => {
    poly(g, [8, 2, 12, 8, 10, 8, 13, 14, 8, 10, 3, 14, 6, 8, 4, 8], c);
    poly(g, [8, 5, 10, 8, 8, 11, 6, 8], hi);
    rect(g, 7, 7, 2, 2, d);
  },
  vong_lua: KIND_FALLBACK.nova,
  phun_nuoc: (g, c, hi, d) => {
    ellipse(g, 10, 7, 3.5, 3.5, c);
    ellipse(g, 9, 6, 1.8, 1.8, hi);
    poly(g, [2, 12, 5, 6, 7, 10], d);
    line(g, 4, 11, 8, 13, 1.2, c);
  },
  mang_bot: (g, c, hi, d) => {
    poly(g, [8, 2, 13, 5, 13, 10, 8, 14, 3, 10, 3, 5], c);
    ellipse(g, 6, 7, 1.6, 1.6, hi);
    ellipse(g, 10, 9, 1.8, 1.8, hi);
    ellipse(g, 8, 11, 1.4, 1.4, '#e8f6ff');
    line(g, 5, 8, 11, 8, 1, d);
  },
  bang_cham: (g, c, hi, d) => {
    poly(g, [8, 2, 10, 7, 14, 8, 10, 9, 8, 14, 6, 9, 2, 8, 6, 7], c);
    poly(g, [8, 4, 9, 7.5, 12, 8, 9, 8.5, 8, 12, 7, 8.5, 4, 8, 7, 7.5], hi);
    rect(g, 7, 7, 2, 2, d);
  },
  song_trao: (g, c, hi, d) => {
    ellipse(g, 8, 11, 6, 2.2, d);
    line(g, 2, 9, 6, 6, 2, c);
    line(g, 6, 6, 10, 9, 2, hi);
    line(g, 10, 9, 14, 5, 2, c);
  },
  xoay_nuoc: KIND_FALLBACK.nova,
  gio_chem: (g, c, hi, d) => {
    poly(g, [2, 5, 12, 3, 14, 5, 12, 7, 2, 9], c);
    poly(g, [3, 6, 11, 4.5, 12, 5.5, 11, 6.5, 3, 8], hi);
    line(g, 4, 11, 12, 13, 1.5, d);
  },
  long_vu: (g, c, hi, d) => {
    poly(g, [8, 2, 13, 5, 13, 10, 8, 14, 3, 10, 3, 5], c);
    poly(g, [8, 4, 11, 6, 11, 9, 8, 11, 5, 9, 5, 6], hi);
    line(g, 8, 4, 8, 12, 1, d);
    line(g, 5, 7, 11, 7, 1, d);
  },
  bao_xoay: (g, c, hi, d) => {
    ellipse(g, 8, 8, 5.5, 5.5, c);
    ellipse(g, 8, 8, 3.2, 3.2, hi);
    ellipse(g, 8, 8, 1.4, 1.4, d);
    line(g, 8, 2, 10, 6, 1.2, hi);
    line(g, 14, 8, 10, 10, 1.2, hi);
  },
  loc_xoay: (g, c, hi, d) => {
    poly(g, [8, 2, 11, 7, 14, 14, 8, 11, 2, 14, 5, 7], c);
    poly(g, [8, 4, 10, 8, 11, 12, 8, 10, 5, 12, 6, 8], hi);
    ellipse(g, 8, 13, 4, 1.5, d);
  },
  bao_to: KIND_FALLBACK.nova,
  set_kich: (g, c, hi, d) => {
    poly(g, [9, 1, 5, 8, 8, 8, 6, 15, 12, 7, 9, 7], c);
    poly(g, [9, 3, 7, 7, 9, 7, 8, 12, 11, 7.5, 9, 7.5], hi);
    rect(g, 8, 6, 1, 1, d);
  },
  nap_dien: (g, c, hi, d) => {
    ellipse(g, 8, 8, 5.5, 5.5, c);
    poly(g, [8, 3, 6, 8, 8, 8, 7, 13, 11, 7, 9, 7], hi);
    line(g, 3, 5, 5, 4, 1, d);
    line(g, 12, 11, 14, 10, 1, d);
  },
  tia_set: (g, c, hi, d) => {
    line(g, 2, 4, 7, 8, 2, c);
    line(g, 7, 8, 5, 11, 2, hi);
    line(g, 5, 11, 13, 13, 2, c);
    ellipse(g, 13, 13, 2, 2, d);
  },
  sam_set: (g, c, hi, d) => {
    ellipse(g, 6, 5, 4, 3, d);
    ellipse(g, 10, 6, 4.5, 3.2, shade(d, 0.2));
    poly(g, [8, 8, 6, 13, 9, 11, 10, 15, 12, 10], c);
    poly(g, [9, 9, 8, 12, 10, 11, 10.5, 13, 11, 10], hi);
  },
  thien_loi: KIND_FALLBACK.nova,
  dam_dat: (g, c, hi, d) => {
    ellipse(g, 8, 12, 6, 2, d);
    rect(g, 6, 4, 4, 8, c);
    rect(g, 5, 3, 6, 2, hi);
    rect(g, 7, 6, 2, 3, shade(c, -0.2));
  },
  giap_da: (g, c, hi, d) => {
    poly(g, [8, 2, 13, 5, 13, 10, 8, 14, 3, 10, 3, 5], c);
    poly(g, [8, 4, 11, 6, 11, 9.5, 8, 12, 5, 9.5, 5, 6], hi);
    rect(g, 6, 7, 4, 2, d);
  },
  nem_da: (g, c, hi, d) => {
    poly(g, [8, 4, 12, 7, 11, 12, 5, 12, 4, 7], c);
    poly(g, [8, 5, 10, 7, 9.5, 10, 6.5, 10, 6, 7], hi);
    line(g, 2, 13, 5, 11, 1.5, d);
  },
  nut_dat: (g, c, hi, d) => {
    line(g, 2, 12, 7, 6, 2, c);
    line(g, 7, 6, 10, 10, 2, hi);
    line(g, 10, 10, 14, 4, 2, c);
    ellipse(g, 8, 13, 5, 1.8, d);
  },
  son_nham: KIND_FALLBACK.nova,
  thien_moc: KIND_FALLBACK.nova,
  moc_than_phan: KIND_FALLBACK.nova,
  diem_bao: KIND_FALLBACK.nova,
  hoa_long_diet: KIND_FALLBACK.nova,
  hai_long_bao: KIND_FALLBACK.nova,
  thuy_than_phan: KIND_FALLBACK.nova,
  cuong_phong: KIND_FALLBACK.nova,
  thien_phong_de: KIND_FALLBACK.nova,
  loi_long_noi: KIND_FALLBACK.nova,
  thien_loi_diet: KIND_FALLBACK.nova,
  dia_long_chan: KIND_FALLBACK.nova,
  dia_than_phan: KIND_FALLBACK.nova,
};

export function skillIconArt(skillId: string): HTMLCanvasElement {
  const sk = SKILLS[skillId];
  if (!sk) return sprite(KIND_FALLBACK.buff, 0x8899aa, false);
  const root = skillRoot(skillId);
  const evolved = root !== skillId;
  const paint = THEMES[root] ?? KIND_FALLBACK[sk.kind];
  return sprite(paint, sk.color, evolved);
}

/** Generic claw slash for the basic attack button. */
export function basicAttackIconArt(color = 0xff8a6a): HTMLCanvasElement {
  return sprite((g, c, hi, d) => {
    line(g, 3, 12, 7, 4, 2.2, c);
    line(g, 6, 13, 10, 4, 2.2, hi);
    line(g, 9, 13, 13, 5, 2.2, c);
    line(g, 4, 11, 6, 6, 1, d);
  }, color, false);
}

export function dodgeIconArt(): HTMLCanvasElement {
  return sprite((g, c, hi, d) => {
    ellipse(g, 8, 9, 5, 4, c);
    line(g, 3, 6, 8, 3, 1.6, hi);
    line(g, 8, 3, 13, 6, 1.6, hi);
    rect(g, 6, 8, 1, 2, d);
    rect(g, 9, 8, 1, 2, d);
  }, 0x7ab0ff, false);
}

export function restIconArt(awake: boolean): HTMLCanvasElement {
  return sprite((g, c, hi, d) => {
    if (awake) {
      ellipse(g, 8, 10, 5, 3.5, c);
      rect(g, 5, 6, 6, 3, hi);
      line(g, 4, 5, 12, 5, 1.5, d);
    } else {
      ellipse(g, 8, 10, 5, 3.5, c);
      line(g, 11, 3, 14, 3, 1.2, hi);
      line(g, 12, 5, 14, 5, 1, hi);
      rect(g, 6, 8, 4, 2, d);
    }
  }, awake ? 0x8fd16a : 0xffd84a, false);
}

const urlCache = new Map<string, string>();

export function skillIconUrl(skillId: string): string {
  const key = `sk:${skillId}`;
  let u = urlCache.get(key);
  if (!u) {
    u = skillIconArt(skillId).toDataURL();
    urlCache.set(key, u);
  }
  return u;
}

export function basicAttackIconUrl(color = 0xff8a6a): string {
  const key = `atk:${color}`;
  let u = urlCache.get(key);
  if (!u) {
    u = basicAttackIconArt(color).toDataURL();
    urlCache.set(key, u);
  }
  return u;
}

export function dodgeIconUrl(): string {
  let u = urlCache.get('dodge');
  if (!u) {
    u = dodgeIconArt().toDataURL();
    urlCache.set('dodge', u);
  }
  return u;
}

export function restIconUrl(awake: boolean): string {
  const key = awake ? 'rest:awake' : 'rest:up';
  let u = urlCache.get(key);
  if (!u) {
    u = restIconArt(awake).toDataURL();
    urlCache.set(key, u);
  }
  return u;
}

export function skillKindLabel(kind: SkillKind): string {
  return (
    {
      dash: 'Xung kích',
      projectile: 'Đạn chiêu',
      cone: 'Quạt rộng',
      nova: 'Nổ vòng',
      buff: 'Tăng cường',
    } as const
  )[kind];
}

export function formatSkillTip(sk: SkillDef): { title: string; body: string; meta: string; icon: string } {
  const bits: string[] = [];
  bits.push(skillKindLabel(sk.kind));
  bits.push(`Hồi ${sk.cooldownSec}s`);
  bits.push(`${sk.stamina} thể lực`);
  if (sk.dmgMult > 0) bits.push(`x${sk.dmgMult.toFixed(1)} sát thương`);
  if (sk.durationSec) bits.push(`${sk.durationSec}s hiệu lực`);
  if (sk.status) {
    const n = ({ burn: 'Bỏng', poison: 'Độc', slow: 'Chậm', stun: 'Choáng' } as const)[sk.status.kind];
    bits.push(`${n} ${sk.status.sec}s`);
  }
  return {
    title: sk.name,
    body: sk.desc,
    meta: bits.join(' · '),
    icon: skillIconUrl(sk.id),
  };
}
