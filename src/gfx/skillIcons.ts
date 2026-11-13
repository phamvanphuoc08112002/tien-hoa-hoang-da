import { skillRoot, SKILLS } from '../data/skills';
import type { SkillDef, SkillKind } from '../data/types';
import { shade } from './pixel';

/** MOBA-style ability icons (Liên Quân / AOV readability at button size). */
const SIZE = 128;
const CX = 64;
const CY = 64;

type Painter = (g: CanvasRenderingContext2D, col: string, hi: string, mid: string, dark: string, evolved: boolean) => void;

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

function rgba(hexCol: string, a: number): string {
  const h = hexCol.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
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

function clipCircle(g: CanvasRenderingContext2D, r = 54): void {
  g.beginPath();
  g.arc(CX, CY, r, 0, Math.PI * 2);
  g.clip();
}

function disc(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string | CanvasGradient): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
}

function ring(g: CanvasRenderingContext2D, x: number, y: number, r: number, w: number, color: string): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.strokeStyle = color;
  g.lineWidth = w;
  g.stroke();
}

function poly(g: CanvasRenderingContext2D, pts: number[], fill: string | CanvasGradient, stroke?: string, sw = 2): void {
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
    g.lineCap = 'round';
    g.stroke();
  }
}

function stroke(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, color: string): void {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

function glowBlob(g: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, a = 0.55): void {
  const grd = g.createRadialGradient(x, y, 0, x, y, r);
  grd.addColorStop(0, rgba(col, a));
  grd.addColorStop(0.55, rgba(col, a * 0.35));
  grd.addColorStop(1, rgba(col, 0));
  disc(g, x, y, r, grd);
}

/** Dark plate + metallic rim like Liên Quân skill buttons. */
function frame(g: CanvasRenderingContext2D, col: string, evolved: boolean): void {
  // outer drop shadow
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = 14;
  g.shadowOffsetY = 4;
  disc(g, CX, CY, 58, '#0a0c10');
  g.restore();

  // metal outer rim
  const rim = g.createLinearGradient(CX, 6, CX, 122);
  if (evolved) {
    rim.addColorStop(0, '#fff3b0');
    rim.addColorStop(0.35, '#e8b84a');
    rim.addColorStop(0.7, '#a87020');
    rim.addColorStop(1, '#ffe08a');
  } else {
    rim.addColorStop(0, '#d8dee8');
    rim.addColorStop(0.35, '#8a94a8');
    rim.addColorStop(0.7, '#3a4254');
    rim.addColorStop(1, '#c0c8d8');
  }
  disc(g, CX, CY, 58, rim);

  // inner dark bevel
  disc(g, CX, CY, 52, '#12161e');
  ring(g, CX, CY, 52, 2, 'rgba(255,255,255,0.12)');

  // themed background inside clip
  g.save();
  clipCircle(g, 50);
  const bg = g.createRadialGradient(CX - 10, CY - 16, 4, CX, CY, 52);
  bg.addColorStop(0, shade(col, 0.05));
  bg.addColorStop(0.45, shade(col, -0.35));
  bg.addColorStop(1, shade(col, -0.72));
  disc(g, CX, CY, 50, bg);

  // vignette + subtle rays
  const vig = g.createRadialGradient(CX, CY, 18, CX, CY, 50);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.45)');
  disc(g, CX, CY, 50, vig);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    stroke(g, CX + Math.cos(a) * 8, CY + Math.sin(a) * 8, CX + Math.cos(a) * 48, CY + Math.sin(a) * 48, 10, rgba(col, 0.06));
  }
  g.restore();
}

function gloss(g: CanvasRenderingContext2D): void {
  g.save();
  clipCircle(g, 50);
  const top = g.createLinearGradient(CX, 14, CX, 58);
  top.addColorStop(0, 'rgba(255,255,255,0.38)');
  top.addColorStop(0.55, 'rgba(255,255,255,0.06)');
  top.addColorStop(1, 'rgba(255,255,255,0)');
  g.beginPath();
  g.ellipse(CX, 34, 36, 20, 0, 0, Math.PI * 2);
  g.fillStyle = top;
  g.fill();
  g.restore();

  // crisp inner white rim
  ring(g, CX, CY, 50.5, 1.5, 'rgba(255,255,255,0.22)');
  ring(g, CX, CY, 57.5, 1.2, 'rgba(0,0,0,0.35)');
}

function withDepth(g: CanvasRenderingContext2D, paint: () => void): void {
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.65)';
  g.shadowBlur = 8;
  g.shadowOffsetY = 3;
  paint();
  g.restore();
}

function render(paint: Painter, color: number, evolved: boolean): HTMLCanvasElement {
  const col = hex(color);
  const hi = shade(col, 0.55);
  const mid = shade(col, 0.15);
  const dark = shade(col, -0.45);
  const { c, g } = canvas();
  frame(g, col, evolved);
  g.save();
  clipCircle(g, 49);
  paint(g, col, hi, mid, dark, evolved);
  g.restore();
  gloss(g);
  return c;
}

// ----- Kind silhouettes (clear at 40–56px) -----

const KIND: Record<SkillKind, Painter> = {
  dash: (g, c, hi, mid, d) => {
    glowBlob(g, 78, 64, 36, c, 0.45);
    withDepth(g, () => {
      poly(g, [18, 64, 58, 28, 58, 48, 108, 48, 108, 80, 58, 80, 58, 100], mid, d, 3);
      poly(g, [28, 64, 58, 38, 58, 54, 96, 54, 96, 74, 58, 74, 58, 90], hi);
    });
    stroke(g, 30, 64, 70, 64, 4, 'rgba(255,255,255,0.55)');
  },
  projectile: (g, c, hi, mid, d) => {
    glowBlob(g, 78, 58, 34, c, 0.5);
    withDepth(g, () => {
      poly(g, [16, 70, 52, 42, 52, 86], d);
      poly(g, [24, 70, 50, 50, 50, 82], mid);
      disc(g, 82, 58, 26, mid);
      disc(g, 76, 50, 12, hi);
      disc(g, 90, 66, 6, d);
    });
    disc(g, 74, 48, 5, 'rgba(255,255,255,0.75)');
  },
  cone: (g, c, hi, mid, d) => {
    glowBlob(g, 78, 64, 38, c, 0.45);
    withDepth(g, () => {
      poly(g, [22, 64, 108, 22, 108, 106], mid, d, 3);
      poly(g, [36, 64, 98, 36, 98, 92], hi);
    });
    stroke(g, 40, 64, 90, 48, 3, 'rgba(255,255,255,0.4)');
    stroke(g, 40, 64, 90, 80, 3, 'rgba(255,255,255,0.25)');
  },
  nova: (g, c, hi, mid, d) => {
    glowBlob(g, CX, CY, 44, c, 0.55);
    withDepth(g, () => {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        stroke(g, CX + Math.cos(a) * 14, CY + Math.sin(a) * 14, CX + Math.cos(a) * 42, CY + Math.sin(a) * 42, i % 2 ? 7 : 4.5, i % 2 ? mid : d);
      }
      disc(g, CX, CY, 16, mid);
      disc(g, CX, CY, 9, hi);
    });
    disc(g, CX - 3, CY - 4, 4, 'rgba(255,255,255,0.85)');
  },
  buff: (g, c, hi, mid, d) => {
    glowBlob(g, CX, CY, 36, c, 0.4);
    withDepth(g, () => {
      poly(g, [64, 18, 98, 36, 98, 74, 64, 104, 30, 74, 30, 36], mid, d, 3);
      poly(g, [64, 30, 86, 42, 86, 70, 64, 90, 42, 70, 42, 42], hi);
      stroke(g, 64, 42, 64, 78, 7, d);
      stroke(g, 46, 60, 82, 60, 7, d);
      stroke(g, 64, 44, 64, 76, 3.5, hi);
      stroke(g, 48, 60, 80, 60, 3.5, hi);
    });
  },
};

// ----- Distinct skill-line art -----

const THEMES: Record<string, Painter> = {
  huc_sung: (g, c, hi, mid, d, e) => {
    glowBlob(g, 64, 58, 40, c, 0.4);
    withDepth(g, () => {
      // charging horn silhouette
      poly(g, [28, 92, 64, 18, 100, 92], mid, d, 3);
      poly(g, [40, 84, 64, 32, 88, 84], hi);
      stroke(g, 64, 78, 64, 108, 10, d);
      stroke(g, 64, 80, 64, 104, 4, hi);
    });
    if (e) {
      stroke(g, 36, 56, 92, 56, 4, rgba(hi, 0.8));
      glowBlob(g, 64, 40, 18, hi, 0.35);
    }
  },
  giap_reu: (g, c, hi, mid, d) => {
    KIND.buff(g, c, hi, mid, d, false);
    glowBlob(g, 64, 50, 22, '#7adf4a', 0.25);
    stroke(g, 44, 48, 64, 32, 4, '#5fae4a');
    stroke(g, 64, 32, 84, 50, 4, '#5fae4a');
    disc(g, 50, 66, 4, d);
    disc(g, 78, 72, 4, d);
  },
  day_leo: (g, c, hi, mid, d) => {
    glowBlob(g, 78, 40, 28, c, 0.4);
    withDepth(g, () => {
      stroke(g, 24, 100, 44, 70, 9, mid);
      stroke(g, 44, 70, 70, 48, 9, hi);
      stroke(g, 70, 48, 98, 28, 9, mid);
      disc(g, 100, 26, 12, mid);
      disc(g, 98, 22, 5, hi);
      // thorns
      stroke(g, 48, 66, 40, 54, 3, d);
      stroke(g, 66, 52, 58, 40, 3, d);
      stroke(g, 84, 38, 76, 26, 3, d);
    });
  },
  dia_chan: (g, c, hi, mid, d) => {
    glowBlob(g, 64, 70, 36, c, 0.4);
    withDepth(g, () => {
      disc(g, 64, 96, 34, d);
      disc(g, 64, 92, 24, shade(d, 0.15));
      // cracked ground burst
      for (const a of [-0.9, -0.3, 0.3, 0.9]) {
        stroke(g, 64, 78, 64 + Math.cos(a - Math.PI / 2) * 40, 78 + Math.sin(a - Math.PI / 2) * 28, 5, mid);
      }
      poly(g, [34, 78, 64, 28, 94, 78], mid, d, 3);
      poly(g, [44, 74, 64, 40, 84, 74], hi);
    });
  },
  co_thu_phan: (g, c, hi, mid, d) => {
    KIND.nova(g, c, hi, mid, d, false);
    withDepth(g, () => {
      // tree crown
      disc(g, 64, 48, 22, mid);
      disc(g, 50, 54, 14, hi);
      disc(g, 78, 54, 14, shade(mid, -0.1));
      stroke(g, 64, 58, 64, 96, 8, d);
    });
  },
  vo_moi: (g, c, hi, mid, d) => {
    glowBlob(g, 70, 58, 36, c, 0.45);
    withDepth(g, () => {
      // claw swipe
      stroke(g, 30, 90, 58, 28, 10, mid);
      stroke(g, 48, 96, 78, 26, 10, hi);
      stroke(g, 66, 96, 98, 34, 10, mid);
      stroke(g, 34, 84, 54, 40, 4, d);
    });
    glowBlob(g, 80, 36, 16, hi, 0.4);
  },
  cuong_no: (g, c, hi, mid, d) => {
    glowBlob(g, 64, 64, 40, c, 0.5);
    withDepth(g, () => {
      disc(g, 64, 70, 30, mid);
      // angry brow / fangs
      poly(g, [40, 52, 64, 28, 88, 52], hi, d, 2);
      disc(g, 50, 68, 5, d);
      disc(g, 78, 68, 5, d);
      stroke(g, 50, 86, 78, 86, 5, d);
      poly(g, [54, 86, 58, 98, 62, 86], hi);
      poly(g, [66, 86, 70, 98, 74, 86], hi);
    });
  },
  hoa_cau: (g, c, hi, mid, d) => {
    glowBlob(g, 72, 58, 42, c, 0.55);
    withDepth(g, () => {
      poly(g, [22, 82, 44, 40, 40, 92], d);
      const flame = g.createRadialGradient(74, 56, 4, 74, 58, 30);
      flame.addColorStop(0, '#fff6c0');
      flame.addColorStop(0.35, hi);
      flame.addColorStop(0.7, mid);
      flame.addColorStop(1, d);
      disc(g, 74, 58, 28, flame);
      disc(g, 66, 48, 10, '#fff8d8');
    });
  },
  hoi_lua: (g, c, hi, mid, d) => {
    glowBlob(g, 78, 64, 40, c, 0.5);
    withDepth(g, () => {
      poly(g, [20, 64, 108, 28, 108, 100], mid, d, 3);
      poly(g, [34, 64, 96, 40, 96, 88], hi);
      // flame tongues
      poly(g, [70, 48, 88, 36, 82, 56], '#fff0a0');
      poly(g, [74, 72, 94, 66, 86, 84], '#ffe08a');
    });
  },
  vong_lua: (g, c, hi, mid, d) => {
    KIND.nova(g, c, hi, mid, d, false);
    glowBlob(g, 64, 64, 28, '#ff8a2a', 0.45);
    disc(g, 64, 64, 14, '#fff0a0');
  },
  phun_nuoc: (g, c, hi, mid, d) => {
    glowBlob(g, 78, 52, 36, c, 0.45);
    withDepth(g, () => {
      poly(g, [20, 92, 42, 44, 52, 80], d);
      const drop = g.createRadialGradient(80, 50, 3, 80, 52, 26);
      drop.addColorStop(0, '#e8fbff');
      drop.addColorStop(0.4, hi);
      drop.addColorStop(1, mid);
      disc(g, 80, 52, 24, drop);
      disc(g, 72, 42, 8, 'rgba(255,255,255,0.85)');
      stroke(g, 36, 86, 58, 102, 5, mid);
      stroke(g, 44, 90, 66, 106, 4, hi);
    });
  },
  mang_bot: (g, c, hi, mid, d) => {
    KIND.buff(g, c, hi, mid, d, false);
    disc(g, 48, 52, 10, 'rgba(232,246,255,0.85)');
    disc(g, 78, 66, 12, 'rgba(200,240,255,0.7)');
    disc(g, 64, 80, 7, 'rgba(255,255,255,0.8)');
    ring(g, 48, 52, 10, 2, rgba(c, 0.5));
  },
  bang_cham: (g, c, hi, mid, d) => {
    glowBlob(g, 64, 64, 38, c, 0.45);
    withDepth(g, () => {
      poly(g, [64, 14, 78, 52, 112, 64, 78, 76, 64, 114, 50, 76, 16, 64, 50, 52], mid, d, 3);
      poly(g, [64, 28, 74, 54, 96, 64, 74, 74, 64, 100, 54, 74, 32, 64, 54, 54], hi);
      disc(g, 64, 64, 10, '#e8f8ff');
      disc(g, 60, 60, 4, 'rgba(255,255,255,0.9)');
    });
  },
  song_trao: (g, c, hi, mid, d) => {
    glowBlob(g, 64, 70, 36, c, 0.4);
    withDepth(g, () => {
      disc(g, 64, 98, 30, d);
      stroke(g, 18, 78, 42, 48, 10, mid);
      stroke(g, 42, 48, 66, 74, 10, hi);
      stroke(g, 66, 74, 108, 36, 10, mid);
      stroke(g, 24, 86, 48, 60, 4, 'rgba(255,255,255,0.45)');
    });
  },
  xoay_nuoc: (g, c, hi, mid, d) => {
    glowBlob(g, 64, 64, 40, c, 0.45);
    withDepth(g, () => {
      g.beginPath();
      g.arc(64, 64, 34, 0, Math.PI * 1.7);
      g.strokeStyle = mid;
      g.lineWidth = 14;
      g.lineCap = 'round';
      g.stroke();
      g.beginPath();
      g.arc(64, 64, 20, Math.PI * 0.4, Math.PI * 2.1);
      g.strokeStyle = hi;
      g.lineWidth = 9;
      g.stroke();
      disc(g, 64, 64, 10, d);
    });
  },
  gio_chem: (g, c, hi, mid, d) => {
    glowBlob(g, 70, 50, 34, c, 0.4);
    withDepth(g, () => {
      poly(g, [16, 40, 92, 22, 110, 40, 92, 58, 16, 76], mid, d, 3);
      poly(g, [26, 46, 88, 32, 98, 42, 88, 52, 26, 66], hi);
      stroke(g, 30, 86, 96, 104, 6, d);
      stroke(g, 34, 82, 90, 98, 3, hi);
    });
  },
  long_vu: (g, c, hi, mid, d) => {
    KIND.buff(g, c, hi, mid, d, false);
    withDepth(g, () => {
      // feather
      poly(g, [64, 24, 86, 56, 64, 100, 42, 56], hi, d, 2);
      stroke(g, 64, 30, 64, 94, 3, d);
      stroke(g, 50, 50, 78, 50, 2.5, d);
      stroke(g, 52, 66, 76, 66, 2.5, d);
    });
  },
  bao_xoay: (g, c, hi, mid, _d) => {
    glowBlob(g, 64, 64, 40, c, 0.4);
    withDepth(g, () => {
      g.beginPath();
      g.arc(64, 64, 36, 0.2, Math.PI * 1.8);
      g.strokeStyle = mid;
      g.lineWidth = 12;
      g.lineCap = 'round';
      g.stroke();
      g.beginPath();
      g.arc(64, 64, 22, 1, Math.PI * 2.4);
      g.strokeStyle = hi;
      g.lineWidth = 8;
      g.stroke();
      // wind blades
      stroke(g, 64, 20, 78, 40, 4, 'rgba(255,255,255,0.7)');
      stroke(g, 100, 64, 80, 78, 4, 'rgba(255,255,255,0.55)');
    });
  },
  loc_xoay: (g, c, hi, mid, d) => {
    glowBlob(g, 64, 58, 36, c, 0.4);
    withDepth(g, () => {
      poly(g, [64, 12, 84, 48, 104, 108, 64, 84, 24, 108, 44, 48], mid, d, 3);
      poly(g, [64, 26, 76, 52, 88, 96, 64, 76, 40, 96, 52, 52], hi);
      disc(g, 64, 108, 22, d);
    });
  },
  bao_to: KIND.nova,
  set_kich: (g, c, hi, mid, d) => {
    glowBlob(g, 64, 64, 42, c, 0.55);
    withDepth(g, () => {
      poly(g, [72, 12, 40, 60, 58, 60, 46, 116, 92, 54, 70, 54], mid, d, 3);
      poly(g, [68, 24, 48, 58, 62, 58, 54, 96, 82, 54, 68, 54], hi);
    });
    disc(g, 62, 48, 4, 'rgba(255,255,255,0.9)');
  },
  nap_dien: (g, c, hi, mid, d) => {
    glowBlob(g, 64, 64, 40, c, 0.5);
    withDepth(g, () => {
      disc(g, 64, 64, 34, mid);
      disc(g, 64, 64, 24, hi);
      poly(g, [64, 30, 52, 64, 64, 64, 56, 98, 80, 58, 68, 58], d);
      stroke(g, 28, 40, 40, 32, 4, hi);
      stroke(g, 88, 96, 100, 88, 4, hi);
    });
  },
  tia_set: (g, c, hi, mid, d) => {
    glowBlob(g, 70, 70, 34, c, 0.5);
    withDepth(g, () => {
      stroke(g, 20, 28, 58, 58, 9, mid);
      stroke(g, 58, 58, 44, 78, 9, hi);
      stroke(g, 44, 78, 104, 100, 9, mid);
      disc(g, 104, 100, 12, d);
      disc(g, 100, 96, 5, hi);
    });
  },
  sam_set: (g, c, hi, mid, d) => {
    glowBlob(g, 64, 70, 38, c, 0.5);
    withDepth(g, () => {
      disc(g, 48, 40, 20, shade(d, 0.2));
      disc(g, 78, 44, 24, d);
      disc(g, 64, 36, 14, shade(d, 0.35));
      poly(g, [64, 52, 48, 100, 66, 84, 76, 114, 92, 70], mid, hi, 2);
    });
  },
  thien_loi: KIND.nova,
  dam_dat: (g, c, hi, mid, d) => {
    glowBlob(g, 64, 70, 34, c, 0.35);
    withDepth(g, () => {
      disc(g, 64, 102, 28, d);
      poly(g, [42, 30, 86, 30, 86, 86, 42, 86], mid, d, 3);
      poly(g, [36, 22, 92, 22, 92, 40, 36, 40], hi, d, 2);
      stroke(g, 64, 48, 64, 78, 6, d);
    });
  },
  giap_da: (g, c, hi, mid, d) => {
    KIND.buff(g, c, hi, mid, d, false);
    withDepth(g, () => {
      poly(g, [46, 48, 82, 48, 76, 74, 52, 74], d);
      stroke(g, 52, 56, 74, 56, 3, mid);
      stroke(g, 54, 66, 72, 66, 3, mid);
    });
  },
  nem_da: (g, c, hi, mid, d) => {
    glowBlob(g, 70, 58, 34, c, 0.35);
    withDepth(g, () => {
      poly(g, [20, 96, 40, 78], d); // motion trail stub
      stroke(g, 24, 100, 48, 78, 6, d);
      poly(g, [64, 28, 96, 52, 86, 92, 42, 92, 32, 52], mid, d, 3);
      poly(g, [64, 40, 84, 56, 78, 80, 50, 80, 44, 56], hi);
    });
  },
  nut_dat: (g, c, hi, mid, d) => {
    glowBlob(g, 64, 70, 36, c, 0.35);
    withDepth(g, () => {
      disc(g, 64, 100, 28, d);
      stroke(g, 20, 88, 48, 40, 10, mid);
      stroke(g, 48, 40, 72, 76, 10, hi);
      stroke(g, 72, 76, 108, 28, 10, mid);
      stroke(g, 28, 80, 50, 50, 4, 'rgba(255,255,255,0.35)');
    });
  },
  son_nham: KIND.nova,
  thien_moc: (g, c, hi, mid, d) => {
    KIND.nova(g, c, hi, mid, d, false);
    withDepth(g, () => {
      disc(g, 64, 46, 20, mid);
      disc(g, 50, 52, 12, hi);
      disc(g, 78, 52, 12, shade(mid, -0.1));
      stroke(g, 64, 54, 64, 92, 8, d);
    });
  },
  moc_than_phan: (g, c, hi, mid, d) => {
    THEMES.thien_moc!(g, c, hi, mid, d, true);
    glowBlob(g, 64, 64, 30, hi, 0.35);
  },
  diem_bao: (g, c, hi, mid, d) => {
    KIND.nova(g, c, hi, mid, d, false);
    glowBlob(g, 64, 64, 30, '#ff6a20', 0.5);
    disc(g, 64, 64, 12, '#fff0a0');
  },
  hoa_long_diet: (g, c, hi, mid, d) => {
    glowBlob(g, 64, 64, 44, c, 0.55);
    KIND.nova(g, c, hi, mid, d, false);
    withDepth(g, () => {
      // dragon-ish S curve flame
      stroke(g, 36, 90, 52, 50, 12, mid);
      stroke(g, 52, 50, 78, 40, 12, hi);
      stroke(g, 78, 40, 96, 70, 12, mid);
      disc(g, 96, 70, 10, d);
    });
  },
  hai_long_bao: (g, c, hi, mid, d) => {
    glowBlob(g, 64, 64, 42, c, 0.5);
    KIND.nova(g, c, hi, mid, d, false);
    withDepth(g, () => {
      stroke(g, 30, 80, 50, 44, 10, mid);
      stroke(g, 50, 44, 80, 56, 10, hi);
      stroke(g, 80, 56, 100, 36, 10, mid);
    });
  },
  thuy_than_phan: (g, c, hi, mid, d) => {
    THEMES.hai_long_bao!(g, c, hi, mid, d, true);
    glowBlob(g, 64, 64, 28, '#a0fff0', 0.35);
  },
  cuong_phong: (g, c, hi, mid, d) => {
    THEMES.bao_xoay!(g, c, hi, mid, d, false);
    KIND.nova(g, c, hi, mid, d, false);
  },
  thien_phong_de: (g, c, hi, mid, d) => {
    THEMES.cuong_phong!(g, c, hi, mid, d, true);
    glowBlob(g, 64, 64, 30, '#ffffff', 0.35);
  },
  loi_long_noi: (g, c, hi, mid, d) => {
    THEMES.sam_set!(g, c, hi, mid, d, false);
    glowBlob(g, 64, 70, 28, hi, 0.4);
  },
  thien_loi_diet: (g, c, hi, mid, d) => {
    KIND.nova(g, c, hi, mid, d, false);
    THEMES.set_kich!(g, c, hi, mid, d, true);
  },
  dia_long_chan: (g, c, hi, mid, d) => {
    THEMES.dia_chan!(g, c, hi, mid, d, false);
    glowBlob(g, 64, 70, 28, hi, 0.3);
  },
  dia_than_phan: (g, c, hi, mid, d) => {
    THEMES.dia_long_chan!(g, c, hi, mid, d, true);
    KIND.nova(g, c, hi, mid, d, false);
  },
};

export function skillIconArt(skillId: string): HTMLCanvasElement {
  const sk = SKILLS[skillId];
  if (!sk) return render(KIND.buff, 0x8899aa, false);
  const root = skillRoot(skillId);
  const evolved = root !== skillId;
  const paint = THEMES[root] ?? KIND[sk.kind];
  return render(paint, sk.color, evolved);
}

export function basicAttackIconArt(color = 0xff8a6a): HTMLCanvasElement {
  return render((g, c, hi, mid, d) => {
    glowBlob(g, 64, 64, 36, c, 0.4);
    withDepth(g, () => {
      stroke(g, 28, 96, 52, 28, 11, mid);
      stroke(g, 48, 100, 74, 24, 11, hi);
      stroke(g, 68, 100, 98, 32, 11, mid);
      stroke(g, 32, 88, 48, 42, 4, d);
    });
    glowBlob(g, 80, 36, 14, hi, 0.35);
  }, color, false);
}

export function dodgeIconArt(): HTMLCanvasElement {
  return render((g, c, hi, mid, d) => {
    glowBlob(g, 64, 64, 34, c, 0.4);
    withDepth(g, () => {
      disc(g, 64, 72, 24, mid);
      stroke(g, 32, 48, 64, 24, 7, hi);
      stroke(g, 64, 24, 96, 48, 7, hi);
      // motion dashes
      stroke(g, 24, 70, 40, 70, 4, 'rgba(255,255,255,0.5)');
      stroke(g, 20, 82, 38, 82, 3, 'rgba(255,255,255,0.35)');
      disc(g, 52, 68, 4, d);
      disc(g, 76, 68, 4, d);
    });
  }, 0x7ab0ff, false);
}

export function restIconArt(awake: boolean): HTMLCanvasElement {
  return render((g, c, hi, mid, d) => {
    glowBlob(g, 64, 70, 32, c, 0.35);
    withDepth(g, () => {
      disc(g, 64, 82, 26, mid);
      if (awake) {
        poly(g, [38, 48, 90, 48, 90, 70, 38, 70], hi, d, 2);
        stroke(g, 34, 44, 94, 44, 5, d);
      } else {
        stroke(g, 82, 28, 104, 28, 4, hi);
        stroke(g, 88, 40, 104, 40, 3, hi);
        stroke(g, 46, 70, 82, 70, 6, d);
      }
    });
  }, awake ? 0x8fd16a : 0xffd84a, false);
}

const urlCache = new Map<string, string>();

export function skillIconUrl(skillId: string): string {
  const key = `sk3:${skillId}`;
  let u = urlCache.get(key);
  if (!u) {
    u = skillIconArt(skillId).toDataURL('image/png');
    urlCache.set(key, u);
  }
  return u;
}

export function basicAttackIconUrl(color = 0xff8a6a): string {
  const key = `atk3:${color}`;
  let u = urlCache.get(key);
  if (!u) {
    u = basicAttackIconArt(color).toDataURL('image/png');
    urlCache.set(key, u);
  }
  return u;
}

export function dodgeIconUrl(): string {
  let u = urlCache.get('dodge3');
  if (!u) {
    u = dodgeIconArt().toDataURL('image/png');
    urlCache.set('dodge3', u);
  }
  return u;
}

export function restIconUrl(awake: boolean): string {
  const key = awake ? 'rest3:awake' : 'rest3:up';
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
