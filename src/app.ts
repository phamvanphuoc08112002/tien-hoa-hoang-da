import type Phaser from 'phaser';
import type { MultiRoom } from './net/room';
import type { SaveData } from './systems/save';
import { loadSettings, type Settings } from './systems/settings';
import type { UI } from './ui/UI';

export interface GameStartData {
  /** 'travel' starts the next realm from a save: player kept, fresh world, placed at the new spawn. */
  mode: 'new' | 'continue' | 'travel';
  speciesId?: string;
  seed?: string;
  /** Custom character name for a new run. */
  playerName?: string;
  save?: SaveData;
  /** Present when starting a networked run (room already connected). */
  multi?: boolean;
}

/** Shared app-level handles so scenes can return to menus without globals leaking state. */
export const app = {
  ui: null as unknown as UI,
  game: null as Phaser.Game | null,
  settings: loadSettings() as Settings,
  /** Active PeerJS room while in (or entering) a multiplayer run. */
  multiRoom: null as MultiRoom | null,
  showMenu: (_error?: string | null) => {},
  startGame: (_d: GameStartData) => {},
  newRun: () => {},
  /** Opens species select then starts a multiplayer run with the room's seed. */
  startMultiRun: () => {},
};
