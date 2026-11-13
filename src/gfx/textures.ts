import Phaser from 'phaser';
import { NPC_LIST } from '../data/npcs';
import { getSpecies } from '../data/species';
import { applyVariant } from '../data/shop';
import { FRAME, FRAME_COUNT, renderBeastPreview, renderBeastSheet } from './beastDrawer';
import {
  beamArt,
  berryBushArt,
  boulderArt,
  coinSheet,
  crystalArt,
  foodIconArt,
  glowArt,
  grassFoodArt,
  leafBushArt,
  meatArt,
  mushroomArt,
  nestArt,
  particleArt,
  pineArt,
  portalArt,
  shadowArt,
  shelterArt,
  healpadArt,
  shrineArt,
  stoneArt,
  treeArt,
  visionMaskArt,
} from './objectArt';
import { chibiPreviewUrl } from '../render3d/preview';
import { makeCanvas } from './pixel';
import { renderTileset } from './tilesetGen';

export const ANIM_NAMES = ['idle', 'walk', 'attack', 'eat', 'rest', 'sleep', 'hurt', 'dead'] as const;
export type AnimName = (typeof ANIM_NAMES)[number];

const ANIM_RATES: Record<AnimName, { rate: number; repeat: number }> = {
  idle: { rate: 2.5, repeat: -1 },
  walk: { rate: 9, repeat: -1 },
  attack: { rate: 14, repeat: 0 },
  eat: { rate: 4, repeat: -1 },
  rest: { rate: 1, repeat: -1 },
  sleep: { rate: 1, repeat: -1 },
  hurt: { rate: 1, repeat: 0 },
  dead: { rate: 1, repeat: 0 },
};

/** Water animation frames for the tileset (pre-rendered once). */
export const tilesetFrames: HTMLCanvasElement[] = [];

function addSheet(scene: Phaser.Scene, key: string, canvas: HTMLCanvasElement, frameW: number, frames: number): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.addCanvas(key, canvas);
  if (!tex) return;
  for (let f = 0; f < frames; f++) tex.add(f, 0, f * frameW, 0, frameW, canvas.height);
}

function addImage(scene: Phaser.Scene, key: string, canvas: HTMLCanvasElement): void {
  if (scene.textures.exists(key)) return;
  scene.textures.addCanvas(key, canvas);
}

function createBeastAnims(scene: Phaser.Scene, key: string): void {
  for (const name of ANIM_NAMES) {
    const k = `${key}:${name}`;
    if (scene.anims.exists(k)) continue;
    scene.anims.create({
      key: k,
      frames: (FRAME[name] as readonly number[]).map((f) => ({ key, frame: f })),
      frameRate: ANIM_RATES[name].rate,
      repeat: ANIM_RATES[name].repeat,
    });
  }
}

export function playerTextureKey(speciesId: string, form: number, variant: string): string {
  return `pl_${speciesId}_${form}_${variant}`;
}

/** Generates (once) the sheet + anims for a player species/form/colour. */
export function ensurePlayerTexture(scene: Phaser.Scene, speciesId: string, form: number, variant: string): string {
  const key = playerTextureKey(speciesId, form, variant);
  if (!scene.textures.exists(key)) {
    const f = getSpecies(speciesId).forms[form];
    const sheet = renderBeastSheet(f.art, applyVariant(f.art.pal, variant));
    addSheet(scene, key, sheet, f.art.size * 2, FRAME_COUNT);
  }
  createBeastAnims(scene, key);
  return key;
}

export function npcTextureKey(id: string): string {
  return `npc_${id}`;
}

export function registerAllTextures(scene: Phaser.Scene): void {
  // Tileset with 3 water frames; the live texture is a copy we redraw into.
  if (tilesetFrames.length === 0) for (let f = 0; f < 3; f++) tilesetFrames.push(renderTileset(f));
  if (!scene.textures.exists('tiles')) {
    const { c, g } = makeCanvas(tilesetFrames[0].width, tilesetFrames[0].height);
    g.drawImage(tilesetFrames[0], 0, 0);
    scene.textures.addCanvas('tiles', c);
  }

  for (const n of NPC_LIST) {
    const key = npcTextureKey(n.id);
    addSheet(scene, key, renderBeastSheet(n.art, n.art.pal), n.art.size * 2, FRAME_COUNT);
    createBeastAnims(scene, key);
  }

  for (let v = 0; v < 3; v++) {
    addImage(scene, `tree${v}`, treeArt(v));
    addImage(scene, `pine${v}`, pineArt(v));
    addImage(scene, `boulder${v}`, boulderArt(v));
    addImage(scene, `shelter${v}`, shelterArt(v));
  }
  addImage(scene, 'grass_full', grassFoodArt(false));
  addImage(scene, 'grass_empty', grassFoodArt(true));
  addImage(scene, 'leafbush_full', leafBushArt(false));
  addImage(scene, 'leafbush_empty', leafBushArt(true));
  addImage(scene, 'berrybush_full', berryBushArt(false));
  addImage(scene, 'berrybush_empty', berryBushArt(true));
  addImage(scene, 'mushroom_full', mushroomArt(false));
  addImage(scene, 'mushroom_empty', mushroomArt(true));
  addImage(scene, 'nest_full', nestArt(false));
  addImage(scene, 'nest_empty', nestArt(true));
  addImage(scene, 'crystal_full', crystalArt(false));
  addImage(scene, 'crystal_empty', crystalArt(true));
  addImage(scene, 'shrine', shrineArt());
  addImage(scene, 'healpad', healpadArt());
  addImage(scene, 'stone_new', stoneArt(false));
  addImage(scene, 'stone_used', stoneArt(true));
  addImage(scene, 'portal_off', portalArt(false));
  addImage(scene, 'portal_on', portalArt(true));
  addSheet(scene, 'coin', coinSheet(), 20, 4);
  if (!scene.anims.exists('coin:spin')) {
    scene.anims.create({ key: 'coin:spin', frames: [0, 1, 2, 1].map((f) => ({ key: 'coin', frame: f })), frameRate: 7, repeat: -1 });
  }
  addImage(scene, 'meat', meatArt());
  addImage(scene, 'shadow', shadowArt());
  for (const p of ['dust', 'leaf', 'spark', 'star', 'drop', 'blood', 'bubble'] as const) addImage(scene, `p_${p}`, particleArt(p));
  addImage(scene, 'glow', glowArt(128, 'rgba(255,255,230,1)', 'rgba(255,255,200,0)'));
  addImage(scene, 'vision', visionMaskArt());
  addImage(scene, 'beam', beamArt());
  for (const k of ['glow', 'vision', 'beam']) scene.textures.get(k).setFilter(Phaser.Textures.FilterMode.LINEAR);
}

// ---- DOM-facing image caches (data URLs) ----
const urlCache = new Map<string, string>();
let preview3D = false;

/** Switches creature portraits between 3D chibi renders and the 2D pixel sprites. */
export function setPreview3D(on: boolean): void {
  if (preview3D !== on) urlCache.clear();
  preview3D = on;
  document.body.classList.toggle('gfx3d', on);
}

export function speciesPreviewUrl(speciesId: string, form: number, silhouette: boolean, variant = 'goc'): string {
  const key = `${speciesId}:${form}:${silhouette}:${variant}:${preview3D ? '3d' : '2d'}`;
  let u = urlCache.get(key);
  if (!u) {
    const f = getSpecies(speciesId).forms[form];
    const pal = applyVariant(f.art.pal, variant);
    u = (preview3D ? chibiPreviewUrl(f.art, pal, silhouette) : null) ?? renderBeastPreview(f.art, pal, silhouette).toDataURL();
    urlCache.set(key, u);
  }
  return u;
}

export function foodIconUrl(food: string): string {
  const key = `food:${food}`;
  let u = urlCache.get(key);
  if (!u) {
    u = foodIconArt(food).toDataURL();
    urlCache.set(key, u);
  }
  return u;
}
