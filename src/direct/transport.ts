import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { PeerId } from '../peers.js';
import { DC_ADDRESSES, type DirectSession } from './session.js';
import { fromGram, loadGram, toGram } from './tl.js';

const require_ = createRequire(import.meta.url);
const PEERS_FILE = 'free-telegram-api.peers.json';

export type InvokeResult = { ok: true; value: any } | { ok: false; error: { type: string; code?: number } };

/**
 * Browser-free transport: GramJS speaking MTProto directly with an auth key
 * exported from Telegram Web. Requests/results use the same plain TL shape as
 * the browser bridge, so the client above doesn't care which one it talks to.
 */
export class DirectTransport {
  private client: any;
  /** peerId → plain TL user/chat (needed for access hashes). */
  private peers = new Map<PeerId, any>();
  private dirty = false;

  private constructor(
    readonly session: DirectSession,
    private readonly peersDir?: string,
  ) {}

  static async connect(session: DirectSession, opts: { peersDir?: string; floodSleepThreshold?: number; verbose?: boolean } = {}) {
    const t = new DirectTransport(session, opts.peersDir);
    t.loadPeers();
    loadGram();
    const { TelegramClient } = require_('telegram');
    const { StringSession } = require_('telegram/sessions');
    const { AuthKey } = require_('telegram/crypto/AuthKey');
    const { Logger, LogLevel } = require_('telegram/extensions/Logger');

    const ss = new StringSession('');
    ss.setDC(session.dcId, DC_ADDRESSES[session.dcId], 443);
    const key = new AuthKey();
    await key.setKey(Buffer.from(session.authKey, 'hex'));
    ss.setAuthKey(key);

    t.client = new TelegramClient(ss, session.apiId, session.apiHash, {
      connectionRetries: 5,
      autoReconnect: true,
      floodSleepThreshold: 0, // the client above handles FLOOD_WAIT itself
      deviceModel: session.deviceModel,
      systemVersion: session.systemVersion,
      appVersion: session.appVersion,
      systemLangCode: session.systemLangCode,
      langCode: 'en',
      baseLogger: new Logger(opts.verbose ? LogLevel.WARN : LogLevel.ERROR),
    });
    // GramJS always sends an empty lang_pack; Telegram Web sends "webk".
    if (t.client._initRequest) t.client._initRequest.langPack = session.langPack;
    await t.client.connect();
    return t;
  }

  async invoke(method: string, params: Record<string, unknown>): Promise<InvokeResult> {
    try {
      const req = toGram({ ...params, _: method });
      const value = fromGram(await this.client.invoke(req));
      this.savePeers(value);
      return { ok: true, value };
    } catch (e: any) {
      const type = e?.seconds !== undefined ? `FLOOD_WAIT_${e.seconds}` : (e?.errorMessage ?? e?.message ?? String(e));
      return { ok: false, error: { type, code: typeof e?.code === 'number' ? e.code : undefined } };
    }
  }

  /** Plain TL user/chat for a peer id, if this session has seen it. */
  getPeer(peerId: PeerId): any | undefined {
    return this.peers.get(peerId);
  }

  getInputPeer(peerId: PeerId, myId: PeerId): any | undefined {
    if (peerId === myId) return { _: 'inputPeerSelf' };
    const p = this.peers.get(peerId);
    if (!p) return undefined;
    if (p._ === 'user') return p.access_hash !== undefined ? { _: 'inputPeerUser', user_id: p.id, access_hash: p.access_hash } : undefined;
    if (p._ === 'chat' || p._ === 'chatForbidden') return { _: 'inputPeerChat', chat_id: p.id };
    if (p._ === 'channel' || p._ === 'channelForbidden')
      return p.access_hash !== undefined ? { _: 'inputPeerChannel', channel_id: p.id, access_hash: p.access_hash } : undefined;
    return undefined;
  }

  /** Subscribe to new messages (plain TL `message`). Returns an unsubscribe function. */
  onNewMessage(handler: (message: any) => void): () => void {
    const { NewMessage } = require_('telegram/events');
    const event = new NewMessage({});
    const cb = (e: any) => {
      const raw = fromGram(e.message);
      if (raw) handler(raw);
    };
    this.client.addEventHandler(cb, event);
    return () => this.client.removeEventHandler(cb, event);
  }

  async disconnect(): Promise<void> {
    this.flushPeers();
    await this.client?.destroy();
  }

  // -- peer cache --------------------------------------------------------------

  private savePeers(res: any): void {
    if (!res || typeof res !== 'object') return;
    const lists = [res.users, res.chats].filter(Array.isArray) as any[][];
    if (Array.isArray(res) && res.some((x) => x?._ === 'user')) lists.push(res);
    for (const list of lists) {
      for (const p of list) {
        if (!p?._ || p._ === 'userEmpty' || p._ === 'chatEmpty') continue;
        const peerId = p._ === 'user' ? Number(p.id) : -Number(p.id);
        const prev = this.peers.get(peerId);
        // "min" objects lack a usable access hash; keep the one we already have.
        if (p.pFlags?.min && prev?.access_hash) continue;
        this.peers.set(peerId, p);
        this.dirty = true;
      }
    }
    if (this.dirty) this.flushPeers();
  }

  private loadPeers(): void {
    if (!this.peersDir) return;
    const path = join(this.peersDir, PEERS_FILE);
    if (!existsSync(path)) return;
    for (const p of JSON.parse(readFileSync(path, 'utf8'))) this.peers.set(p._ === 'user' ? Number(p.id) : -Number(p.id), p);
  }

  private flushPeers(): void {
    if (!this.peersDir || !this.dirty) return;
    // Keep only what's needed to address and describe peers.
    const slim = [...this.peers.values()].map((p) => {
      const { _, id, access_hash, first_name, last_name, username, usernames, title, phone, pFlags } = p;
      return { _, id, access_hash, first_name, last_name, username, usernames, title, phone, pFlags };
    });
    writeFileSync(join(this.peersDir, PEERS_FILE), JSON.stringify(slim), { mode: 0o600 });
    this.dirty = false;
  }
}

