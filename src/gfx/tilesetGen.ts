import { artRng, makeCanvas, rect, upscale } from './pixel';

/** Tile indices in the generated tileset. */
export const TI = {
  GRASS: [0, 1],
  GRASS_FLOWERS: 2,
  GRASS_TALL: 3,
  FOREST: [4, 5],
  FOREST_LEAVES: 6,
  FOREST_FERN: 7,
  SAND: [8, 9],
  ROCK: [10, 11],
  ROCK_PEBBLES: 12,
  PLATEAU: [13, 14],
  LEDGE: 15,
  WALL: [16, 17],
  FORD: 18,
  DEEP: 19,
  /** 20 + mask, mask bits: 1=N land, 2=E, 4=S, 8=W */
  WATER_BASE: 20,
} as const;

export const TILESET_COLS = 12;
export const TILESET_ROWS = 3;
const TS = 16;

function tileRect(i: number): { x: number; y: number } {
  return { x: (i % TILESET_COLS) * TS, y: Math.floor(i / TILESET_COLS) * TS };
}

function speckle(g: CanvasRenderingContext2D, x0: number, y0: number, seed: number, colors: string[], count: number): void {
  const r = artRng(seed);
  for (let k = 0; k < count; k++) {
    const x = x0 + Math.floor(r() * TS);
    const y = y0 + Math.floor(r() * TS);
    rect(g, x, y, 1, 1, colors[Math.floor(r() * colors.length)]);
  }
}

function blades(g: CanvasRenderingContext2D, x0: number, y0: number, seed: number, color: string, count: number, h = 2): void {
  const r = artRng(seed);
  for (let k = 0; k < count; k++) {
    const x = x0 + Math.floor(r() * (TS - 1));
    const y = y0 + 1 + Math.floor(r() * (TS - h - 1));
    rect(g, x, y, 1, h, color);
    if (r() < 0.5) rect(g, x + 1, y + 1, 1, h - 1, color);
  }
}

function drawWater(g: CanvasRenderingContext2D, x0: number, y0: number, frame: number, deep: boolean, mask: number, seed: number): void {
  rect(g, x0, y0, TS, TS, deep ? '#2b5a9c' : '#3a80c6');
  const r = artRng(seed);
  for (let k = 0; k < 6; k++) {
    rect(g, x0 + Math.floor(r() * TS), y0 + Math.floor(r() * TS), 1, 1, deep ? '#25508c' : '#3474b8');
  }
  // drifting wave highlights
  const rows = [3, 9, 14];
  for (let k = 0; k < rows.length; k++) {
    const y = y0 + rows[k];
    const off = (frame * 2 + k * 5 + Math.floor(seed % 7)) % TS;
    const len = 4 + (k % 2) * 2;
    for (let i = 0; i < len; i++) {
      const x = x0 + ((off + i) % TS);
      rect(g, x, y + (i === 0 || i === len - 1 ? 1 : 0), 1, 1, deep ? '#3d72b6' : '#6cb2e8');
    }
  }
  if (mask) {
    const foam = '#cfeefc';
    const foam2 = '#8cc8ee';
    const wob = (i: number) => ((i + frame) % 4 === 0 ? 1 : 0);
    for (let i = 0; i < TS; i++) {
      if (mask & 1) {
        rect(g, x0 + i, y0, 1, 1 + wob(i), foam);
        rect(g, x0 + i, y0 + 2 + wob(i), 1, 1, foam2);
      }
      if (mask & 4) {
        rect(g, x0 + i, y0 + TS - 1 - wob(i), 1, 1 + wob(i), foam);
        rect(g, x0 + i, y0 + TS - 3 - wob(i), 1, 1, foam2);
      }
      if (mask & 2) {
        rect(g, x0 + TS - 1 - wob(i), y0 + i, 1 + wob(i), 1, foam);
        rect(g, x0 + TS - 3 - wob(i), y0 + i, 1, 1, foam2);
      }
      if (mask & 8) {
        rect(g, x0, y0 + i, 1 + wob(i), 1, foam);
        rect(g, x0 + 2 + wob(i), y0 + i, 1, 1, foam2);
      }
    }
  }
}

/** Renders the full tileset for one water animation frame (2x scale). */
export function renderTileset(frame: number): HTMLCanvasElement {
  const { c, g } = makeCanvas(TILESET_COLS * TS, TILESET_ROWS * TS);

  // Grass
  TI.GRASS.forEach((i, v) => {
    const { x, y } = tileRect(i);
    rect(g, x, y, TS, TS, '#5fa548');
    speckle(g, x, y, 11 + v, ['#56993f', '#6ab352', '#4f8f3a'], 26);
    blades(g, x, y, 21 + v, '#4a8a36', 5);
    blades(g, x, y, 31 + v, '#7cc25e', 3);
  });
  {
    const { x, y } = tileRect(TI.GRASS_FLOWERS);
    rect(g, x, y, TS, TS, '#5fa548');
    speckle(g, x, y, 41, ['#56993f', '#6ab352'], 22);
    blades(g, x, y, 42, '#4a8a36', 4);
    const r = artRng(43);
    const cols = ['#ffffff', '#ffe14d', '#ff8fb8', '#b9a0ff'];
    for (let k = 0; k < 4; k++) {
      const fx = x + 1 + Math.floor(r() * 13);
      const fy = y + 1 + Math.floor(r() * 13);
      const col = cols[Math.floor(r() * cols.length)];
      rect(g, fx, fy + 1, 1, 1, col);
      rect(g, fx + 2, fy + 1, 1, 1, col);
      rect(g, fx + 1, fy, 1, 1, col);
      rect(g, fx + 1, fy + 2, 1, 1, col);
      rect(g, fx + 1, fy + 1, 1, 1, '#ffd23f');
    }
  }
  {
    const { x, y } = tileRect(TI.GRASS_TALL);
    rect(g, x, y, TS, TS, '#5aa044');
    speckle(g, x, y, 51, ['#4f8f3a', '#6ab352'], 20);
    blades(g, x, y, 52, '#3f7a2e', 9, 4);
    blades(g, x, y, 53, '#86cc66', 5, 3);
  }

  // Forest floor
  TI.FOREST.forEach((i, v) => {
    const { x, y } = tileRect(i);
    rect(g, x, y, TS, TS, '#3e6b34');
    speckle(g, x, y, 61 + v, ['#37602e', '#467a3b', '#4d5a2e'], 30);
    blades(g, x, y, 71 + v, '#2f5428', 4);
  });
  {
    const { x, y } = tileRect(TI.FOREST_LEAVES);
    rect(g, x, y, TS, TS, '#3e6b34');
    speckle(g, x, y, 81, ['#37602e', '#467a3b'], 20);
    const r = artRng(82);
    for (let k = 0; k < 7; k++) {
      const lx = x + Math.floor(r() * 14);
      const ly = y + Math.floor(r() * 14);
      const col = r() < 0.5 ? '#8a6a34' : '#a8783a';
      rect(g, lx, ly, 2, 1, col);
      rect(g, lx + 1, ly + 1, 1, 1, col);
    }
  }
  {
    const { x, y } = tileRect(TI.FOREST_FERN);
    rect(g, x, y, TS, TS, '#3e6b34');
    speckle(g, x, y, 91, ['#37602e', '#467a3b'], 18);
    const fx = x + 8;
    const fy = y + 12;
    for (let k = 0; k < 5; k++) {
      rect(g, fx - k, fy - k, 1, 1, '#5d9a48');
      rect(g, fx + k, fy - k, 1, 1, '#5d9a48');
      rect(g, fx, fy - k, 1, 1, '#4a8a36');
    }
  }

  // Sand
  TI.SAND.forEach((i, v) => {
    const { x, y } = tileRect(i);
    rect(g, x, y, TS, TS, '#d8c38a');
    speckle(g, x, y, 101 + v, ['#cbb57c', '#e4d29e', '#bfa86e'], 30);
    if (v === 1) {
      rect(g, x + 4, y + 6, 2, 1, '#9a9488');
      rect(g, x + 11, y + 11, 2, 2, '#a8a294');
    }
  });

  // Rock ground
  TI.ROCK.forEach((i, v) => {
    const { x, y } = tileRect(i);
    rect(g, x, y, TS, TS, '#8b8679');
    speckle(g, x, y, 111 + v, ['#817c70', '#979285', '#7a7568'], 34);
    const r = artRng(121 + v);
    let cx = x + 2 + Math.floor(r() * 10);
    let cy = y + 2 + Math.floor(r() * 4);
    for (let k = 0; k < 7; k++) {
      rect(g, cx, cy, 1, 1, '#66625a');
      cx += r() < 0.5 ? 1 : 0;
      cy += 1;
    }
  });
  {
    const { x, y } = tileRect(TI.ROCK_PEBBLES);
    rect(g, x, y, TS, TS, '#8b8679');
    speckle(g, x, y, 131, ['#817c70', '#979285'], 26);
    const r = artRng(132);
    for (let k = 0; k < 5; k++) {
      const px = x + Math.floor(r() * 14);
      const py = y + Math.floor(r() * 14);
      rect(g, px, py, 2, 2, '#a9a497');
      rect(g, px, py + 1, 2, 1, '#6e6a60');
    }
  }
  TI.PLATEAU.forEach((i, v) => {
    const { x, y } = tileRect(i);
    rect(g, x, y, TS, TS, '#a08f74');
    speckle(g, x, y, 141 + v, ['#94846a', '#ae9e82', '#8a7a60'], 32);
    if (v === 1) {
      rect(g, x + 3, y + 4, 2, 1, '#c86a3a');
      rect(g, x + 12, y + 10, 1, 2, '#c86a3a');
    }
  });
  {
    const { x, y } = tileRect(TI.LEDGE);
    rect(g, x, y, TS, TS, '#6f6656');
    rect(g, x, y, TS, 4, '#b3a386');
    rect(g, x, y + 4, TS, 1, '#d2c3a4');
    for (let k = 0; k < TS; k += 3) rect(g, x + k, y + 5, 1, 11, '#5a5244');
    speckle(g, x, y + 6, 151, ['#7d735f', '#655c4c'], 16);
    rect(g, x, y + TS - 2, TS, 2, '#4a4338');
  }
  TI.WALL.forEach((i, v) => {
    const { x, y } = tileRect(i);
    rect(g, x, y, TS, TS, '#4a463f');
    const r = artRng(161 + v);
    for (let k = 0; k < 4; k++) {
      const bx = x + Math.floor(r() * 12);
      const by = y + Math.floor(r() * 12);
      rect(g, bx, by, 4, 3, '#5d584f');
      rect(g, bx, by, 4, 1, '#6e695e');
      rect(g, bx, by + 3, 4, 1, '#36332d');
    }
  });

  // Water family (animated)
  {
    const { x, y } = tileRect(TI.FORD);
    drawWater(g, x, y, frame, false, 0, 171);
    const stones = [
      [2, 3],
      [8, 6],
      [4, 11],
      [11, 12],
    ];
    for (const [sx, sy] of stones) {
      rect(g, x + sx, y + sy, 4, 3, '#9a9488');
      rect(g, x + sx, y + sy, 4, 1, '#c4beb0');
      rect(g, x + sx, y + sy + 3, 4, 1, '#2f6aa8');
    }
  }
  {
    const { x, y } = tileRect(TI.DEEP);
    drawWater(g, x, y, frame, true, 0, 181);
  }
  for (let m = 0; m < 16; m++) {
    const { x, y } = tileRect(TI.WATER_BASE + m);
    drawWater(g, x, y, frame, false, m, 191 + m);
  }
  return upscale(c);
}
