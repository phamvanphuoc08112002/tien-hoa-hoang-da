import Phaser from 'phaser';
import * as THREE from 'three';
import { applyVariant } from '../data/shop';
import type { Npc, NpcManager } from '../game/Npcs';
import type { Player } from '../game/Player';
import type { RemotePlayer } from '../game/RemotePlayer';
import type { WorldView } from '../game/WorldView';
import { getSpecies } from '../data/species';
import type { WorldData, WorldObject } from '../world/tiles';
import { ChibiModel, type ChibiAnim } from './chibi';
import { modelFor } from './models';
import { COS, SIN, headingToRotY, toZ, toonGradient } from './space';
import { Heightfield, buildTerrain } from './terrain';

export interface View3DDeps {
  scene: Phaser.Scene;
  world: WorldData;
  wv: WorldView;
  player: Player;
  npcs: NpcManager;
  remotes: () => Iterable<RemotePlayer>;
}

interface ObjEntry {
  obj: WorldObject;
  img: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
  x: number;
  y: number;
  h: number;
  yaw: number;
  scale: number;
}

interface InstGroup {
  solid: THREE.InstancedMesh | null;
  glow: THREE.InstancedMesh | null;
  n: number;
}

interface NpcView {
  model: ChibiModel;
  shadow: THREE.Mesh;
  key: string;
  heading: number;
  lastX: number;
  lastY: number;
}

const MOON = new THREE.Color('#a8bcff');
const ANIMS = new Set(['idle', 'walk', 'attack', 'eat', 'rest', 'sleep', 'hurt', 'dead']);

function yawFor(o: WorldObject): number {
  if (o.kind === 'shelter' || o.kind === 'shrine' || o.kind === 'portal' || o.kind === 'stone') return 0;
  const h = Math.imul(o.id + 17, 2654435761) >>> 0;
  return (h / 4294967296) * Math.PI * 2;
}

function scaleFor(o: WorldObject): number {
  if (o.kind !== 'tree' && o.kind !== 'pine' && o.kind !== 'boulder') return 1;
  const h = Math.imul(o.id + 91, 2246822519) >>> 0;
  return 0.88 + (h / 4294967296) * 0.3;
}

/** True when WebGL is usable for the 3D view. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Renders the world in 3D underneath a transparent Phaser canvas. Phaser keeps running
 * the simulation, input, HUD overlay and effects; its world sprites are hidden from the
 * main camera and mirrored here as 3D models.
 */
export class Renderer3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene3 = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 10, 9000);
  private sun = new THREE.DirectionalLight('#fff2d6', 1.9);
  private hemi = new THREE.HemisphereLight('#e4f1ff', '#55603e', 1.05);
  /** Warm light around the player at night so the creature stays readable. */
  private glow = new THREE.PointLight('#ffdcae', 0, 380, 0);
  readonly hf: Heightfield;
  private terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private decoMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private solidMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
  private glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  private objs: ObjEntry[] = [];
  private groups = new Map<string, InstGroup>();
  private capacity = new Map<string, number>();
  private npcViews = new Map<Npc, NpcView>();
  private remoteViews = new Map<RemotePlayer, NpcView>();
  private shadowGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  private shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.26, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private player: { model: ChibiModel; key: string; shadow: THREE.Mesh } | null = null;
  private heading = headingToRotY(0.5, 1);
  private lastPX = 0;
  private lastPY = 0;
  private hidden = new WeakSet<object>();
  private lastT = performance.now();
  private size = { w: 0, h: 0 };
  private ambient = new THREE.Color(1, 1, 1);
  private night = 0;
  private sunBase = new THREE.Color('#fff2d6');
  private dpr: number;

  constructor(private d: View3DDeps) {
    const touch = document.body.classList.contains('touch');
    this.dpr = Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setClearColor('#1b2a1b');
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'r3d';
    const root = document.getElementById('game-root') as HTMLElement;
    root.insertBefore(this.canvas, root.firstChild);

    this.hf = new Heightfield(d.world);
    this.scene3.add(buildTerrain(d.world, this.hf, this.terrainMat, this.decoMat));

    this.sun.castShadow = true;
    const sm = touch ? 1024 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.scene3.add(this.sun, this.sun.target, this.hemi, this.glow);

    this.camera.up.set(0, COS, -SIN);

    for (const v of d.wv.views) {
      const coin = v.obj.kind === 'coin';
      const gy = coin ? v.obj.y : v.img.y - 4;
      const e: ObjEntry = { obj: v.obj, img: v.img, x: v.obj.x, y: gy, h: this.hf.standAt(v.obj.x, gy), yaw: yawFor(v.obj), scale: scaleFor(v.obj) };
      this.objs.push(e);
      this.capacity.set(v.obj.kind, (this.capacity.get(v.obj.kind) ?? 0) + 1);
    }
    this.capacity.set('meat', 64);
    this.hideFrom2D();
  }

  /** Hides Phaser world sprites from the main camera (they still drive logic & animation). */
  hideFrom2D(): void {
    const cam = this.d.scene.cameras.main;
    const hide = (o: Phaser.GameObjects.GameObject | null | undefined) => {
      if (!o || this.hidden.has(o)) return;
      this.hidden.add(o);
      cam.ignore(o);
    };
    hide(this.d.wv.layer);
    for (const e of this.objs) hide(e.img);
    for (const c of this.d.wv.carcasses) hide(c.img);
    hide(this.d.player.sprite);
    hide(this.d.player.shadow);
    // Keep player/remote name tags on the Phaser overlay so names float above heads in 3D.
    for (const n of this.d.npcs.npcs) {
      hide(n.sprite);
      hide(n.shadow);
    }
    for (const r of this.d.remotes()) {
      hide(r.sprite);
      hide(r.shadow);
    }
  }

  setAmbient(color: number, night: number): void {
    this.ambient.setHex(color);
    this.night = night;
  }

  private group(key: string, kind: string): InstGroup | null {
    let g = this.groups.get(key);
    if (g) return g;
    const m = modelFor(key);
    if (!m) return null;
    const cap = Math.max(1, this.capacity.get(kind) ?? 1);
    const mk = (geo: THREE.BufferGeometry | null, mat: THREE.Material, shadow: boolean) => {
      if (!geo) return null;
      const im = new THREE.InstancedMesh(geo, mat, cap);
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = shadow;
      im.receiveShadow = true;
      this.scene3.add(im);
      return im;
    };
    g = { solid: mk(m.solid, this.solidMat, m.shadow), glow: mk(m.glow, this.glowMat, m.shadow), n: 0 };
    this.groups.set(key, g);
    return g;
  }

  private place(key: string, kind: string, x: number, y: number, h: number, yaw: number, s: number, m: THREE.Matrix4): void {
    const g = this.group(key, kind);
    if (!g) return;
    const cap = g.solid?.instanceMatrix.count ?? g.glow?.instanceMatrix.count ?? 0;
    if (g.n >= cap) return;
    m.makeRotationY(yaw).scale(new THREE.Vector3(s, s, s)).setPosition(x, h, toZ(y, h));
    g.solid?.setMatrixAt(g.n, m);
    g.glow?.setMatrixAt(g.n, m);
    g.n++;
  }

  private syncObjects(t: number): void {
    for (const g of this.groups.values()) g.n = 0;
    const m = new THREE.Matrix4();
    for (const e of this.objs) {
      const img = e.img;
      if (!img.active || !img.visible) continue;
      const key = img.texture.key;
      if (e.obj.kind === 'coin') {
        const bob = 9 + Math.sin(t * 3 + e.obj.id) * 2.5;
        this.place(key, 'coin', e.x, e.y, e.h + bob, t * 2.5 + e.obj.id, 1, m);
      } else this.place(key, e.obj.kind, e.x, e.y, e.h, e.yaw, e.scale, m);
    }
    for (const c of this.d.wv.carcasses) {
      if (!c.img.active) continue;
      this.place('meat', 'meat', c.x, c.y, this.hf.standAt(c.x, c.y), (c.id * 1.7) % 6.28, 1, m);
    }
    for (const g of this.groups.values()) {
      for (const im of [g.solid, g.glow]) {
        if (!im) continue;
        im.count = g.n;
        im.instanceMatrix.needsUpdate = true;
      }
    }
  }

  private blob(radius: number): THREE.Mesh {
    const s = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    s.renderOrder = 2;
    s.userData.r = radius;
    this.scene3.add(s);
    return s;
  }

  private placeBlob(s: THREE.Mesh, x: number, y: number, h: number, r: number, alpha = 1): void {
    s.position.set(x, h + 0.4, toZ(y, h + 0.4));
    s.scale.set(r * 1.25, 1, (r * 0.5) / SIN);
    s.visible = alpha > 0.05;
  }

  private makeNpcView(n: Npc): NpcView {
    const art = n.def.art;
    // Bosses build from a larger chibi base so they tower over regular fauna.
    const base = n.def.unique ? (n.def.id === 'hu_khong_than' ? 2.55 : n.def.guardian ? 2.35 : 2.2) : 1.9;
    const model = new ChibiModel(art, art.pal, base);
    let s = 1;
    if (n.def.id === 'hu_khong_than') s = 1.45;
    else if (n.def.guardian) s = 1.32;
    else if (n.def.unique) s = 1.25;
    else if (n.affix) s = 1.12;
    model.root.scale.setScalar(s);
    this.scene3.add(model.root);
    return {
      model,
      shadow: this.blob(n.radius * (n.def.unique ? 1.15 : 1)),
      key: n.texKey,
      heading: headingToRotY(n.facing, 0),
      lastX: n.x,
      lastY: n.y,
    };
  }

  private disposeNpcView(v: NpcView): void {
    v.model.dispose();
    v.shadow.removeFromParent();
  }

  /** Syncs visible NPCs as chibi 3D models (lazy-built, culled with the Phaser sprite). */
  private syncNpcs(dt: number, t: number): void {
    const alive = new Set(this.d.npcs.npcs);
    for (const [n, v] of this.npcViews) {
      if (alive.has(n) && n.sprite.active) continue;
      this.disposeNpcView(v);
      this.npcViews.delete(n);
    }
    for (const n of this.d.npcs.npcs) {
      const spr = n.sprite;
      if (!spr.active) continue;
      const visible = spr.visible;
      let v = this.npcViews.get(n);
      if (!visible) {
        // Drop culled models so exploring the whole map does not keep every chibi in memory.
        if (v) {
          this.disposeNpcView(v);
          this.npcViews.delete(n);
        }
        continue;
      }
      if (!v || v.key !== n.texKey) {
        if (v) this.disposeNpcView(v);
        v = this.makeNpcView(n);
        this.npcViews.set(n, v);
      }
      const { model, shadow } = v;
      model.root.visible = true;
      const h = this.hf.standAt(n.x, n.y);
      model.root.position.set(n.x, h, toZ(n.y, h));

      const dx = n.x - v.lastX;
      const dy = n.y - v.lastY;
      v.lastX = n.x;
      v.lastY = n.y;
      let want: number | null = null;
      if (n.windup) want = headingToRotY(Math.cos(n.windup.dir), Math.sin(n.windup.dir));
      else if (n.dash) want = headingToRotY(n.dash.vx, n.dash.vy);
      else if (Math.hypot(dx, dy) > 0.4) want = headingToRotY(dx, dy);
      else if (Math.hypot(n.moveX, n.moveY) > 0.15) want = headingToRotY(n.moveX, n.moveY);
      else want = headingToRotY(n.facing, 0);
      if (want !== null) {
        let diff = want - v.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        v.heading += diff * Math.min(1, dt * 12);
      }
      model.root.rotation.y = v.heading;

      const anim = (ANIMS.has(n.curAnim) ? n.curAnim : 'idle') as ChibiAnim;
      const speed = anim === 'walk' ? 0.6 + n.speedMult * 0.8 : 1;
      model.update(anim, dt, t, speed);
      model.setTint(spr.isTinted && !spr.tintFill ? spr.tintTopLeft : null, spr.tintFill, spr.alpha);
      this.placeBlob(shadow, n.x, n.y, h, n.radius * (n.affix ? 1.12 : 1), spr.alpha);
    }
  }

  private syncRemotes(dt: number, t: number): void {
    const list = [...this.d.remotes()];
    const alive = new Set(list);
    for (const [r, v] of this.remoteViews) {
      if (alive.has(r) && r.sprite.active) continue;
      this.disposeNpcView(v);
      this.remoteViews.delete(r);
    }
    for (const r of list) {
      if (!r.sprite.active) continue;
      let v = this.remoteViews.get(r);
      const key = r.texKey;
      if (!v || v.key !== key) {
        if (v) this.disposeNpcView(v);
        const art = getSpecies(r.speciesId).forms[r.form].art;
        const model = new ChibiModel(art, applyVariant(art.pal, r.variant));
        this.scene3.add(model.root);
        v = { model, shadow: this.blob(r.radius), key, heading: headingToRotY(r.facing, 0), lastX: r.x, lastY: r.y };
        this.remoteViews.set(r, v);
      }
      const { model, shadow } = v;
      model.root.visible = r.alive;
      const h = this.hf.standAt(r.x, r.y) + r.hoverOffset();
      model.root.position.set(r.x, h, toZ(r.y, h));
      const dx = r.x - v.lastX;
      const dy = r.y - v.lastY;
      v.lastX = r.x;
      v.lastY = r.y;
      let want = Math.hypot(dx, dy) > 0.4 ? headingToRotY(dx, dy) : headingToRotY(r.facing, 0);
      let diff = want - v.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      v.heading += diff * Math.min(1, dt * 12);
      model.root.rotation.y = v.heading;
      const anim = (ANIMS.has(r.anim) ? r.anim : 'idle') as ChibiAnim;
      model.update(anim, dt, t, 1);
      model.setTint(null, false, r.sprite.alpha);
      this.placeBlob(shadow, r.x, r.y, this.hf.standAt(r.x, r.y), r.radius, r.sprite.alpha);
    }
  }

  private syncPlayer(dt: number, t: number): void {
    const P = this.d.player;
    const key = P.texKey;
    if (!this.player || this.player.key !== key) {
      if (this.player) {
        this.player.model.dispose();
        this.player.shadow.removeFromParent();
      }
      const art = P.form.art;
      const model = new ChibiModel(art, applyVariant(art.pal, P.state.colorVariant));
      this.scene3.add(model.root);
      this.player = { model, key, shadow: this.blob(P.radius) };
      this.lastPX = P.x;
      this.lastPY = P.y;
    }
    const { model, shadow } = this.player;
    const spr = P.sprite;
    model.root.visible = spr.visible;
    const h = this.hf.standAt(P.x, P.y) + P.hoverOffset();
    model.root.position.set(P.x, h, toZ(P.y, h));

    // Heading: attack direction while attacking, else movement direction.
    const dx = P.x - this.lastPX;
    const dy = P.y - this.lastPY;
    this.lastPX = P.x;
    this.lastPY = P.y;
    let want: number | null = null;
    if (P.action && (P.action.kind === 'attack' || P.action.kind === 'skill')) want = headingToRotY(Math.cos(P.action.dir), Math.sin(P.action.dir));
    else if (Math.hypot(dx, dy) > 0.4) want = headingToRotY(dx, dy);
    if (want !== null) {
      let diff = want - this.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.heading += diff * Math.min(1, dt * 14);
    }
    model.root.rotation.y = this.heading;

    const animKey = spr.anims.currentAnim?.key ?? '';
    const name = animKey.slice(animKey.lastIndexOf(':') + 1);
    const anim = (ANIMS.has(name) ? name : 'idle') as ChibiAnim;
    model.update(anim, dt, t, spr.anims.timeScale);
    model.setTint(spr.isTinted && !spr.tintFill ? spr.tintTopLeft : null, spr.tintFill, spr.alpha);
    this.placeBlob(shadow, P.x, P.y, this.hf.standAt(P.x, P.y), P.radius, spr.alpha * (P.flies ? 0.55 : 1));
  }

  private syncCamera(): void {
    const cam = this.d.scene.cameras.main;
    const W = this.d.scene.scale.width;
    const H = this.d.scene.scale.height;
    if (W !== this.size.w || H !== this.size.h) {
      this.size = { w: W, h: H };
      this.renderer.setSize(W, H, true);
    }
    const shake = cam.shakeEffect as unknown as { _offsetX: number; _offsetY: number; isRunning: boolean };
    const sx = shake.isRunning ? shake._offsetX : 0;
    const sy = shake.isRunning ? shake._offsetY : 0;
    const z = cam.zoom;
    const cx = cam.scrollX + cam.width / 2 - sx / z;
    const cy = cam.scrollY + cam.height / 2 - sy / z;
    const hw = cam.width / (2 * z);
    const hh = cam.height / (2 * z);
    const c = this.camera;
    c.left = -hw;
    c.right = hw;
    c.top = hh;
    c.bottom = -hh;
    c.updateProjectionMatrix();
    const tz = toZ(cy, 0);
    const D = 3000;
    c.position.set(cx, SIN * D, tz + COS * D);
    c.lookAt(cx, 0, tz);

    // Sun follows the view so the shadow map covers what is on screen.
    const span = Math.max(hw, hh) * 1.5 + 120;
    const sh = this.sun.shadow.camera;
    sh.left = -span;
    sh.right = span;
    sh.top = span;
    sh.bottom = -span;
    sh.near = 10;
    sh.far = 4000;
    sh.updateProjectionMatrix();
    this.sun.target.position.set(cx, 0, tz);
    this.sun.position.set(cx - 700, 1500, tz + 500);
  }

  private syncLights(): void {
    const day = 1 - this.night;
    this.sun.color.copy(this.sunBase).lerp(MOON, this.night).multiply(this.ambient);
    this.sun.intensity = 0.9 + 1.0 * day;
    this.hemi.color.setRGB(0.9, 0.95, 1).multiply(this.ambient);
    this.hemi.groundColor.setRGB(0.33, 0.37, 0.25).multiply(this.ambient);
    this.hemi.intensity = 1.05 + 0.05 * day;
    const P = this.d.player;
    const h = this.hf.standAt(P.x, P.y) + 70;
    this.glow.position.set(P.x, h, toZ(P.y, h));
    this.glow.intensity = this.night * 1.15;
    this.glow.visible = this.night > 0.02;
  }

  render(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    const t = now / 1000;
    this.hideFrom2D();
    this.syncCamera();
    this.syncLights();
    this.syncObjects(t);
    this.syncNpcs(dt, t);
    this.syncRemotes(dt, t);
    this.syncPlayer(dt, t);
    this.renderer.render(this.scene3, this.camera);
  }

  dispose(): void {
    this.player?.model.dispose();
    for (const v of this.npcViews.values()) this.disposeNpcView(v);
    this.npcViews.clear();
    for (const v of this.remoteViews.values()) this.disposeNpcView(v);
    this.remoteViews.clear();
    this.scene3.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !(o instanceof THREE.InstancedMesh)) m.geometry.dispose();
    });
    for (const g of this.groups.values()) {
      g.solid?.dispose();
      g.glow?.dispose();
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
