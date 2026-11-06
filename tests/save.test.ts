import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { createPlayerState } from '../src/systems/playerState';
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

  it('delete removes the save', () => {
    const st = new MemoryStorage();
    writeSave(st, sample());
    deleteSave(st);
    expect(loadSave(st).status).toBe('none');
  });
});
