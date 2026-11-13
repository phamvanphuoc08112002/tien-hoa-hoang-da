import { artRng, ellipse, line, makeCanvas, pixelize, poly, rect, shade, upscale } from './pixel';

type Painter = (g: CanvasRenderingContext2D, w: number, h: number) => void;

/** Draws a low-res sprite, pixelizes it with an outline, and upscales 2x. */
function sprite(w: number, h: number, paint: Painter, outline: string | null = '#1b1a18'): HTMLCanvasElement {
  const { c, g } = makeCanvas(w, h);
  paint(g, w, h);
  pixelize(c, [{ x: 0, y: 0, w, h }], null, outline);
  return upscale(c);
}

/** Sheet of N frames horizontally. */
function sheet(w: number, h: number, n: number, paint: (g: CanvasRenderingContext2D, f: number) => void, outline: string | null = '#1b1a18'): HTMLCanvasElement {
  const { c, g } = makeCanvas(w * n, h);
  for (let f = 0; f < n; f++) {
    g.save();
    g.translate(f * w, 0);
    paint(g, f);
    g.restore();
  }
  pixelize(
    c,
    Array.from({ length: n }, (_, f) => ({ x: f * w, y: 0, w, h })),
    null,
    outline,
  );
  return upscale(c);
}

const TREE_GREENS = [
  ['#2f6b2c', '#3f8a37', '#5fae4a', '#8fd06a'],
  ['#2c5f33', '#3a7b42', '#55a35a', '#83c97c'],
  ['#3d6b25', '#527f2c', '#74a83c', '#a3cf5c'],
];

export function treeArt(variant: number): HTMLCanvasElement {
  const [d, b, l, hl] = TREE_GREENS[variant % 3];
  return sprite(28, 38, (g) => {
    // trunk
    rect(g, 12, 24, 4, 12, '#6b4a2e');
    rect(g, 12, 24, 1, 12, '#8a6440');
    rect(g, 10, 34, 8, 2, '#5a3d25');
    // canopy clusters
    ellipse(g, 14, 18, 12, 9, d);
    ellipse(g, 8, 14, 7, 6, b);
    ellipse(g, 20, 14, 7, 6, b);
    ellipse(g, 14, 9, 8, 7, b);
    ellipse(g, 12, 8, 5, 4, l);
    ellipse(g, 7, 13, 3.5, 3, l);
    ellipse(g, 19, 12, 3.5, 3, l);
    ellipse(g, 11, 6, 2, 1.5, hl);
    const r = artRng(300 + variant);
    for (let k = 0; k < 8; k++) rect(g, 4 + Math.floor(r() * 20), 6 + Math.floor(r() * 16), 1, 1, d);
  });
}

export function pineArt(variant: number): HTMLCanvasElement {
  const greens = [
    ['#1f4a33', '#2c6545', '#3f8a5c'],
    ['#22503a', '#2f6b4c', '#4a9468'],
    ['#1c4430', '#295f42', '#3b7f58'],
  ][variant % 3];
  return sprite(24, 40, (g) => {
    rect(g, 10, 30, 4, 9, '#5e4128');
    for (let k = 0; k < 4; k++) {
      const y = 4 + k * 7;
      const hw = 4 + k * 2.5;
      poly(g, [12, y - 3, 12 + hw, y + 7, 12 - hw, y + 7], greens[0]);
      poly(g, [12, y - 2, 12 + hw - 2, y + 6, 12 - hw + 1, y + 6], greens[1]);
      poly(g, [11, y, 12 - hw * 0.5, y + 5, 11.5, y + 5], greens[2]);
    }
  });
}

export function boulderArt(variant: number): HTMLCanvasElement {
  return sprite(20, 16, (g) => {
    if (variant === 0) {
      ellipse(g, 10, 9, 8.5, 6, '#7b766b');
      ellipse(g, 8, 7, 5.5, 3.5, '#9a9488');
      ellipse(g, 7, 6, 2.5, 1.5, '#bcb6a8');
      ellipse(g, 11, 13, 7, 2, '#5f5a50');
    } else if (variant === 1) {
      poly(g, [2, 14, 5, 4, 12, 2, 18, 8, 18, 14], '#76705f');
      poly(g, [5, 5, 12, 3, 14, 8, 7, 10], '#9a9380');
      rect(g, 8, 5, 3, 1, '#c0b9a6');
      ellipse(g, 15, 3, 3, 1.5, '#5d9a48');
    } else {
      ellipse(g, 7, 10, 6, 5, '#85806f');
      ellipse(g, 14, 11, 5, 4, '#7b766b');
      ellipse(g, 6, 8, 3, 2, '#a8a294');
      ellipse(g, 14, 9, 2.5, 1.6, '#a8a294');
    }
  });
}

export function grassFoodArt(eaten: boolean): HTMLCanvasElement {
  return sprite(16, 14, (g) => {
    if (eaten) {
      for (let k = 0; k < 5; k++) rect(g, 3 + k * 2, 10, 1, 2, '#7a8a3a');
      return;
    }
    const cols = ['#4a9a36', '#6cc24a', '#92e06a'];
    for (let k = 0; k < 9; k++) {
      const x = 2 + k * 1.4;
      const hgt = 5 + ((k * 7) % 5);
      line(g, x + 1, 13, x + (k % 2 ? 2 : -1), 13 - hgt, 1.2, cols[k % 3]);
    }
    ellipse(g, 8, 4, 1.2, 1.2, '#f4f0a0');
  }, '#1f3a18');
}

export function leafBushArt(empty: boolean): HTMLCanvasElement {
  return sprite(20, 16, (g) => {
    ellipse(g, 10, 10, 9, 5.5, empty ? '#4f6a33' : '#2f7a3a');
    if (empty) {
      line(g, 6, 12, 4, 5, 1, '#6b5a35');
      line(g, 12, 12, 14, 5, 1, '#6b5a35');
      return;
    }
    const leaves: [number, number, number][] = [
      [5, 7, -0.6],
      [10, 5, 0],
      [15, 7, 0.6],
      [8, 10, -0.3],
      [13, 10, 0.3],
    ];
    for (const [x, y, a] of leaves) {
      ellipse(g, x, y, 3.6, 2, '#5cbc4a', a);
      line(g, x - 2 * Math.cos(a), y - 2 * Math.sin(a), x + 2 * Math.cos(a), y + 2 * Math.sin(a), 0.6, '#2f7a3a');
    }
  }, '#173a1a');
}

export function berryBushArt(empty: boolean): HTMLCanvasElement {
  return sprite(20, 17, (g) => {
    ellipse(g, 10, 10, 9, 6.5, '#2d6a32');
    ellipse(g, 8, 8, 6, 4, '#3f8a3e');
    ellipse(g, 7, 6, 3, 2, '#5aa852');
    if (empty) return;
    const r = artRng(501);
    for (let k = 0; k < 7; k++) {
      const x = 4 + Math.floor(r() * 12);
      const y = 5 + Math.floor(r() * 8);
      rect(g, x, y, 2, 2, '#c8325a');
      rect(g, x, y, 1, 1, '#ff7a9a');
    }
  }, '#16351a');
}

export function mushroomArt(empty: boolean): HTMLCanvasElement {
  return sprite(14, 13, (g) => {
    if (empty) {
      rect(g, 4, 10, 2, 2, '#d8cdb0');
      rect(g, 9, 10, 2, 2, '#d8cdb0');
      return;
    }
    const caps: [number, number, number][] = [
      [5, 6, 3.6],
      [10, 8, 2.8],
    ];
    for (const [x, y, s] of caps) {
      rect(g, x - 1, y, 2, 12 - y, '#efe6cc');
      ellipse(g, x, y, s, s * 0.7, '#d8423a');
      ellipse(g, x - s * 0.3, y - s * 0.3, s * 0.4, s * 0.25, '#ff7a6a');
      rect(g, x + 1, y - 1, 1, 1, '#ffffff');
      rect(g, x - 2, y, 1, 1, '#ffffff');
    }
  }, '#3a1a14');
}

export function nestArt(empty: boolean): HTMLCanvasElement {
  return sprite(16, 11, (g) => {
    ellipse(g, 8, 7, 7, 3.5, '#8a6a3a');
    if (!empty) {
      ellipse(g, 6, 5, 2.2, 2.6, '#f2ead8');
      ellipse(g, 10, 5, 2.2, 2.6, '#cfe6f2');
      rect(g, 5, 4, 1, 1, '#ffffff');
      rect(g, 9, 4, 1, 1, '#ffffff');
      rect(g, 10, 6, 1, 1, '#7aa0b8');
    }
    ellipse(g, 8, 8, 7, 2.2, '#6b4e28');
    for (let k = 0; k < 6; k++) line(g, 2 + k * 2.2, 9, 3 + k * 2.2, 7, 0.7, '#a8844a');
  }, '#2a1e10');
}

export function crystalArt(empty: boolean): HTMLCanvasElement {
  return sprite(14, 18, (g) => {
    ellipse(g, 7, 16, 6, 1.8, '#5d574c');
    if (empty) {
      poly(g, [4, 16, 5, 13, 7, 16], '#6a8a96');
      poly(g, [8, 16, 9, 12, 11, 16], '#6a8a96');
      return;
    }
    poly(g, [5, 16, 6.5, 2, 9, 16], '#5ee0f0');
    poly(g, [6, 15, 6.5, 4, 7.5, 15], '#c8f8ff');
    poly(g, [2, 16, 3, 8, 5.5, 16], '#a07aff');
    poly(g, [9, 16, 11.5, 7, 12.5, 16], '#7ad0ff');
  }, '#1a2a3a');
}

export function shelterArt(variant: number): HTMLCanvasElement {
  if (variant === 1) {
    // hollow log
    return sprite(34, 20, (g) => {
      ellipse(g, 17, 17, 15, 2.5, '#2f4a24');
      rect(g, 4, 6, 26, 11, '#7a5530');
      rect(g, 4, 6, 26, 2, '#9a7040');
      rect(g, 4, 14, 26, 3, '#5e3f22');
      for (let k = 0; k < 5; k++) rect(g, 8 + k * 4, 9, 2, 1, '#5e3f22');
      ellipse(g, 29, 11.5, 4, 5.5, '#b08a5a');
      ellipse(g, 29, 11.5, 2.6, 4, '#20160e');
      ellipse(g, 12, 5, 3, 1.5, '#5d9a48');
      ellipse(g, 20, 5.5, 2, 1, '#6cc24a');
    });
  }
  if (variant === 2) {
    // cave
    return sprite(34, 26, (g) => {
      ellipse(g, 17, 15, 16, 11, '#6f6a5e');
      ellipse(g, 13, 10, 10, 6, '#8b8679');
      ellipse(g, 11, 8, 5, 2.5, '#a8a294');
      ellipse(g, 17, 20, 8, 6, '#1a1714');
      rect(g, 9, 20, 16, 5, '#1a1714');
      ellipse(g, 17, 24, 13, 2, '#4a463f');
    });
  }
  // burrow mound
  return sprite(32, 22, (g) => {
    ellipse(g, 16, 14, 15, 8, '#7a5a34');
    ellipse(g, 13, 10, 10, 5, '#94703f');
    ellipse(g, 16, 6, 9, 3.5, '#5fa548');
    ellipse(g, 12, 5, 4, 2, '#7cc25e');
    ellipse(g, 16, 16, 6, 4.5, '#1c140c');
    rect(g, 10, 16, 12, 5, '#1c140c');
    ellipse(g, 16, 21, 12, 1.5, '#5a4022');
  });
}

export function shrineArt(): HTMLCanvasElement {
  return sprite(26, 34, (g) => {
    rect(g, 3, 28, 20, 5, '#6f6a5e');
    rect(g, 3, 28, 20, 1, '#9a9488');
    rect(g, 6, 12, 14, 16, '#8b8679');
    rect(g, 6, 12, 2, 16, '#a8a294');
    rect(g, 18, 12, 2, 16, '#6f6a5e');
    rect(g, 4, 9, 18, 3, '#7b766b');
    rect(g, 4, 9, 18, 1, '#bcb6a8');
    // rune
    rect(g, 12, 15, 2, 9, '#ffd23f');
    rect(g, 9, 18, 8, 2, '#ffd23f');
    // orb
    ellipse(g, 13, 5, 4, 4, '#ffcf4a');
    ellipse(g, 12, 4, 1.8, 1.8, '#fff6c8');
    ellipse(g, 7, 30, 2, 1, '#5d9a48');
  });
}

/** Ancient Gate: a stone arch, dormant (dim runes) or open (swirling void). */
export function portalArt(open: boolean): HTMLCanvasElement {
  return sprite(40, 48, (g) => {
    ellipse(g, 20, 45, 18, 3, '#4a463f');
    // pillars
    rect(g, 4, 12, 7, 33, '#7b766b');
    rect(g, 4, 12, 2, 33, '#a8a294');
    rect(g, 29, 12, 7, 33, '#6f6a5e');
    rect(g, 34, 12, 2, 33, '#5a554b');
    rect(g, 2, 42, 11, 4, '#5f5a50');
    rect(g, 27, 42, 11, 4, '#5f5a50');
    // arch
    poly(g, [2, 14, 8, 5, 20, 1, 32, 5, 38, 14, 32, 12, 20, 8, 8, 12], '#8b8679');
    poly(g, [8, 5, 20, 1, 32, 5, 20, 3], '#bcb6a8');
    rect(g, 18, 2, 4, 5, '#5a554b');
    // void
    const core = open ? ['#2a1450', '#6a3ad0', '#c08aff', '#f0e0ff'] : ['#1a1820', '#24222c', '#2e2a38', '#3a3646'];
    ellipse(g, 20, 27, 9, 16, core[0]);
    ellipse(g, 20, 27, 7, 13, core[1]);
    ellipse(g, 20, 26, 4.5, 9, core[2]);
    ellipse(g, 20, 24, 2, 4, core[3]);
    if (open) {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        rect(g, Math.round(20 + Math.cos(a) * 6), Math.round(27 + Math.sin(a) * 11), 1, 1, '#ffffff');
      }
    }
    // runes on pillars
    const rune = open ? '#c08aff' : '#57526a';
    for (let k = 0; k < 4; k++) {
      rect(g, 7, 16 + k * 7, 2, 3, rune);
      rect(g, 31, 16 + k * 7, 2, 3, rune);
    }
    rect(g, 19, 3, 2, 2, open ? '#ffffff' : '#7a748a');
  });
}

/** Soft green healing pillar — walkable, glow rune + crystal tip. */
export function healpadArt(): HTMLCanvasElement {
  return sprite(18, 30, (g) => {
    ellipse(g, 9, 28, 8, 2, '#3a4a3a');
    rect(g, 4, 24, 10, 4, '#6a7a68');
    rect(g, 4, 24, 10, 1, '#9ab094');
    poly(g, [6, 24, 7, 8, 9, 4, 11, 8, 12, 24], '#7a9a88');
    poly(g, [7, 24, 7.6, 9, 9, 6, 9, 24], '#a8d0b8');
    rect(g, 8, 12, 2, 8, '#5ef0a0');
    rect(g, 6, 15, 6, 2, '#5ef0a0');
    ellipse(g, 9, 5, 3.2, 3.2, '#7dffb0');
    ellipse(g, 8.2, 4.2, 1.4, 1.4, '#e8fff0');
    ellipse(g, 9, 27, 5, 1.2, '#5ef0a0');
  });
}

export function stoneArt(used: boolean): HTMLCanvasElement {
  return sprite(14, 26, (g) => {
    ellipse(g, 7, 24, 6, 1.6, '#4a463f');
    poly(g, [3, 24, 4, 4, 7, 1, 10, 4, 11, 24], used ? '#6f6a5e' : '#7d8a96');
    poly(g, [4, 24, 4.6, 5, 6, 3, 6, 24], used ? '#86806f' : '#a2b0bc');
    const glyph = used ? '#8a8578' : '#5ef0d0';
    rect(g, 6, 8, 2, 1, glyph);
    rect(g, 7, 9, 1, 4, glyph);
    rect(g, 5, 14, 4, 1, glyph);
    rect(g, 6, 17, 2, 2, glyph);
  });
}

export function coinSheet(): HTMLCanvasElement {
  return sheet(10, 10, 4, (g, f) => {
    const w = [4, 3, 1, 3][f];
    ellipse(g, 5, 5, w, 4, '#e8a92a');
    if (w > 1) ellipse(g, 5, 5, Math.max(0.6, w - 1.5), 2.6, '#ffd84a');
    if (w > 2) rect(g, 4, 3, 1, 1, '#fff6c0');
  }, '#5a3a0a');
}

export function meatArt(): HTMLCanvasElement {
  return sprite(14, 11, (g) => {
    line(g, 3, 8, 7, 5, 2, '#f2ead8');
    ellipse(g, 2.5, 8.5, 1.6, 1.6, '#f2ead8');
    ellipse(g, 9, 5, 4.5, 3.5, '#b8402e');
    ellipse(g, 8, 4, 2.4, 1.6, '#e0705a');
  }, '#3a120c');
}

export function shadowArt(): HTMLCanvasElement {
  const { c, g } = makeCanvas(24, 8);
  ellipse(g, 12, 4, 11, 3.5, 'rgba(0,0,0,0.32)');
  return upscale(c);
}

// ---- particles ----
export function particleArt(kind: 'dust' | 'leaf' | 'spark' | 'star' | 'drop' | 'blood' | 'bubble'): HTMLCanvasElement {
  switch (kind) {
    case 'dust':
      return sprite(4, 4, (g) => ellipse(g, 2, 2, 1.8, 1.8, '#d8c8a0'), null);
    case 'leaf':
      return sprite(5, 4, (g) => {
        ellipse(g, 2.5, 2, 2.2, 1.3, '#6cc24a', 0.4);
        rect(g, 1, 2, 3, 1, '#3f8a37');
      }, null);
    case 'spark':
      return sprite(4, 4, (g) => {
        rect(g, 1, 0, 2, 4, '#ffb03a');
        rect(g, 0, 1, 4, 2, '#ffb03a');
        rect(g, 1, 1, 2, 2, '#fff2a0');
      }, null);
    case 'star':
      return sprite(5, 5, (g) => {
        rect(g, 2, 0, 1, 5, '#ffffff');
        rect(g, 0, 2, 5, 1, '#ffffff');
        rect(g, 1, 1, 3, 3, '#fff6c8');
      }, null);
    case 'drop':
      return sprite(3, 5, (g) => {
        rect(g, 1, 0, 1, 1, '#bfe8ff');
        rect(g, 0, 1, 3, 3, '#5cc8ff');
        rect(g, 1, 4, 1, 1, '#3aa8ff');
      }, null);
    case 'blood':
      return sprite(3, 3, (g) => rect(g, 0, 0, 3, 3, '#ffffff'), null);
    case 'bubble':
      return sprite(6, 6, (g) => {
        ellipse(g, 3, 3, 2.6, 2.6, '#bfe8ff');
        ellipse(g, 3, 3, 1.6, 1.6, '#3a80c6');
        rect(g, 2, 1, 1, 1, '#ffffff');
      }, null);
  }
}

/** Soft radial light (not pixelized) for glows. */
export function glowArt(size: number, inner: string, outer: string): HTMLCanvasElement {
  const { c, g } = makeCanvas(size, size);
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Darkness mask: transparent disc in the middle, opaque beyond. */
export function visionMaskArt(): HTMLCanvasElement {
  const size = 1024;
  const { c, g } = makeCanvas(size, size);
  const grd = g.createRadialGradient(size / 2, size / 2, 36, size / 2, size / 2, 96);
  grd.addColorStop(0, 'rgba(6,8,20,0)');
  grd.addColorStop(0.6, 'rgba(6,8,20,0.55)');
  grd.addColorStop(1, 'rgba(6,8,20,1)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

export function beamArt(): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 256);
  const grd = g.createLinearGradient(0, 0, 64, 0);
  grd.addColorStop(0, 'rgba(255,255,220,0)');
  grd.addColorStop(0.5, 'rgba(255,255,220,0.9)');
  grd.addColorStop(1, 'rgba(255,255,220,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 256);
  const fade = g.createLinearGradient(0, 0, 0, 256);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.7, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = fade;
  g.fillRect(0, 0, 64, 256);
  return c;
}

/** Small item icons for the inventory UI. */
export function foodIconArt(food: string): HTMLCanvasElement {
  switch (food) {
    case 'la':
      return sprite(12, 12, (g) => {
        ellipse(g, 6, 6, 5, 2.6, '#5cbc4a', -0.7);
        line(g, 2.5, 9.5, 9.5, 2.5, 0.8, '#2f7a3a');
      }, '#173a1a');
    case 'qua':
      return sprite(12, 12, (g) => {
        ellipse(g, 4.5, 7, 2.6, 2.6, '#c8325a');
        ellipse(g, 8, 7.5, 2.6, 2.6, '#a82a4a');
        ellipse(g, 6.3, 4.5, 2.4, 2.4, '#d83a62');
        rect(g, 5, 3, 1, 1, '#ff9ab0');
        line(g, 6, 2.5, 7.5, 0.8, 0.8, '#3f8a37');
      }, '#3a0e18');
    case 'nam':
      return sprite(12, 12, (g) => {
        rect(g, 5, 6, 2, 5, '#efe6cc');
        ellipse(g, 6, 5.5, 4.5, 3, '#d8423a');
        rect(g, 4, 4, 1, 1, '#ffffff');
        rect(g, 7, 3, 1, 1, '#ffffff');
      }, '#3a1a14');
    case 'trung':
      return sprite(12, 12, (g) => {
        ellipse(g, 6, 6.5, 3.4, 4.2, '#f2ead8');
        rect(g, 4, 4, 1, 2, '#ffffff');
        rect(g, 7, 8, 1, 1, '#c8b896');
      }, '#3a2e18');
    case 'thit':
      return sprite(12, 12, (g) => {
        line(g, 2, 9, 6, 6, 2, '#f2ead8');
        ellipse(g, 7.5, 5, 3.6, 3, '#b8402e');
        ellipse(g, 7, 4, 1.8, 1.2, '#e0705a');
      }, '#3a120c');
    case 'binh_giai_doc':
      return sprite(12, 12, (g) => {
        ellipse(g, 6, 7, 3.2, 3.8, '#9ae06a');
        rect(g, 5, 2, 2, 3, '#d0e8b0');
        rect(g, 4.5, 1.5, 3, 1.2, '#6a8a4a');
      }, '#1a2e12');
    case 'cao_lam_lanh':
      return sprite(12, 12, (g) => {
        ellipse(g, 6, 7.5, 3.5, 3.2, '#7ad0ff');
        rect(g, 4, 3, 4, 3, '#c8ecff');
        rect(g, 5, 2, 2, 1.5, '#4a90c0');
      }, '#0e2438');
    case 'tonic_suc_manh':
      return sprite(12, 12, (g) => {
        ellipse(g, 6, 6.5, 3.4, 4, '#ff8a4a');
        rect(g, 5, 2, 2, 3, '#ffd0a0');
        rect(g, 4, 8, 4, 1.2, '#ffcf4a');
      }, '#3a1808');
    case 'tonic_giap':
      return sprite(12, 12, (g) => {
        ellipse(g, 6, 6.5, 3.6, 4, '#c0d0e8');
        rect(g, 4, 4, 4, 5, '#e8f0ff');
        line(g, 6, 3, 6, 9, 1.2, '#6a80a0');
      }, '#1a2230');
    case 'moi_thit':
      return sprite(12, 12, (g) => {
        ellipse(g, 6, 7, 4, 3.2, '#c04040');
        ellipse(g, 5, 5.5, 1.6, 1.2, '#e0705a');
        line(g, 3, 9, 8, 4, 1.2, '#f2ead8');
      }, '#2a0c0c');
    case 'banh_phuc_hoi':
      return sprite(12, 12, (g) => {
        ellipse(g, 6, 7, 4.2, 3.4, '#ffd84a');
        rect(g, 4, 5, 1, 1, '#fff6c8');
        rect(g, 7, 7, 1, 1, '#e0a020');
        rect(g, 5.5, 8, 1, 1, '#fff6c8');
      }, '#3a2a08');
    default:
      return sprite(12, 12, (g) => {
        for (let k = 0; k < 5; k++) line(g, 3 + k * 1.5, 11, 3 + k * 1.6 + (k % 2 ? 1 : -1), 3 + (k % 3), 1, '#6cc24a');
      }, '#1f3a18');
  }
}

export { shade };
