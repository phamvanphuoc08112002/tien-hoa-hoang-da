import type Phaser from 'phaser';
import type { SaveData } from './systems/save';
import { loadSettings, type Settings } from './systems/settings';
import type { UI } from './ui/UI';

export interface GameStartData {
  mode: 'new' | 'continue';
  speciesId?: string;
  seed?: string;
  save?: SaveData;
}

/** Shared app-level handles so scenes can return to menus without globals leaking state. */
export const app = {
  ui: null as unknown as UI,
  game: null as Phaser.Game | null,
  settings: loadSettings() as Settings,
  showMenu: (_error?: string | null) => {},
  startGame: (_d: GameStartData) => {},
  newRun: () => {},
};
