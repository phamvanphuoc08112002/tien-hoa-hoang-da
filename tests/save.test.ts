import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { LAST_REALM } from '../src/data/realms';
import { createPlayerState } from '../src/systems/playerState';
import { syncLearned } from '../src/systems/skills';
import { MemoryStorage, SAVE_KEY, deleteSave, loadSave, parseSave, serializeSave, writeSave, type SaveData } from '../src/systems/save';

function sample(): SaveData {
  const p = createPlayerState('hoa', 1234, 2345);
  p.form = 1;
  p.level = 6;
  p.coins = 17;
  p.inventory = ['thit', null];
  p.unlockedColors.push('kim');
  p.colorVariant = 'kim';
  p.markersUnlocked = true;
  p.markers.push({ x: 10, y: 20 });
  p.discoveredSectors.push(3, 4);
  p.discoveredBiomes.push('grass');
  syncLearned(p);
  p.mastery.vo_moi = 7;
  return {
    version: BALANCE.saveVersion,
    savedAt: 1,
    seed: 'ABC123',
    player: p,
    world: {
      time: 812.5,
      weather: 'rain',
      weatherRemaining: 40,
      weatherRolls: 3,
      resources: { '42': { p: 0, at: 900 } },
      collectedCoins: [7, 9],
      stonesUsed: [2],
      alphaDefeatedAt: null,
      bosses: { thuy_xa_vuong: 500 },
      guardianDown: false,
    },
  };
}

describe('save / load', () => {
  it('round-trips the full state', () => {
    const st = new MemoryStorage();
    const d = sample();
    expect(writeSave(st, d).ok).toBe(true);
    const r = loadSave(st);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.data).toEqual(d);
    expect(r.data.player.inventory).toEqual(['thit', null]);
    expect(r.data.world.collectedCoins).toEqual([7, 9]);
  });

  it('reports missing save as none', () => {
    expect(loadSave(new MemoryStorage()).status).toBe('none');
  });

  it('reports corrupt JSON with a clear message', () => {
    const st = new MemoryStorage();
    st.setItem(SAVE_KEY, '{not json');
    const r = loadSave(st);
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message).toMatch(/hỏng/);
  });

  it('rejects saves from a newer version', () => {
    const d = sample() as any;
    d.version = BALANCE.saveVersion + 1;
    const r = parseSave(JSON.stringify(d));
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message).toMatch(/phiên bản/);
  });

  it('rejects structurally invalid data', () => {
    const bad = [
      (d: any) => (d.player.speciesId = 'unknown'),
      (d: any) => (d.player.form = 5),
      (d: any) => (d.player.hp = 'x'),
      (d: any) => (d.player.inventory = ['banh_mi', null]),
      (d: any) => (d.player.inventory = ['thit']),
      (d: any) => (d.world.weather = 'snow'),
      (d: any) => delete d.seed,
      (d: any) => (d.player.hp = 0),
    ];
    for (const mut of bad) {
      const d = sample() as any;
      mut(d);
      expect(parseSave(JSON.stringify(d)).status).toBe('error');
    }
  });

  it('clamps out-of-range numbers instead of trusting them', () => {
    const d = sample() as any;
    d.player.hunger = 500;
    d.player.maturity = -10;
    d.player.coins = -3;
    const r = parseSave(serializeSave(d));
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.data.player.hunger).toBe(100);
    expect(r.data.player.maturity).toBe(0);
    expect(r.data.player.coins).toBe(0);
  });

  it('snapshot is atomic: collected coins and coin count are saved together', () => {
    const st = new MemoryStorage();
    const d = sample();
    writeSave(st, d);
    // Simulate collecting a coin after the save, then a reload without saving.
    d.player.coins += 1;
    d.world.collectedCoins.push(11);
    const r = loadSave(st);
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.data.player.coins).toBe(17);
    expect(r.data.world.collectedCoins).not.toContain(11);
  });

  it('migrates saves made before skills, bosses and new stats existed', () => {
    const d = sample() as any;
    delete d.player.skills;
    delete d.player.equipped;
    delete d.player.mastery;
    delete d.player.stats.elites;
    delete d.world.bosses;
    d.world.alphaDefeatedAt = 300;
    const r = parseSave(JSON.stringify(d));
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const p = r.data.player;
    expect(p.skills).toContain('vo_moi');
    expect(p.skills).toContain('hoi_lua');
    expect(p.equipped.length).toBe(3);
    expect(p.equipped[0]).toBe('vo_moi');
    expect(p.stats.elites).toBe(0);
    expect(r.data.world.bosses).toEqual({ nham_chua: 300 });
  });

  it('final-form legacy saves get their upgraded moves', () => {
    const d = sample() as any;
    d.player.form = 2;
    d.player.level = 12;
    delete d.player.skills;
    delete d.player.equipped;
    delete d.player.mastery;
    const r = parseSave(JSON.stringify(d));
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.data.player.skills).toContain('vo_moi_2');
    expect(r.data.player.skills).toContain('vong_lua');
  });

  it('saves made before realms existed start in the first realm with a closed gate', () => {
    const d = sample() as any;
    delete d.player.realm;
    delete d.world.guardianDown;
    const r = parseSave(JSON.stringify(d));
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.data.player.realm).toBe(0);
    expect(r.data.world.guardianDown).toBe(false);
  });

  it('keeps the realm and gate state, clamping impossible realms', () => {
    const d = sample() as any;
    d.player.realm = 3;
    d.world.guardianDown = true;
    let r = parseSave(JSON.stringify(d));
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.data.player.realm).toBe(3);
    expect(r.data.world.guardianDown).toBe(true);
    d.player.realm = 99;
    r = parseSave(JSON.stringify(d));
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.data.player.realm).toBe(LAST_REALM);
  });

  it('delete removes the save', () => {
    const st = new MemoryStorage();
    writeSave(st, sample());
    deleteSave(st);
    expect(loadSave(st).status).toBe('none');
  });
});
