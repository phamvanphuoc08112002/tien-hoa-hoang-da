import Peer, { type DataConnection } from 'peerjs';

const PREFIX = 'thhd-';
const MAX_PEERS = 6;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type NetRole = 'host' | 'client';

export interface PlayerStateMsg {
  t: 'state';
  from: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speciesId: string;
  form: number;
  variant: string;
  anim: string;
  facing: number;
  alive: boolean;
  name: string;
  /** Peer is mid-evolution — wildlife may aggro them (co-op protect). */
  evolving?: boolean;
}

export interface GuardianMsg {
  t: 'guardian';
  from: string;
  action: 'summon' | 'down';
  x?: number;
  y?: number;
}

export interface HitMsg {
  t: 'hit';
  from: string;
  /** Peer id of the victim (local player on that machine). */
  to: string;
  damage: number;
  kx: number;
  ky: number;
}

export interface WelcomeMsg {
  t: 'welcome';
  seed: string;
  hostId: string;
  /** Host's current position so joiners spawn nearby instead of at world origin. */
  x: number;
  y: number;
  meet: boolean;
}

export interface HelloMsg {
  t: 'hello';
  from: string;
  speciesId: string;
  form: number;
  variant: string;
  name: string;
  x: number;
  y: number;
}

export interface LeaveMsg {
  t: 'leave';
  from: string;
}

export interface PeerGoneMsg {
  t: 'peerGone';
  from: string;
}

export type NetMsg = PlayerStateMsg | HitMsg | WelcomeMsg | HelloMsg | LeaveMsg | PeerGoneMsg | GuardianMsg;

export type NetHandler = (msg: NetMsg, from: string) => void;

function randomCode(n = 6): string {
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return s;
}

function peerIdFor(code: string): string {
  return PREFIX + code.toUpperCase();
}

function decode(data: unknown): NetMsg | null {
  try {
    if (typeof data === 'string') return JSON.parse(data) as NetMsg;
    if (data && typeof data === 'object' && (data as { t?: string }).t) return data as NetMsg;
  } catch {
    /* ignore */
  }
  return null;
}

/** Lightweight PeerJS room: host relays messages between clients. */
export class MultiRoom {
  readonly role: NetRole;
  readonly code: string;
  /** Local PeerJS id (host id equals thhd-CODE; clients get a random id). */
  peerId = '';
  seed: string;
  /** Rendezvous point for joiners (usually the host's current position). */
  meetX = 0;
  meetY = 0;
  meetValid = false;
  private peer: Peer | null = null;
  private conns = new Map<string, DataConnection>();
  private handlers: NetHandler[] = [];
  private joinHandlers: Array<(peerId: string) => void> = [];
  private ready = false;
  private closed = false;

  private constructor(role: NetRole, code: string, seed: string) {
    this.role = role;
    this.code = code.toUpperCase();
    this.seed = seed;
    if (role === 'host') this.peerId = peerIdFor(this.code);
  }

  static async create(seed: string): Promise<MultiRoom> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      const room = new MultiRoom('host', code, seed);
      try {
        await room.openPeer(room.peerId);
        return room;
      } catch (e) {
        room.destroy();
        if (attempt === 4) throw e;
      }
    }
    throw new Error('Không tạo được phòng.');
  }

  static async join(code: string): Promise<MultiRoom> {
    const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length < 4) throw new Error('Mã phòng không hợp lệ.');
    const room = new MultiRoom('client', clean, '');
    await room.openPeer(); // ephemeral id
    await room.connectToHost();
    return room;
  }

  setMeetPoint(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.meetX = x;
    this.meetY = y;
    this.meetValid = true;
  }

  onMessage(fn: NetHandler): () => void {
    this.handlers.push(fn);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== fn);
    };
  }

  /** Fires when a remote peer's data channel opens (host or client). */
  onPeerJoin(fn: (peerId: string) => void): () => void {
    this.joinHandlers.push(fn);
    return () => {
      this.joinHandlers = this.joinHandlers.filter((h) => h !== fn);
    };
  }

  /** Broadcast to every connected peer (host also relays client → others). */
  send(msg: NetMsg): void {
    if (this.closed) return;
    for (const c of this.conns.values()) {
      if (c.open) {
        try {
          c.send(msg);
        } catch (e) {
          console.warn('[multi] send failed', e);
        }
      }
    }
  }

  get connectedIds(): string[] {
    return [...this.conns.keys()];
  }

  get isOpen(): boolean {
    return this.ready && !this.closed;
  }

  destroy(): void {
    this.closed = true;
    this.ready = false;
    try {
      this.send({ t: 'leave', from: this.peer?.id ?? this.peerId });
    } catch {
      /* ignore */
    }
    for (const c of this.conns.values()) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    this.conns.clear();
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    this.peer = null;
    this.handlers = [];
    this.joinHandlers = [];
  }

  private openPeer(fixedId?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = fixedId ? new Peer(fixedId) : new Peer();
      this.peer = peer;
      const fail = (err: unknown) => {
        if (!this.closed) reject(err instanceof Error ? err : new Error(String(err)));
      };
      peer.on('error', fail);
      peer.on('open', (id) => {
        peer.off('error', fail);
        this.peerId = id;
        this.ready = true;
        if (this.role === 'host') {
          peer.on('connection', (conn) => this.accept(conn));
        }
        peer.on('error', (e) => console.warn('[multi]', e));
        resolve();
      });
    });
  }

  private connectToHost(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.peer) return reject(new Error('Peer chưa sẵn sàng.'));
      const hostId = peerIdFor(this.code);
      const conn = this.peer.connect(hostId, { reliable: true });
      const timer = window.setTimeout(() => reject(new Error('Hết thời gian chờ chủ phòng. Kiểm tra mã phòng và thử lại.')), 15000);
      conn.on('open', () => {
        window.clearTimeout(timer);
        this.wire(conn, hostId, false);
        const off = this.onMessage((msg) => {
          if (msg.t === 'welcome') {
            window.clearTimeout(welcomeTimer);
            this.seed = msg.seed;
            if (msg.meet && Number.isFinite(msg.x) && Number.isFinite(msg.y)) {
              this.setMeetPoint(msg.x, msg.y);
            }
            off();
            resolve();
          }
        });
        const welcomeTimer = window.setTimeout(() => {
          off();
          reject(new Error('Chủ phòng không phản hồi.'));
        }, 10000);
      });
      conn.on('error', (e) => {
        window.clearTimeout(timer);
        reject(e);
      });
    });
  }

  private accept(conn: DataConnection): void {
    if (this.conns.size >= MAX_PEERS - 1) {
      conn.on('open', () => conn.close());
      return;
    }
    conn.on('open', () => {
      this.wire(conn, conn.peer, true);
      const welcome: WelcomeMsg = {
        t: 'welcome',
        seed: this.seed,
        hostId: this.peerId,
        x: this.meetX,
        y: this.meetY,
        meet: this.meetValid,
      };
      try {
        conn.send(welcome);
      } catch (e) {
        console.warn('[multi] welcome failed', e);
      }
    });
  }

  private wire(conn: DataConnection, id: string, announceJoin: boolean): void {
    this.conns.set(id, conn);
    if (announceJoin) {
      for (const h of this.joinHandlers) {
        try {
          h(id);
        } catch (e) {
          console.error(e);
        }
      }
    }
    // Client side: also notify when the host link is ready.
    if (!announceJoin && this.role === 'client') {
      for (const h of this.joinHandlers) {
        try {
          h(id);
        } catch (e) {
          console.error(e);
        }
      }
    }
    conn.on('data', (data) => {
      const msg = decode(data);
      if (!msg) return;
      this.emit(msg, id);
      // Host relays to everyone else (except welcome).
      if (this.role === 'host' && msg.t !== 'welcome') {
        for (const [pid, c] of this.conns) {
          if (pid === id || !c.open) continue;
          if (msg.t === 'hit' && msg.to !== pid) continue;
          try {
            c.send(msg);
          } catch (e) {
            console.warn('[multi] relay failed', e);
          }
        }
      }
    });
    conn.on('close', () => {
      this.conns.delete(id);
      this.emit({ t: 'peerGone', from: id }, id);
      if (this.role === 'host') {
        for (const c of this.conns.values()) {
          if (!c.open) continue;
          try {
            c.send({ t: 'peerGone', from: id } satisfies PeerGoneMsg);
          } catch {
            /* ignore */
          }
        }
      }
    });
  }

  private emit(msg: NetMsg, from: string): void {
    for (const h of this.handlers) {
      try {
        h(msg, from);
      } catch (e) {
        console.error(e);
      }
    }
  }
}
