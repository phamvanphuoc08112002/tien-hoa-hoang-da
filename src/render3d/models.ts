import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** A static model: lit (cel-shaded) geometry plus optional unlit glowing geometry. */
export interface StaticModel {
  solid: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
  shadow: boolean;
}

type Geo = THREE.BufferGeometry;

const D2R = Math.PI / 180;

function mat(x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  return m;
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(Math.round(x * 10) | 0, 73856093) ^ Math.imul(Math.round(y * 10) | 0, 19349663) ^ Math.imul(Math.round(z * 10) | 0, 83492791) ^ Math.imul(seed, 2654435761);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Deterministic, crack-free vertex wobble for organic shapes. */
function wobble(g: Geo, amt: number, seed: number): Geo {
  const m = mergeVertices(g.deleteAttribute('normal').deleteAttribute('uv'), 1e-3);
  const p = m.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    p.setXYZ(i, x + (hash3(x, y, z, seed) - 0.5) * amt, y + (hash3(y, z, x, seed + 1) - 0.5) * amt, z + (hash3(z, x, y, seed + 2) - 0.5) * amt);
  }
  return m;
}

/** Bakes a colour + transform into a non-indexed, flat-shaded piece. */
function piece(g: Geo, color: THREE.ColorRepresentation, m?: THREE.Matrix4, vary = 0, seed = 1): Geo {
  let geo = g.index ? g.toNonIndexed() : g.clone();
  if (geo.hasAttribute('uv')) geo.deleteAttribute('uv');
  if (geo.hasAttribute('normal')) geo.deleteAttribute('normal');
  if (m) geo.applyMatrix4(m);
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let f = 0; f < n; f += 3) {
    const k = vary ? 1 + (hash3(f, seed, 3, seed) - 0.5) * vary : 1;
    for (let v = 0; v < 3 && f + v < n; v++) {
      col[(f + v) * 3] = c.r * k;
      col[(f + v) * 3 + 1] = c.g * k;
      col[(f + v) * 3 + 2] = c.b * k;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo = geo.index ? geo.toNonIndexed() : geo;
  return geo;
}

function merge(parts: Geo[]): Geo | null {
  if (parts.length === 0) return null;
  const g = mergeGeometries(parts, false);
  return g;
}

const blob = (r: number, seed: number, detail = 1) => wobble(new THREE.IcosahedronGeometry(r, detail), r * 0.28, seed);
const rock = (r: number, seed: number) => wobble(new THREE.DodecahedronGeometry(r, 0), r * 0.35, seed);

const TREE_GREENS = [
  ['#2f6b2c', '#3f8a37', '#5fae4a', '#8fd06a'],
  ['#2c5f33', '#3a7b42', '#55a35a', '#83c97c'],
  ['#3d6b25', '#527f2c', '#74a83c', '#a3cf5c'],
];

function tree(v: number): StaticModel {
  const [d, b, l] = TREE_GREENS[v % 3];
  const s = 1 + (v - 1) * 0.08;
  const p: Geo[] = [
    piece(new THREE.CylinderGeometry(3.6 * s, 5.5 * s, 30 * s, 6), '#6b4a2e', mat(0, 15 * s, 0)),
    piece(new THREE.ConeGeometry(8 * s, 6, 6), '#5a3d25', mat(0, 3, 0)),
    piece(blob(22 * s, 11 + v), b, mat(0, 44 * s, 0, 1, 0.85, 1), 0.18, 3),
    piece(blob(14 * s, 21 + v), d, mat(-15 * s, 36 * s, 5, 1, 0.9, 1), 0.18, 4),
    piece(blob(14 * s, 31 + v), d, mat(15 * s, 37 * s, -3, 1, 0.9, 1), 0.18, 5),
    piece(blob(13 * s, 41 + v), l, mat(-3 * s, 57 * s, -1, 1, 0.85, 1), 0.15, 6),
  ];
  return { solid: merge(p), glow: null, shadow: true };
}

function pine(v: number): StaticModel {
  const g = [
    ['#1f4a33', '#2c6545', '#3f8a5c'],
    ['#22503a', '#2f6b4c', '#4a9468'],
    ['#1c4430', '#295f42', '#3b7f58'],
  ][v % 3];
  const p: Geo[] = [piece(new THREE.CylinderGeometry(3, 4.2, 18, 6), '#5e4128', mat(0, 9, 0))];
  for (let k = 0; k < 4; k++) {
    const r = 19 - k * 4;
    p.push(piece(new THREE.ConeGeometry(r, 22, 7), g[k % 3], mat(0, 22 + k * 12, 0, 1, 1, 1, 0, k * 0.4, 0), 0.12, 10 + k));
  }
  return { solid: merge(p), glow: null, shadow: true };
}

function boulder(v: number): StaticModel {
  const p: Geo[] = [];
  if (v === 0) {
    p.push(piece(rock(14, 3), '#7b766b', mat(0, 7, 0, 1.15, 0.75, 0.95), 0.2, 1));
  } else if (v === 1) {
    p.push(piece(rock(13, 5), '#76705f', mat(0, 9, 0, 1, 0.95, 0.9), 0.2, 2));
    p.push(piece(blob(6, 9, 0), '#5d9a48', mat(4, 18, -2, 1.2, 0.5, 1.1)));
  } else {
    p.push(piece(rock(10, 7), '#85806f', mat(-6, 6, 1, 1, 0.8, 1), 0.2, 3));
    p.push(piece(rock(8, 8), '#7b766b', mat(8, 5, -2, 1, 0.8, 1), 0.2, 4));
  }
  return { solid: merge(p), glow: null, shadow: true };
}

function shelter(v: number): StaticModel {
  const p: Geo[] = [];
  const hole = (x: number, y: number, z: number, sx: number, sy: number) => piece(new THREE.CircleGeometry(1, 14), '#1a120c', mat(x, y, z, sx, sy, 1));
  if (v === 1) {
    p.push(piece(new THREE.CylinderGeometry(13, 13, 58, 10, 1, true), '#7a5530', mat(0, 13, 0, 1, 1, 1, 0, 0, Math.PI / 2), 0.15, 2));
    p.push(piece(new THREE.CircleGeometry(13, 10), '#b08a5a', mat(-29, 13, 0, 1, 1, 1, 0, -Math.PI / 2, 0)));
    p.push(piece(new THREE.RingGeometry(9, 13, 10), '#b08a5a', mat(29, 13, 0, 1, 1, 1, 0, Math.PI / 2, 0)));
    p.push(piece(new THREE.CircleGeometry(9, 10), '#1a120c', mat(28.5, 13, 0, 1, 1, 1, 0, Math.PI / 2, 0)));
    p.push(piece(blob(6, 3, 0), '#5d9a48', mat(-8, 25, 0, 1.4, 0.5, 1.1)));
    p.push(piece(blob(4, 4, 0), '#6cc24a', mat(10, 25, 3, 1.3, 0.5, 1)));
  } else if (v === 2) {
    p.push(piece(rock(30, 11), '#6f6a5e', mat(0, 16, -6, 1.15, 0.85, 0.9), 0.15, 3));
    p.push(piece(rock(16, 12), '#8b8679', mat(-10, 34, -8, 1, 0.6, 1), 0.15, 4));
    p.push(hole(0, 12, 22, 13, 12));
  } else {
    const dome = new THREE.SphereGeometry(28, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    p.push(piece(wobble(dome, 4, 5), '#7a5a34', mat(0, 0, 0, 1, 0.62, 0.9), 0.15, 5));
    p.push(piece(blob(16, 6), '#5fa548', mat(-2, 17, -4, 1.3, 0.35, 1), 0.15, 6));
    p.push(piece(blob(7, 7, 0), '#7cc25e', mat(-8, 21, -3, 1.2, 0.5, 1)));
    p.push(hole(0, 7, 23, 9, 8));
  }
  return { solid: merge(p), glow: null, shadow: true };
}

function shrine(): StaticModel {
  const p: Geo[] = [
    piece(new THREE.BoxGeometry(44, 8, 32), '#6f6a5e', mat(0, 4, 0)),
    piece(new THREE.BoxGeometry(26, 34, 20), '#8b8679', mat(0, 25, 0)),
    piece(new THREE.BoxGeometry(36, 6, 26), '#7b766b', mat(0, 45, 0)),
    piece(new THREE.CylinderGeometry(5, 7, 6, 8), '#6f6a5e', mat(0, 51, 0)),
    piece(blob(5, 3, 0), '#5d9a48', mat(-18, 9, 12, 1.4, 0.5, 1)),
  ];
  const glow: Geo[] = [
    piece(new THREE.IcosahedronGeometry(7, 1), '#ffcf4a', mat(0, 62, 0)),
    piece(new THREE.BoxGeometry(3, 18, 1), '#ffd23f', mat(0, 26, 10.2)),
    piece(new THREE.BoxGeometry(12, 3, 1), '#ffd23f', mat(0, 28, 10.2)),
  ];
  return { solid: merge(p), glow: merge(glow), shadow: true };
}

function portal(open: boolean): StaticModel {
  const p: Geo[] = [];
  for (const sx of [-1, 1]) {
    p.push(piece(new THREE.BoxGeometry(14, 8, 16), '#5f5a50', mat(sx * 28, 4, 0)));
    p.push(piece(new THREE.BoxGeometry(11, 62, 12), sx < 0 ? '#7b766b' : '#6f6a5e', mat(sx * 28, 36, 0), 0.1, 2));
  }
  p.push(piece(new THREE.BoxGeometry(76, 10, 16), '#8b8679', mat(0, 70, 0)));
  p.push(piece(new THREE.BoxGeometry(46, 8, 14), '#9a9488', mat(0, 79, 0)));
  p.push(piece(new THREE.BoxGeometry(8, 8, 17), '#5a554b', mat(0, 72, 0)));
  const core = open ? '#7a42e0' : '#24222c';
  const glow: Geo[] = [];
  const voidDisc = piece(new THREE.CircleGeometry(1, 20), core, mat(0, 36, 0, 21, 30, 1));
  if (open) {
    glow.push(voidDisc);
    glow.push(piece(new THREE.CircleGeometry(1, 20), '#c08aff', mat(0, 37, 0.5, 13, 20, 1)));
    glow.push(piece(new THREE.CircleGeometry(1, 16), '#f0e0ff', mat(0, 39, 1, 5, 8, 1)));
  } else p.push(voidDisc);
  const rune = open ? '#c08aff' : '#57526a';
  const runes: Geo[] = [];
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) runes.push(piece(new THREE.BoxGeometry(4, 5, 1), rune, mat(sx * 28, 18 + k * 12, 6.3)));
  if (open) glow.push(...runes);
  else p.push(...runes);
  return { solid: merge(p), glow: merge(glow), shadow: true };
}

function stone(used: boolean): StaticModel {
  const p: Geo[] = [piece(wobble(new THREE.CylinderGeometry(6, 8.5, 42, 5), 2, 3), used ? '#6f6a5e' : '#7d8a96', mat(0, 21, 0), 0.12, 2)];
  p.push(piece(rock(6, 3), '#5d574c', mat(6, 2, 4, 1, 0.5, 1)));
  const glyph = used ? '#8a8578' : '#5ef0d0';
  const g: Geo[] = [piece(new THREE.BoxGeometry(2.5, 12, 1), glyph, mat(0, 26, 7.6)), piece(new THREE.BoxGeometry(8, 2, 1), glyph, mat(0, 20, 7.8)), piece(new THREE.BoxGeometry(3, 3, 1), glyph, mat(0, 14, 7.9))];
  if (used) return { solid: merge([...p, ...g]), glow: null, shadow: true };
  return { solid: merge(p), glow: merge(g), shadow: true };
}

function coin(): StaticModel {
  const p = [piece(new THREE.CylinderGeometry(7, 7, 2.4, 14), '#e8a92a', mat(0, 0, 0, 1, 1, 1, Math.PI / 2, 0, 0)), piece(new THREE.CylinderGeometry(4.5, 4.5, 2.8, 12), '#ffd84a', mat(0, 0, 0, 1, 1, 1, Math.PI / 2, 0, 0))];
  return { solid: null, glow: merge(p), shadow: false };
}

function meat(): StaticModel {
  const p = [
    piece(new THREE.CylinderGeometry(1.6, 1.6, 12, 6), '#f2ead8', mat(-6, 4, 0, 1, 1, 1, 0, 0, 60 * D2R)),
    piece(new THREE.IcosahedronGeometry(2.6, 0), '#f2ead8', mat(-11, 1.8, 0)),
    piece(blob(7, 4, 1), '#b8402e', mat(3, 5, 0, 1.2, 0.8, 1), 0.15, 2),
    piece(blob(3.5, 5, 0), '#e0705a', mat(1, 9, 2, 1, 0.6, 1)),
  ];
  return { solid: merge(p), glow: null, shadow: true };
}

function grass(eaten: boolean): StaticModel {
  const p: Geo[] = [];
  const cols = eaten ? ['#7a8a3a', '#8a9a46'] : ['#4a9a36', '#6cc24a', '#92e06a'];
  const n = eaten ? 6 : 10;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const r = 2 + (k % 3) * 2.2;
    const h = eaten ? 3 : 10 + ((k * 7) % 5) * 1.6;
    p.push(piece(new THREE.ConeGeometry(1.6, h, 4), cols[k % cols.length], mat(Math.cos(a) * r, h / 2, Math.sin(a) * r * 0.8, 1, 1, 1, Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35)));
  }
  if (!eaten) p.push(piece(new THREE.IcosahedronGeometry(1.8, 0), '#f4f0a0', mat(1, 15, 1)));
  return { solid: merge(p), glow: null, shadow: false };
}

function leafBush(empty: boolean): StaticModel {
  const p: Geo[] = [];
  if (empty) {
    p.push(piece(blob(9, 3, 0), '#4f6a33', mat(0, 5, 0, 1.2, 0.5, 1)));
    for (const sx of [-1, 1]) p.push(piece(new THREE.CylinderGeometry(0.8, 1, 12, 4), '#6b5a35', mat(sx * 4, 9, 0, 1, 1, 1, 0, 0, sx * 0.4)));
  } else {
    p.push(piece(blob(11, 5), '#2f7a3a', mat(0, 8, 0, 1.25, 0.75, 1), 0.15, 1));
    const leaves: [number, number, number][] = [[-8, 14, -0.6], [0, 17, 0], [8, 14, 0.6], [-4, 12, -0.3], [5, 12, 0.3]];
    for (const [x, y, a] of leaves) p.push(piece(new THREE.SphereGeometry(4.5, 6, 4), '#5cbc4a', mat(x, y, 4, 1, 0.4, 0.7, 0.4, 0, a)));
  }
  return { solid: merge(p), glow: null, shadow: true };
}

function berryBush(empty: boolean): StaticModel {
  const p: Geo[] = [piece(blob(12, 8), '#2d6a32', mat(0, 10, 0, 1.15, 0.85, 1), 0.15, 1), piece(blob(7, 9, 0), '#3f8a3e', mat(-4, 15, 3, 1, 0.8, 1))];
  if (!empty) {
    const pts: [number, number, number][] = [[-8, 12, 8], [-2, 17, 9], [6, 14, 8], [9, 8, 7], [-5, 6, 9], [2, 9, 11], [4, 20, 4], [-9, 18, 2]];
    for (const [x, y, z] of pts) p.push(piece(new THREE.IcosahedronGeometry(2.3, 0), '#d8325a', mat(x, y, z)));
  }
  return { solid: merge(p), glow: null, shadow: true };
}

function mushroom(empty: boolean): StaticModel {
  const p: Geo[] = [];
  const caps: [number, number, number][] = [[-4, 0, 7], [6, 3, 5.5]];
  for (const [x, z, s] of caps) {
    const h = empty ? 2 : s * 1.5;
    p.push(piece(new THREE.CylinderGeometry(s * 0.32, s * 0.4, h, 6), '#efe6cc', mat(x, h / 2, z)));
    if (empty) continue;
    p.push(piece(new THREE.SphereGeometry(s, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), '#d8423a', mat(x, h, z, 1, 0.75, 1)));
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + x;
      p.push(piece(new THREE.IcosahedronGeometry(s * 0.17, 0), '#ffffff', mat(x + Math.cos(a) * s * 0.55, h + s * 0.5, z + Math.sin(a) * s * 0.55)));
    }
  }
  return { solid: merge(p), glow: null, shadow: true };
}

function nest(empty: boolean): StaticModel {
  const p: Geo[] = [piece(wobble(new THREE.TorusGeometry(9, 4, 6, 12), 1.5, 3), '#8a6a3a', mat(0, 3, 0, 1, 1, 1, Math.PI / 2, 0, 0), 0.2, 1), piece(new THREE.CircleGeometry(8, 10), '#6b4e28', mat(0, 1.5, 0, 1, 1, 1, -Math.PI / 2, 0, 0))];
  if (!empty) {
    p.push(piece(new THREE.SphereGeometry(3.6, 8, 6), '#f2ead8', mat(-3, 5, 0, 1, 1.25, 1)));
    p.push(piece(new THREE.SphereGeometry(3.6, 8, 6), '#cfe6f2', mat(3.5, 5, 1, 1, 1.25, 1)));
  }
  return { solid: merge(p), glow: null, shadow: true };
}

function crystal(empty: boolean): StaticModel {
  const base = piece(rock(7, 4), '#5d574c', mat(0, 1, 0, 1.2, 0.4, 1));
  if (empty) {
    const s = [piece(new THREE.ConeGeometry(2.5, 6, 5), '#6a8a96', mat(-3, 3, 1)), piece(new THREE.ConeGeometry(2.5, 7, 5), '#6a8a96', mat(3, 3.5, -1))];
    return { solid: merge([base, ...s]), glow: null, shadow: true };
  }
  const g: Geo[] = [
    piece(new THREE.OctahedronGeometry(1, 0), '#5ee0f0', mat(0, 14, 0, 4.5, 14, 4.5)),
    piece(new THREE.OctahedronGeometry(1, 0), '#a07aff', mat(-7, 8, 2, 3, 9, 3, 0, 0, 0.35)),
    piece(new THREE.OctahedronGeometry(1, 0), '#7ad0ff', mat(7, 9, 1, 3, 10, 3, 0, 0, -0.3)),
  ];
  return { solid: base, glow: merge(g), shadow: true };
}

const cache = new Map<string, StaticModel | null>();

/** Model for a Phaser texture key used by world objects (e.g. `tree1`, `grass_full`). */
export function modelFor(key: string): StaticModel | null {
  if (cache.has(key)) return cache.get(key) ?? null;
  let m: StaticModel | null = null;
  const v = Number(key.slice(-1)) || 0;
  if (key.startsWith('tree')) m = tree(v);
  else if (key.startsWith('pine')) m = pine(v);
  else if (key.startsWith('boulder')) m = boulder(v);
  else if (key.startsWith('shelter')) m = shelter(v);
  else if (key === 'shrine') m = shrine();
  else if (key === 'portal_off' || key === 'portal_on') m = portal(key === 'portal_on');
  else if (key === 'stone_new' || key === 'stone_used') m = stone(key === 'stone_used');
  else if (key === 'coin') m = coin();
  else if (key === 'meat') m = meat();
  else {
    const [kind, st] = key.split('_');
    const empty = st === 'empty';
    if (kind === 'grass') m = grass(empty);
    else if (kind === 'leafbush') m = leafBush(empty);
    else if (kind === 'berrybush') m = berryBush(empty);
    else if (kind === 'mushroom') m = mushroom(empty);
    else if (kind === 'nest') m = nest(empty);
    else if (kind === 'crystal') m = crystal(empty);
  }
  cache.set(key, m);
  return m;
}
