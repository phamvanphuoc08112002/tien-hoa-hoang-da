import { skillRoot, SKILLS } from '../data/skills';
import type { SkillDef, SkillKind } from '../data/types';
import { shade } from './pixel';

const SIZE = 96;

type Painter = (g: CanvasRenderingContext2D, col: string, hi: string, dark: string, evolved: boolean) => void;

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

function canvas(): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  return { c, g };
}

function disc(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string | CanvasGradient): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
}

function glow(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, a = 0.35): void {
  const grd = g.createRadialGradient(x, y, r * 0.15, x, y, r);
  const c = color.startsWith('#') ? color : `#${color}`;
  grd.addColorStop(0, `${c}${Math.round(a * 255).toString(16).padStart(2, '0')}`);
  grd.addColorStop(1, `${c}00`);
  disc(g, x, y, r, grd);
}

function roundPoly(g: CanvasRenderingContext2D, pts: number[], fill: string | CanvasGradient, stroke?: string, sw = 2): void {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = sw;
    g.lineJoin = 'round';
    g.stroke();
  }
}

function strokeLine(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, color: string): void {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

function plate(g: CanvasRenderingContext2D, col: string, evolved: boolean): void {
  // soft drop shadow
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = 10;
  g.shadowOffsetY = 3;
  const bg = g.createRadialGradient(38, 34, 8, 48, 48, 44);
  bg.addColorStop(0, shade(col, 0.15));
  bg.addColorStop(0.55, shade(col, -0.25));
  bg.addColorStop(1, shade(col, -0.55));
  disc(g, 48, 48, 40, bg);
  g.restore();

  // rim
  g.beginPath();
  g.arc(48, 48, 40, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(255,255,255,0.28)';
  g.lineWidth = 3;
  g.stroke();
  g.beginPath();
  g.arc(48, 48, 40, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1.5;
  g.stroke();

  // gloss
  const gloss = g.createLinearGradient(48, 10, 48, 48);
  gloss.addColorStop(0, 'rgba(255,255,255,0.35)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  g.beginPath();
  g.ellipse(48, 28, 28, 16, 0, 0, Math.PI * 2);
  g.fillStyle = gloss;
  g.fill();

  if (evolved) {
    for (const [x, y] of [
      [18, 18],
      [78, 18],
      [18, 78],
      [78, 78],
    ] as const) {
      disc(g, x, y, 4, '#ffe48a');
      disc(g, x - 1, y - 1, 1.6, '#fff6d0');
    }
  }
}

function render(paint: Painter, color: number, evolved: boolean): HTMLCanvasElement {
  const col = hex(color);
  const hi = shade(col, 0.5);
  const dark = shade(col, -0.4);
  const { c, g } = canvas();
  plate(g, col, evolved);
  g.save();
  paint(g, col, hi, dark, evolved);
  g.restore();
  return c;
}

const KIND_FALLBACK: Record<SkillKind, Painter> = {
  dash: (g, c, hi, d) => {
    glow(g, 52, 48, 28, c, 0.25);
    roundPoly(g, [14, 48, 48, 22, 48, 36, 82, 36, 82, 60, 48, 60, 48, 74], c, d, 2);
    roundPoly(g, [22, 48, 48, 30, 48, 40, 74, 40, 74, 56, 48, 56, 48, 66], hi);
  },
  projectile: (g, c, hi, d) => {
    glow(g, 58, 48, 26, c, 0.3);
    roundPoly(g, [16, 48, 44, 32, 44, 64], d);
    disc(g, 62, 48, 18, c);
    disc(g, 56, 42, 8, hi);
    disc(g, 68, 52, 4, d);
  },
  cone: (g, c, hi, d) => {
    glow(g, 56, 48, 28, c, 0.25);
    roundPoly(g, [18, 48, 78, 18, 78, 78], c, d, 2);
    roundPoly(g, [30, 48, 72, 28, 72, 68], hi);
  },
  nova: (g, c, hi, d) => {
    glow(g, 48, 48, 36, c, 0.4);
    disc(g, 48, 48, 12, hi);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      strokeLine(g, 48 + Math.cos(a) * 14, 48 + Math.sin(a) * 14, 48 + Math.cos(a) * 34, 48 + Math.sin(a) * 34, i % 2 ? 5 : 3.5, i % 2 ? c : d);
    }
    disc(g, 48, 48, 7, '#fff8e0');
  },
  buff: (g, c, hi, d) => {
    glow(g, 48, 48, 30, c, 0.28);
    roundPoly(g, [48, 14, 74, 28, 74, 58, 48, 78, 22, 58, 22, 28], c, d, 2.5);
    roundPoly(g, [48, 24, 64, 34, 64, 54, 48, 68, 32, 54, 32, 34], hi);
    strokeLine(g, 48, 34, 48, 58, 5, d);
    strokeLine(g, 36, 46, 60, 46, 5, d);
  },
};

const THEMES: Record<string, Painter> = {
  huc_sung: (g, c, hi, d, e) => {
    glow(g, 48, 44, 28, c, 0.3);
    roundPoly(g, [20, 68, 48, 14, 76, 68], c, d, 2);
    roundPoly(g, [30, 62, 48, 26, 66, 62], hi);
    strokeLine(g, 48, 58, 48, 78, 8, d);
    if (e) strokeLine(g, 28, 44, 68, 44, 3, hi);
  },
  giap_reu: (g, c, hi, d) => {
    KIND_FALLBACK.buff(g, c, hi, d, false);
    strokeLine(g, 34, 40, 48, 28, 3, '#5fae4a');
    strokeLine(g, 48, 28, 62, 42, 3, '#5fae4a');
    disc(g, 40, 50, 3, d);
    disc(g, 56, 56, 3, d);
  },
  day_leo: (g, c, hi, d) => {
    glow(g, 48, 48, 28, c, 0.25);
    strokeLine(g, 20, 74, 36, 48, 7, c);
    strokeLine(g, 36, 48, 58, 36, 7, hi);
    strokeLine(g, 58, 36, 76, 20, 7, c);
    disc(g, 76, 20, 7, d);
    disc(g, 76, 18, 3, hi);
    disc(g, 32, 58, 4, hi);
  },
  dia_chan: (g, c, hi, d) => {
    glow(g, 48, 52, 28, c, 0.3);
    disc(g, 48, 70, 22, d);
    disc(g, 48, 68, 16, shade(d, 0.15));
    roundPoly(g, [22, 62, 48, 18, 74, 62], c, d, 2);
    roundPoly(g, [32, 58, 48, 28, 64, 58], hi);
  },
  co_thu_phan: KIND_FALLBACK.nova,
  vo_moi: (g, c, hi, d) => {
    glow(g, 48, 50, 28, c, 0.28);
    disc(g, 48, 54, 22, c);
    disc(g, 48, 48, 14, hi);
    strokeLine(g, 48, 18, 48, 40, 6, d);
    strokeLine(g, 34, 28, 48, 18, 4, d);
    strokeLine(g, 62, 28, 48, 18, 4, d);
  },
  cuong_no: (g, c, hi, d) => {
    glow(g, 48, 50, 30, c, 0.35);
    disc(g, 48, 54, 22, c);
    roundPoly(g, [32, 42, 48, 18, 64, 42], hi, d, 2);
    disc(g, 38, 52, 3.5, d);
    disc(g, 58, 52, 3.5, d);
    strokeLine(g, 38, 66, 58, 66, 4, d);
  },
  hoa_cau: (g, c, hi, d) => {
    glow(g, 56, 46, 30, c, 0.4);
    roundPoly(g, [18, 62, 36, 28, 32, 68], d);
    const flame = g.createRadialGradient(58, 44, 4, 58, 46, 22);
    flame.addColorStop(0, '#fff0a0');
    flame.addColorStop(0.35, hi);
    flame.addColorStop(1, c);
    disc(g, 58, 46, 20, flame);
    disc(g, 52, 40, 8, '#fff6c8');
  },
  hoi_lua: (g, c, hi, d) => {
    glow(g, 48, 48, 32, c, 0.4);
    roundPoly(g, [48, 12, 66, 44, 56, 44, 72, 78, 48, 58, 24, 78, 40, 44, 30, 44], c, d, 2);
    roundPoly(g, [48, 26, 58, 46, 48, 62, 38, 46], hi);
  },
  vong_lua: KIND_FALLBACK.nova,
  phun_nuoc: (g, c, hi, d) => {
    glow(g, 56, 44, 28, c, 0.35);
    roundPoly(g, [16, 70, 32, 34, 42, 60], d);
    disc(g, 60, 42, 18, c);
    disc(g, 54, 36, 8, hi);
    strokeLine(g, 28, 66, 46, 76, 4, c);
    strokeLine(g, 34, 70, 52, 78, 3, hi);
  },
  mang_bot: (g, c, hi, d) => {
    KIND_FALLBACK.buff(g, c, hi, d, false);
    disc(g, 38, 42, 6, 'rgba(232,246,255,0.9)');
    disc(g, 56, 52, 7, 'rgba(232,246,255,0.75)');
    disc(g, 48, 62, 4, 'rgba(255,255,255,0.85)');
  },
  bang_cham: (g, c, hi, d) => {
    glow(g, 48, 48, 30, c, 0.35);
    roundPoly(g, [48, 12, 58, 40, 82, 48, 58, 56, 48, 84, 38, 56, 14, 48, 38, 40], c, d, 2);
    roundPoly(g, [48, 24, 54, 44, 70, 48, 54, 52, 48, 72, 42, 52, 26, 48, 42, 44], hi);
    disc(g, 48, 48, 6, '#e8f6ff');
  },
  song_trao: (g, c, hi, d) => {
    glow(g, 48, 52, 28, c, 0.3);
    disc(g, 48, 70, 20, d);
    strokeLine(g, 16, 56, 36, 36, 8, c);
    strokeLine(g, 36, 36, 56, 54, 8, hi);
    strokeLine(g, 56, 54, 80, 28, 8, c);
  },
  xoay_nuoc: KIND_FALLBACK.nova,
  gio_chem: (g, c, hi, d) => {
    glow(g, 48, 44, 28, c, 0.28);
    roundPoly(g, [14, 30, 70, 18, 82, 30, 70, 42, 14, 54], c, d, 2);
    roundPoly(g, [22, 34, 66, 26, 74, 32, 66, 38, 22, 48], hi);
    strokeLine(g, 26, 64, 70, 76, 5, d);
  },
  long_vu: (g, c, hi, d) => {
    KIND_FALLBACK.buff(g, c, hi, d, false);
    strokeLine(g, 48, 26, 48, 68, 3, d);
    strokeLine(g, 32, 42, 64, 42, 3, d);
    strokeLine(g, 34, 54, 62, 54, 2.5, shade(d, 0.2));
  },
  bao_xoay: (g, c, hi, d) => {
    glow(g, 48, 48, 34, c, 0.35);
    g.beginPath();
    g.arc(48, 48, 28, 0, Math.PI * 1.6);
    g.strokeStyle = c;
    g.lineWidth = 10;
    g.lineCap = 'round';
    g.stroke();
    g.beginPath();
    g.arc(48, 48, 16, Math.PI * 0.3, Math.PI * 1.9);
    g.strokeStyle = hi;
    g.lineWidth = 7;
    g.stroke();
    disc(g, 48, 48, 7, d);
  },
  loc_xoay: (g, c, hi, d) => {
    glow(g, 48, 48, 30, c, 0.3);
    roundPoly(g, [48, 12, 64, 40, 78, 78, 48, 62, 18, 78, 32, 40], c, d, 2);
    roundPoly(g, [48, 24, 58, 44, 66, 70, 48, 58, 30, 70, 38, 44], hi);
    disc(g, 48, 78, 14, d);
  },
  bao_to: KIND_FALLBACK.nova,
  set_kich: (g, c, hi, d) => {
    glow(g, 48, 48, 32, c, 0.4);
    roundPoly(g, [54, 10, 30, 48, 46, 48, 36, 86, 70, 42, 52, 42], c, d, 2);
    roundPoly(g, [52, 20, 38, 46, 50, 46, 44, 72, 62, 42, 52, 42], hi);
  },
  nap_dien: (g, c, hi, d) => {
    glow(g, 48, 48, 32, c, 0.35);
    disc(g, 48, 48, 26, c);
    disc(g, 48, 48, 18, hi);
    roundPoly(g, [48, 24, 40, 48, 48, 48, 44, 72, 60, 44, 52, 44], d);
    strokeLine(g, 20, 30, 30, 24, 3, hi);
    strokeLine(g, 68, 66, 78, 60, 3, hi);
  },
  tia_set: (g, c, hi, d) => {
    glow(g, 48, 52, 28, c, 0.35);
    strokeLine(g, 16, 24, 42, 48, 7, c);
    strokeLine(g, 42, 48, 32, 62, 7, hi);
    strokeLine(g, 32, 62, 76, 74, 7, c);
    disc(g, 76, 74, 8, d);
    disc(g, 74, 72, 3, hi);
  },
  sam_set: (g, c, hi, d) => {
    glow(g, 48, 52, 30, c, 0.35);
    disc(g, 36, 30, 16, shade(d, 0.15));
    disc(g, 58, 34, 18, d);
    disc(g, 50, 28, 10, shade(d, 0.35));
    roundPoly(g, [48, 44, 36, 74, 50, 64, 56, 84, 68, 56], c, hi, 2);
  },
  thien_loi: KIND_FALLBACK.nova,
  dam_dat: (g, c, hi, d) => {
    glow(g, 48, 52, 28, c, 0.28);
    disc(g, 48, 74, 20, d);
    roundPoly(g, [34, 24, 62, 24, 62, 66, 34, 66], c, d, 2);
    roundPoly(g, [30, 18, 66, 18, 66, 30, 30, 30], hi, d, 2);
  },
  giap_da: (g, c, hi, d) => {
    KIND_FALLBACK.buff(g, c, hi, d, false);
    roundPoly(g, [36, 40, 60, 40, 56, 56, 40, 56], d);
  },
  nem_da: (g, c, hi, d) => {
    glow(g, 48, 48, 28, c, 0.28);
    roundPoly(g, [48, 22, 70, 40, 64, 68, 32, 68, 26, 40], c, d, 2.5);
    roundPoly(g, [48, 30, 60, 42, 56, 60, 40, 60, 36, 42], hi);
    strokeLine(g, 16, 74, 30, 64, 4, d);
  },
  nut_dat: (g, c, hi, d) => {
    glow(g, 48, 52, 28, c, 0.28);
    disc(g, 48, 74, 18, d);
    strokeLine(g, 16, 70, 40, 34, 8, c);
    strokeLine(g, 40, 34, 56, 58, 8, hi);
    strokeLine(g, 56, 58, 80, 24, 8, c);
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
  if (!sk) return render(KIND_FALLBACK.buff, 0x8899aa, false);
  const root = skillRoot(skillId);
  const evolved = root !== skillId;
  const paint = THEMES[root] ?? KIND_FALLBACK[sk.kind];
  return render(paint, sk.color, evolved);
}

export function basicAttackIconArt(color = 0xff8a6a): HTMLCanvasElement {
  return render((g, c, hi, d) => {
    glow(g, 48, 48, 30, c, 0.3);
    strokeLine(g, 22, 70, 40, 24, 8, c);
    strokeLine(g, 36, 74, 56, 22, 8, hi);
    strokeLine(g, 50, 74, 74, 28, 8, c);
    strokeLine(g, 26, 64, 36, 34, 3, d);
  }, color, false);
}

export function dodgeIconArt(): HTMLCanvasElement {
  return render((g, c, hi, d) => {
    glow(g, 48, 50, 28, c, 0.3);
    disc(g, 48, 54, 18, c);
    strokeLine(g, 24, 36, 48, 18, 5, hi);
    strokeLine(g, 48, 18, 72, 36, 5, hi);
    disc(g, 40, 50, 3, d);
    disc(g, 56, 50, 3, d);
  }, 0x7ab0ff, false);
}

export function restIconArt(awake: boolean): HTMLCanvasElement {
  return render((g, c, hi, d) => {
    glow(g, 48, 52, 28, c, 0.28);
    disc(g, 48, 60, 18, c);
    if (awake) {
      roundPoly(g, [30, 36, 66, 36, 66, 52, 30, 52], hi, d, 2);
      strokeLine(g, 26, 32, 70, 32, 4, d);
    } else {
      strokeLine(g, 62, 20, 78, 20, 3, hi);
      strokeLine(g, 66, 28, 78, 28, 2.5, hi);
      strokeLine(g, 36, 52, 60, 52, 5, d);
    }
  }, awake ? 0x8fd16a : 0xffd84a, false);
}

const urlCache = new Map<string, string>();

export function skillIconUrl(skillId: string): string {
  const key = `sk2:${skillId}`;
  let u = urlCache.get(key);
  if (!u) {
    u = skillIconArt(skillId).toDataURL('image/png');
    urlCache.set(key, u);
  }
  return u;
}

export function basicAttackIconUrl(color = 0xff8a6a): string {
  const key = `atk2:${color}`;
  let u = urlCache.get(key);
  if (!u) {
    u = basicAttackIconArt(color).toDataURL('image/png');
    urlCache.set(key, u);
  }
  return u;
}

export function dodgeIconUrl(): string {
  let u = urlCache.get('dodge2');
  if (!u) {
    u = dodgeIconArt().toDataURL('image/png');
    urlCache.set('dodge2', u);
  }
  return u;
}

export function restIconUrl(awake: boolean): string {
  const key = awake ? 'rest2:awake' : 'rest2:up';
  let u = urlCache.get(key);
  if (!u) {
    u = restIconArt(awake).toDataURL('image/png');
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
