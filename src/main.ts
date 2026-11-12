import Phaser from 'phaser';
import './style.css';
import { app, type GameStartData } from './app';
import { randomSeedString } from './core/rng';
import { REALMS, realmOf } from './data/realms';
import { getSpecies } from './data/species';
import { setPreview3D } from './gfx/textures';
import { webglAvailable } from './render3d/Renderer3D';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { audio } from './systems/audio';
import { deleteSave, loadSave, type LoadResult } from './systems/save';
import { saveSettings } from './systems/settings';
import { UI, esc } from './ui/UI';

app.ui = new UI();
audio.setSettings(app.settings);
const use3D = webglAvailable();
setPreview3D(use3D && app.settings.graphics3d);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-root',
  transparent: true,
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  audio: { noAudio: true },
  input: { keyboard: { target: window }, mouse: { preventDefaultWheel: true } },
  fps: { target: 60 },
  scene: [BootScene, GameScene],
});
app.game = game;

// Mobile browsers report the new viewport size late after rotation / toolbar changes,
// so Phaser's own resize check can miss it. Re-measure a few times after the event.
// Fixed `inset: 0` can extend behind the browser toolbars, so pin the height to the visible viewport.
const fitViewport = () => {
  const h = Math.round(window.visualViewport?.height ?? window.innerHeight);
  document.documentElement.style.setProperty('--app-h', `${h}px`);
  game.scale.refresh();
};
fitViewport();
let refreshTimers: number[] = [];
const refreshScale = () => {
  refreshTimers.forEach((t) => window.clearTimeout(t));
  refreshTimers = [0, 60, 250, 700, 1200].map((ms) => window.setTimeout(fitViewport, ms));
};
window.addEventListener('resize', refreshScale);
window.addEventListener('orientationchange', refreshScale);
window.visualViewport?.addEventListener('resize', refreshScale);

function describeSave(r: LoadResult): string | null {
  if (r.status !== 'ok') return null;
  const p = r.data.player;
  const f = getSpecies(p.speciesId).forms[p.form];
  const date = new Date(r.data.savedAt).toLocaleString('vi-VN');
  return `${f.name} • Cấp ${p.level} • ${realmOf(p.realm).name} (${p.realm + 1}/${REALMS.length}) • Ngày ${p.stats.daysSurvived + 1} • seed ${r.data.seed} • lưu lúc ${date}`;
}

function stopGame(): void {
  if (game.scene.isActive('Game') || game.scene.isPaused('Game')) game.scene.stop('Game');
}

app.showMenu = (error?: string | null) => {
  stopGame();
  setPreview3D(use3D && app.settings.graphics3d);
  const r = loadSave(localStorage);
  app.ui.showMainMenu({
    saveInfo: describeSave(r),
    error: error ?? (r.status === 'error' ? r.message : null),
    settings: app.settings,
    onContinue: () => {
      audio.unlock();
      const latest = loadSave(localStorage);
      if (latest.status === 'ok') app.startGame({ mode: 'continue', save: latest.data });
      else app.showMenu(latest.status === 'error' ? latest.message : 'Không tìm thấy bản lưu.');
    },
    onNew: async () => {
      audio.unlock();
      const existing = loadSave(localStorage);
      if (existing.status !== 'none') {
        const ok = await app.ui.confirm(
          'Ghi đè bản lưu?',
          `<p>Bắt đầu lượt mới sẽ <b>xóa vĩnh viễn</b> bản lưu hiện tại${existing.status === 'ok' ? `:<br><small>${esc(describeSave(existing) ?? '')}</small>` : ' (bản lưu đang bị lỗi)'}.</p>`,
          'Ghi đè & chơi mới',
          'Hủy',
        );
        if (!ok) return;
      }
      app.newRun();
    },
    onDeleteSave: async () => {
      const ok = await app.ui.confirm('Xóa bản lưu?', '<p>Bản lưu sẽ bị xóa vĩnh viễn.</p>', 'Xóa', 'Hủy');
      if (!ok) return;
      deleteSave(localStorage);
      app.showMenu(null);
    },
    onSettings: (s) => {
      const redraw = s.graphics3d !== app.settings.graphics3d;
      app.settings = s;
      saveSettings(s);
      audio.setSettings(s);
      if (redraw) {
        setPreview3D(use3D && s.graphics3d);
        app.showMenu(null);
      }
    },
  });
};

app.newRun = () => {
  stopGame();
  app.ui.showSelect(
    randomSeedString(),
    (speciesId, seed) => {
      audio.unlock();
      deleteSave(localStorage);
      app.startGame({ mode: 'new', speciesId, seed });
    },
    () => app.showMenu(null),
  );
};

app.startGame = (d: GameStartData) => {
  stopGame();
  app.ui.showLoading('Đang tạo thế giới...');
  // Let the loading screen paint before the (synchronous) world generation runs.
  window.setTimeout(() => {
    try {
      game.scene.start('Game', d);
    } catch (e) {
      console.error(e);
      app.showMenu(`Lỗi khi khởi tạo thế giới: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, 50);
};

game.events.once('textures-ready', () => app.showMenu(null));

// Keep keyboard focus on the game area when clicking the canvas.
document.getElementById('game-root')?.addEventListener('mousedown', () => {
  (document.getElementById('game-root') as HTMLElement).focus();
});
