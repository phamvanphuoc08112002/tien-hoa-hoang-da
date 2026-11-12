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
}

export interface HelloMsg {
  t: 'hello';
  from: string;
  speciesId: string;
  form: number;
  variant: string;
  name: string;
}

export interface LeaveMsg {
  t: 'leave';
  from: string;
}

export interface PeerGoneMsg {
  t: 'peerGone';
  from: string;
}

export type NetMsg = PlayerStateMsg | HitMsg | WelcomeMsg | HelloMsg | LeaveMsg | PeerGoneMsg;

export type NetHandler = (msg: NetMsg, from: string) => void;

function randomCode(n = 6): string {
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return s;
}

function peerIdFor(code: string): string {
  return PREFIX + code.toUpperCase();
}

/** Lightweight PeerJS room: host relays messages between clients. */
export class MultiRoom {
  readonly role: NetRole;
  readonly code: string;
  /** Local PeerJS id (host id equals thhd-CODE; clients get a random id). */
  peerId = '';
  seed: string;
  private peer: Peer | null = null;
  private conns = new Map<string, DataConnection>();
  private handlers: NetHandler[] = [];
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

  onMessage(fn: NetHandler): () => void {
    this.handlers.push(fn);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== fn);
    };
  }

  /** Broadcast to every connected peer (host also relays client → others). */
  send(msg: NetMsg): void {
    if (this.closed) return;
    const raw = JSON.stringify(msg);
    for (const c of this.conns.values()) {
      if (c.open) c.send(raw);
    }
  }

  /** Send to one peer id (host can reach anyone; client only reaches host who relays). */
  sendTo(peerId: string, msg: NetMsg): void {
    if (this.closed) return;
    if (this.role === 'host') {
      const c = this.conns.get(peerId);
      if (c?.open) c.send(JSON.stringify(msg));
      return;
    }
    // Client: ask host to deliver (embed target in hit.to already; host relays all non-welcome).
    this.send(msg);
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
    this.send({ t: 'leave', from: this.peer?.id ?? this.peerId });
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
      const timer = window.setTimeout(() => reject(new Error('Hết thời gian chờ chủ phòng.')), 12000);
      conn.on('open', () => {
        window.clearTimeout(timer);
        this.wire(conn, hostId);
        // Wait for welcome with seed.
        const off = this.onMessage((msg) => {
          if (msg.t === 'welcome') {
            window.clearTimeout(welcomeTimer);
            this.seed = msg.seed;
            off();
            resolve();
          }
        });
        const welcomeTimer = window.setTimeout(() => {
          off();
          reject(new Error('Chủ phòng không phản hồi.'));
        }, 8000);
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
      this.wire(conn, conn.peer);
      conn.send(JSON.stringify({ t: 'welcome', seed: this.seed, hostId: this.peerId } satisfies WelcomeMsg));
    });
  }

  private wire(conn: DataConnection, id: string): void {
    this.conns.set(id, conn);
    conn.on('data', (data) => {
      let msg: NetMsg;
      try {
        msg = typeof data === 'string' ? JSON.parse(data) : (data as NetMsg);
      } catch {
        return;
      }
      this.emit(msg, id);
      // Host relays to everyone else (except welcome).
      if (this.role === 'host' && msg.t !== 'welcome') {
        const raw = JSON.stringify(msg);
        for (const [pid, c] of this.conns) {
          if (pid === id || !c.open) continue;
          // Targeted hit: only forward to victim (and still emit locally above for host-as-victim).
          if (msg.t === 'hit' && msg.to !== pid) continue;
          c.send(raw);
        }
      }
    });
    conn.on('close', () => {
      this.conns.delete(id);
      this.emit({ t: 'peerGone', from: id }, id);
      if (this.role === 'host') {
        const raw = JSON.stringify({ t: 'peerGone', from: id } satisfies PeerGoneMsg);
        for (const c of this.conns.values()) if (c.open) c.send(raw);
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
