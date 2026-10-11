import type { BrowserContext, Page } from 'playwright';
import {
  FloodWaitError,
  NotLoggedInError,
  PeerNotFoundError,
  RpcError,
  TelegramWebError,
  TimeoutError,
  toRpcError,
} from './errors.js';
import {
  decodeSession,
  encodeSession,
  exportFromPage,
  loadSessionFile,
  saveSessionFile,
  type DirectSession,
} from './direct/session.js';
import { DirectTransport, type InvokeResult } from './direct/transport.js';
import { BRIDGE_SCRIPT } from './internal/bridge.js';
import { Chat } from './models/chat.js';
import { Dialog } from './models/dialog.js';
import { Entities, type Entity } from './models/entities.js';
import { Message } from './models/message.js';
import { User } from './models/user.js';
import { parsePeerLike, peerIdOf, type PeerId, type PeerLike } from './peers.js';
import { Result } from './result.js';
import { randomLong, sleep } from './utils.js';

export interface ClientOptions {
  /**
   * `browser` (default): every call goes through Telegram Web in Playwright.
   * `direct`: the browser is only used to log in once; its auth key is then
   * exported and all calls go straight to Telegram over MTProto (GramJS) —
   * no browser running, much faster. UI helpers (openChat, sendMessageUI,
   * screenshot) and `callManager`/`on` are browser-only.
   */
  mode?: 'browser' | 'direct';
  /**
   * Direct mode: a session string from `exportSession()`. Lets you run with no
   * browser and no session dir at all (e.g. on a server). Implies `mode: 'direct'`.
   */
  session?: string;
  /** Hide the browser window. Default `true`. Use `false` for the first login (QR scan) or to watch. */
  headless?: boolean;
  /** Chromium profile dir holding the Telegram session. One dir per account. Default `.telegram-session`. */
  sessionDir?: string;
  /** Slow every Playwright action down by N ms (handy to watch what happens). */
  slowMo?: number;
  /** Auto-sleep and retry on `FLOOD_WAIT_X` when X ≤ this many seconds. Default 60. */
  floodSleepThreshold?: number;
  /** Log what the client is doing. Default `true`. */
  verbose?: boolean;
  userAgent?: string;
  proxy?: { server: string; username?: string; password?: string };
  /** Default `https://web.telegram.org/k/`. Only the K client is supported. */
  url?: string;
}

export interface LoginOptions {
  /** How long to wait for you to scan the QR code / finish login. Default 5 min. */
  timeoutMs?: number;
  /** 2FA cloud password, typed in for you when Telegram asks for it. */
  password?: string;
  /** In headless mode, the login page (with QR) is screenshotted here. Default `telegram-login.png`. */
  qrScreenshotPath?: string;
}

export interface GetDialogsOptions {
  limit?: number;
  /** 0 = main list, 1 = archive. */
  folderId?: number;
  excludePinned?: boolean;
}

export interface GetHistoryOptions {
  limit?: number;
  /** Start from this message id (exclusive), going back in time. */
  offsetId?: number;
  /** Only messages newer than this id. */
  minId?: number;
  /** Only messages older than this id. */
  maxId?: number;
  /** Start from this unix date, going back. */
  offsetDate?: number;
}

export interface SendMessageOptions {
  replyTo?: number;
  silent?: boolean;
  /** Unix seconds — schedule instead of sending now. */
  scheduleDate?: number;
  noWebpage?: boolean;
  /**
   * Show "typing…" to the recipient before sending. `true` = duration based on
   * text length (1–6 s), or a number of ms.
   */
  typing?: boolean | number;
  /**
   * `app` (default): send through Telegram Web's own pipeline — the message
   * appears in the open window exactly as if you'd sent it.
   * `api`: raw `messages.sendMessage` call; the open window won't show it until reload.
   * `noWebpage` and direct mode always use `api`.
   */
  via?: 'app' | 'api';
}

export interface RecentConversationsOptions {
  /** How many people. Default 10. */
  limit?: number;
  /** Messages to fetch per conversation (newest first). Default 20; 0 = none. */
  messagesPerChat?: number;
  /** Include chats with bots. Default false. */
  includeBots?: boolean;
  /** Include archived chats. Default false. */
  includeArchived?: boolean;
}

export interface Conversation {
  dialog: Dialog;
  user: User;
  /** Newest first. */
  messages: Result<Message>;
}

export interface ContactedSinceOptions {
  /** Include bots. Default false. */
  includeBots?: boolean;
  /** Also fetch each person's bio (one extra request per person). Default true. */
  withProfile?: boolean;
}

export interface ContactedPerson {
  user: User;
  dialog: Dialog;
  /** Your most recent message to them. */
  lastOutgoing: Message;
  /** How many messages you sent them since the date. */
  sentCount: number;
  /** Profile bio ("" if none), when `withProfile`. */
  about?: string;
}

export interface SearchOptions {
  /** Search inside one chat; omit for a global search across all chats. */
  peer?: PeerLike;
  limit?: number;
}

type EventHandler = (payload: any) => void;

const DEFAULT_URL = 'https://web.telegram.org/k/';
const J = JSON.stringify;
/** The chat's message box (Web K also renders a hidden `-fake` twin for measuring). */
const COMPOSER = '.input-message-input[contenteditable="true"]:not(.input-field-input-fake)';

/**
 * Drives your real Telegram account through web.telegram.org.
 *
 * Calls go through the web app's own logged-in MTProto client (the real
 * Telegram API, not the Bot API), so you get structured data without
 * scraping the DOM — while still seeing everything happen in the window.
 *
 * ```ts
 * const tg = await TelegramClient.launch({ headless: false });
 * await tg.login();
 * for (const d of await tg.getDialogs({ limit: 20 })) console.log(d.toString());
 * await tg.sendMessage('@someone', 'Hello!');
 * ```
 */
export class TelegramClient {
  readonly options: Required<Pick<ClientOptions, 'headless' | 'sessionDir' | 'floodSleepThreshold' | 'verbose' | 'url'>> &
    ClientOptions;
  context!: BrowserContext;
  page!: Page;
  /** Set in direct mode once connected. */
  direct?: DirectTransport;
  /** Your own user id, set after login. */
  myId: PeerId = 0;

  private handlers = new Map<string, Set<EventHandler>>();
  private peerCache = new Map<string, PeerId>();

  constructor(options: ClientOptions = {}) {
    this.options = {
      headless: true,
      sessionDir: '.telegram-session',
      floodSleepThreshold: 60,
      verbose: true,
      url: DEFAULT_URL,
      ...options,
    };
  }

  /** Create a client and open Telegram Web. */
  static async launch(options: ClientOptions = {}): Promise<TelegramClient> {
    const client = new TelegramClient(options);
    await client.start();
    return client;
  }

  // ---------------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.options.mode === 'direct' || this.options.session) {
      const saved = this.options.session ? decodeSession(this.options.session) : loadSessionFile(this.options.sessionDir);
      if (saved) return this.connectDirect(saved);
      this.log('direct mode: no exported session yet — using the browser to get one');
    }
    await this.startBrowser();
    if (this.options.mode === 'direct' && (await this.isLoggedIn())) await this.switchToDirect();
  }

  private async startBrowser(): Promise<void> {
    const { chromium } = await import('playwright');
    const { headless, sessionDir, slowMo, proxy, url } = this.options;
    const userAgent = this.options.userAgent ?? (headless ? await headfulUserAgent() : undefined);

    this.context = await chromium.launchPersistentContext(sessionDir, {
      headless,
      slowMo,
      proxy,
      userAgent,
      viewport: { width: 1280, height: 860 },
      args: ['--disable-blink-features=AutomationControlled'],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    await this.context.exposeBinding('__tgwEmit', (_src, name: string, payload: unknown) =>
      this.dispatch(name, payload),
    );
    await this.context.addInitScript({ content: BRIDGE_SCRIPT });

    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    // The app may reload itself (e.g. after login); re-attach event listeners.
    this.page.on('load', () => void this.resubscribe().catch(() => {}));

    this.log(`opening ${url} (${headless ? 'headless' : 'headed'}, session: ${sessionDir})`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.waitReady();

    const { state, myId } = await this.authState();
    if (state === 'authStateSignedIn') {
      this.myId = myId || this.myId;
      this.log('session restored — logged in');
    } else {
      this.log('not logged in — call login()');
    }
  }

  async close(): Promise<void> {
    await this.direct?.disconnect();
    await this.context?.close();
  }

  private async connectDirect(session: DirectSession): Promise<void> {
    const t = Date.now();
    this.direct = await DirectTransport.connect(session, {
      peersDir: this.options.session ? undefined : this.options.sessionDir,
      verbose: this.options.verbose,
    });
    this.myId = session.userId;
    this.log(`direct mode: connected to DC${session.dcId} in ${Date.now() - t} ms (no browser)`);
  }

  /** Export the browser session's auth key, close the browser, and continue directly. */
  private async switchToDirect(): Promise<void> {
    const session = await exportFromPage(this.page);
    const path = saveSessionFile(this.options.sessionDir, session);
    this.log(`direct mode: session exported to ${path}`);
    await this.context.close();
    this.context = undefined as any;
    this.page = undefined as any;
    await this.connectDirect(session);
  }

  /**
   * The session as a string (base64 JSON). Pass it as `{ session }` to run
   * anywhere with no browser. **It is your login — keep it secret.**
   */
  async exportSession(): Promise<string> {
    if (this.direct) return encodeSession(this.direct.session);
    if (!(await this.isLoggedIn())) throw new NotLoggedInError();
    return encodeSession(await exportFromPage(this.page));
  }

  /** `direct` once connected over MTProto, otherwise `browser`. */
  get activeMode(): 'browser' | 'direct' {
    return this.direct ? 'direct' : 'browser';
  }

  private requirePage(what: string): Page {
    if (!this.page) throw new TelegramWebError(`${what} needs the browser — not available in direct mode`);
    return this.page;
  }

  /** Wait until the web app's API bridge is available. */
  async waitReady(timeoutMs = 60_000): Promise<void> {
    if (this.direct) return;
    await this.page.waitForFunction('!!(window.__tgw && window.__tgw.ready())', null, { timeout: timeoutMs });
  }

  // ---------------------------------------------------------------------------
  // auth
  // ---------------------------------------------------------------------------

  async authState(): Promise<{ state: string | null; myId: number }> {
    if (this.direct) return { state: 'authStateSignedIn', myId: this.myId };
    try {
      return await this.page.evaluate('window.__tgw.authState()');
    } catch {
      // Page navigating mid-call.
      return { state: null, myId: 0 };
    }
  }

  async isLoggedIn(): Promise<boolean> {
    return (await this.authState()).state === 'authStateSignedIn';
  }

  /**
   * Log in. If the session dir already holds a session this returns
   * immediately. Otherwise scan the QR code in the window (Telegram app →
   * Settings → Devices → Link Desktop Device), or log in by phone in the window.
   */
  async login(opts: LoginOptions = {}): Promise<User> {
    const { timeoutMs = 5 * 60_000, password, qrScreenshotPath = 'telegram-login.png' } = opts;
    if (this.direct) return this.getMe();

    if (!(await this.isLoggedIn())) {
      this.log(
        this.options.headless
          ? `waiting for login — scan the QR code saved to ${qrScreenshotPath}`
          : 'waiting for login — scan the QR code in the browser window (Telegram → Settings → Devices → Link Desktop Device)',
      );

      const deadline = Date.now() + timeoutMs;
      let passwordTyped = false;
      let lastShot = 0;

      while (Date.now() < deadline) {
        const { state } = await this.authState();
        if (state === 'authStateSignedIn') break;

        if (state === 'authStateSignPassword' && password && !passwordTyped) {
          const input = this.page.locator('input[type="password"]').first();
          if (await input.isVisible().catch(() => false)) {
            this.log('entering 2FA password');
            await input.fill(password);
            await input.press('Enter');
            passwordTyped = true;
          }
        }

        // The QR code rotates every ~30 s; keep the screenshot fresh (once it has rendered).
        if (this.options.headless && Date.now() - lastShot > 10_000) {
          const qr = this.page.locator('canvas[class*="qrCanvas"]').first();
          if (await qr.isVisible().catch(() => false)) {
            await this.page.screenshot({ path: qrScreenshotPath }).catch(() => {});
            lastShot = Date.now();
          }
        }
        await sleep(1000);
      }
      if (!(await this.isLoggedIn())) throw new TimeoutError(`Not logged in after ${timeoutMs / 1000}s`);
    }

    await this.page.waitForFunction('!!(window.rootScope && window.rootScope.myId)', null, { timeout: 60_000 });
    this.myId = (await this.authState()).myId;
    if (this.options.mode === 'direct') await this.switchToDirect();
    const me = await this.getMe();
    this.log(`logged in as ${me}`);
    return me;
  }

  private async ensureLoggedIn(): Promise<void> {
    if (this.myId) return;
    const { state, myId } = await this.authState();
    if (state !== 'authStateSignedIn') throw new NotLoggedInError();
    this.myId = myId;
  }

  // ---------------------------------------------------------------------------
  // raw access
  // ---------------------------------------------------------------------------

  /**
   * Call any MTProto method on your session — the full Telegram API
   * (https://core.telegram.org/methods). Params use the schema's snake_case
   * names; `true` flags are plain booleans (`{ silent: true }`); longs are
   * strings. Users/chats in the response are added to the peer cache.
   *
   * ```ts
   * await tg.invoke('messages.getDialogs', { offset_peer: { _: 'inputPeerEmpty' }, limit: 10, hash: '0' });
   * ```
   */
  async invoke<T = any>(method: string, params: Record<string, unknown> = {}, options?: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const r: InvokeResult = this.direct
        ? await this.direct.invoke(method, params)
        : await this.page.evaluate(`window.__tgw.invoke(${J(method)}, ${J(params)}, ${J(options ?? {})})`);
      if (r.ok) return r.value as T;
      const err = this.toError(r.error, method);
      if (err instanceof FloodWaitError && err.seconds <= this.options.floodSleepThreshold && attempt < 3) {
        this.log(`${method}: flood wait ${err.seconds}s, sleeping…`);
        await sleep(err.seconds * 1000 + 500);
        continue;
      }
      throw err;
    }
  }

  /**
   * Call a method on one of Telegram Web's internal managers
   * (`appMessagesManager`, `appUsersManager`, `appPeersManager`, `appChatsManager`, …).
   * Not a stable API — prefer `invoke()` when an MTProto method exists.
   */
  async callManager<T = any>(manager: string, method: string, ...args: unknown[]): Promise<T> {
    const r: any = await this.requirePage('callManager()').evaluate(`window.__tgw.call(${J(manager)}, ${J(method)}, ${J(args)})`);
    if (r.ok) return r.value as T;
    throw this.toError(r.error, `${manager}.${method}`);
  }

  private toError(error: { type?: string; code?: number }, method: string): Error {
    if (error.code === 401 || error.type === 'AUTH_KEY_UNREGISTERED') return new NotLoggedInError();
    return toRpcError(error, method);
  }

  // ---------------------------------------------------------------------------
  // peers
  // ---------------------------------------------------------------------------

  /**
   * Resolve a username / phone / id to a peer id, making sure the web app knows
   * the peer (so it can be messaged).
   */
  async resolvePeer(peer: PeerLike): Promise<PeerId> {
    const p = parsePeerLike(peer);
    if (p.kind === 'id') return p.peerId;

    const key = p.kind === 'username' ? `@${p.username}` : `+${p.phone}`;
    const cached = this.peerCache.get(key);
    if (cached) return cached;

    let peerId: PeerId;
    try {
      if (this.direct) {
        // Users/chats in the response land in the transport's peer cache.
        const res =
          p.kind === 'username'
            ? await this.invoke('contacts.resolveUsername', { username: p.username })
            : await this.invoke('contacts.resolvePhone', { phone: p.phone });
        peerId = peerIdOf(res.peer);
      } else {
        const entity =
          p.kind === 'username'
            ? await this.callManager('appUsersManager', 'resolveUsername', p.username)
            : await this.callManager('appUsersManager', 'resolvePhone', p.phone);
        if (!entity?._) throw new PeerNotFoundError(peer);
        peerId = entity._ === 'user' ? Number(entity.id) : -Number(entity.id);
      }
    } catch (e) {
      if (e instanceof RpcError && /NOT_OCCUPIED|INVALID|NOT_FOUND/.test(e.type)) throw new PeerNotFoundError(peer, e.type);
      throw e;
    }
    this.peerCache.set(key, peerId);
    return peerId;
  }

  /** The MTProto `InputPeer` for a peer (with its access hash). */
  async getInputPeer(peer: PeerLike): Promise<any> {
    const peerId = await this.resolvePeer(peer);
    try {
      const input = this.direct
        ? this.direct.getInputPeer(peerId, this.myId)
        : await this.callManager('appPeersManager', 'getInputPeerById', peerId);
      if (!input) throw new Error();
      if (input._ !== 'inputPeerChat' && input.access_hash === undefined && input._ !== 'inputPeerSelf') throw new Error();
      return input;
    } catch {
      throw new PeerNotFoundError(
        peer,
        'unknown to this session. Resolve it by @username/+phone first, or load it via getDialogs()/getHistory().',
      );
    }
  }

  /** User or Chat for a peer. */
  async getEntity(peer: PeerLike): Promise<Entity> {
    const peerId = await this.resolvePeer(peer);
    const raw = this.direct ? this.direct.getPeer(peerId) : await this.callManager('appPeersManager', 'getPeer', peerId);
    if (!raw?._ || raw._ === 'userEmpty' || raw._ === 'chatEmpty') throw new PeerNotFoundError(peer);
    return raw._ === 'user' ? new User(raw) : new Chat(raw);
  }

  async getMe(): Promise<User> {
    const [me] = await this.invoke<any[]>('users.getUsers', { id: [{ _: 'inputUserSelf' }] });
    this.myId = Number(me.id);
    return new User(me);
  }

  /** Full user profile (bio, common chats count…) — raw `users.userFull`. */
  async getFullUser(peer: PeerLike): Promise<{ user: User; about?: string; commonChatsCount: number; raw: any }> {
    const input = await this.getInputPeer(peer);
    if (input._ !== 'inputPeerUser' && input._ !== 'inputPeerSelf') throw new TypeError('getFullUser needs a user');
    const id =
      input._ === 'inputPeerSelf' ? { _: 'inputUserSelf' } : { _: 'inputUser', user_id: input.user_id, access_hash: input.access_hash };
    const res = await this.invoke('users.getFullUser', { id });
    const user = Entities.fromResponse(res).user(Number(res.full_user.id))!;
    return { user, about: res.full_user.about, commonChatsCount: res.full_user.common_chats_count ?? 0, raw: res };
  }

  async getContacts(): Promise<User[]> {
    const res = await this.invoke('contacts.getContacts', { hash: '0' });
    return (res.users ?? []).filter((u: any) => u._ === 'user').map((u: any) => new User(u));
  }

  // ---------------------------------------------------------------------------
  // dialogs & messages
  // ---------------------------------------------------------------------------

  /** One page of your chat list, newest first. Use `.next()` for more. */
  async getDialogs(opts: GetDialogsOptions = {}): Promise<Result<Dialog>> {
    await this.ensureLoggedIn();
    return this.fetchDialogs(opts, { offset_date: 0, offset_id: 0, offset_peer: { _: 'inputPeerEmpty' } });
  }

  private async fetchDialogs(opts: GetDialogsOptions, offset: Record<string, unknown>): Promise<Result<Dialog>> {
    const limit = opts.limit ?? 50;
    const res = await this.invoke('messages.getDialogs', {
      ...offset,
      limit,
      hash: '0',
      ...(opts.folderId !== undefined ? { folder_id: opts.folderId } : {}),
      ...(opts.excludePinned ? { exclude_pinned: true } : {}),
    });
    if (res._ === 'messages.dialogsNotModified') return Result.from_([]);

    const entities = Entities.fromResponse(res);
    const messages = new Map<string, Message>();
    for (const m of res.messages ?? []) {
      const msg = new Message(m, { entities, myId: this.myId });
      messages.set(`${msg.peerId}:${msg.id}`, msg);
    }
    const dialogs: Dialog[] = (res.dialogs ?? []).map((d: any) => new Dialog(d, entities, messages));

    const last = dialogs[dialogs.length - 1];
    const more = res._ === 'messages.dialogsSlice' && dialogs.length === limit && last?.topMessage;
    const fetchNext = more
      ? async () =>
          this.fetchDialogs(opts, {
            offset_date: last.topMessage!.date,
            offset_id: last.topMessageId,
            offset_peer: await this.getInputPeer(last.peerId),
          })
      : undefined;
    return Result.from_(dialogs, fetchNext, res.count ?? dialogs.length);
  }

  /** Iterate over every dialog (paginating for you). */
  async *iterDialogs(opts: GetDialogsOptions = {}): AsyncGenerator<Dialog> {
    let page = await this.getDialogs(opts);
    while (page.length) {
      yield* page;
      if (!page.hasNext) return;
      page = await page.next();
    }
  }

  /**
   * Your most recent private conversations (people, not groups/channels), each
   * with its latest messages — newest conversation first.
   *
   * ```ts
   * for (const { user, messages } of await tg.getRecentConversations({ limit: 10 })) {
   *   console.log(user.name, messages.map((m) => m.text));
   * }
   * ```
   */
  async getRecentConversations(opts: RecentConversationsOptions = {}): Promise<Conversation[]> {
    const { limit = 10, messagesPerChat = 20, includeBots = false, includeArchived = false } = opts;

    // Pinned chats come first regardless of date; collect them plus the first
    // `limit` unpinned ones (already date-ordered), then sort by last activity.
    const candidates: Dialog[] = [];
    let unpinned = 0;
    for await (const d of this.iterDialogs({ limit: 100, folderId: includeArchived ? undefined : 0 })) {
      const u = d.entity;
      if (!(u instanceof User) || u.isSelf || u.isDeleted || u.id === 777000 || (u.isBot && !includeBots)) continue;
      candidates.push(d);
      if (!d.isPinned && ++unpinned >= limit) break;
    }
    const recent = candidates
      .sort((a, b) => (b.topMessage?.date ?? 0) - (a.topMessage?.date ?? 0))
      .slice(0, limit);

    const out: Conversation[] = [];
    for (const dialog of recent) {
      const messages = messagesPerChat > 0 ? await this.getHistory(dialog.peerId, { limit: messagesPerChat }) : Result.from_<Message>([]);
      out.push({ dialog, user: dialog.entity as User, messages });
    }
    return out;
  }

  /**
   * People you've sent at least one message to since `since` (private chats,
   * all folders incl. archive), most recent first — optionally with their bio.
   *
   * ```ts
   * for (const c of await tg.getContactedSince(new Date('2026-10-03T00:00'))) console.log(c.user.username, c.about);
   * ```
   */
  async getContactedSince(since: Date, opts: ContactedSinceOptions = {}): Promise<ContactedPerson[]> {
    const { includeBots = false, withProfile = true } = opts;
    const sinceTs = Math.floor(since.getTime() / 1000);
    const out: ContactedPerson[] = [];

    for await (const dialog of this.iterDialogs({ limit: 100 })) {
      const lastDate = dialog.topMessage?.date ?? 0;
      // Unpinned dialogs are ordered by last activity: everything after this is older.
      if (!dialog.isPinned && lastDate && lastDate < sinceTs) break;
      const u = dialog.entity;
      if (!(u instanceof User) || u.isSelf || u.isDeleted || u.id === 777000 || (u.isBot && !includeBots)) continue;
      if (lastDate < sinceTs) continue;

      let lastOutgoing: Message | undefined;
      let sentCount = 0;
      for await (const m of this.iterHistory(dialog.peerId, { limit: 100 })) {
        if (m.date < sinceTs) break;
        if (m.isOutgoing) {
          lastOutgoing ??= m;
          sentCount++;
        }
      }
      if (lastOutgoing) out.push({ user: u, dialog, lastOutgoing, sentCount });
    }

    if (withProfile) {
      for (const c of out) {
        c.about = (await this.getFullUser(c.user.peerId)).about ?? '';
        await sleep(250); // stay well under rate limits
      }
    }
    return out;
  }

  /** Dialogs with unread messages (scans up to `maxDialogs`). */
  async getUnreadDialogs(maxDialogs = 500): Promise<Dialog[]> {
    const out: Dialog[] = [];
    let seen = 0;
    for await (const d of this.iterDialogs({ limit: 100 })) {
      if (d.isUnread) out.push(d);
      if (++seen >= maxDialogs) break;
    }
    return out;
  }

  /** One page of a chat's messages, newest first. Use `.next()` for older ones. */
  async getHistory(peer: PeerLike, opts: GetHistoryOptions = {}): Promise<Result<Message>> {
    await this.ensureLoggedIn();
    const input = await this.getInputPeer(peer);
    const limit = opts.limit ?? 50;
    const res = await this.invoke('messages.getHistory', {
      peer: input,
      offset_id: opts.offsetId ?? 0,
      offset_date: opts.offsetDate ?? 0,
      add_offset: 0,
      limit,
      max_id: opts.maxId ?? 0,
      min_id: opts.minId ?? 0,
      hash: '0',
    });
    return this.messagesResult(res, limit, (offsetId) => this.getHistory(peer, { ...opts, offsetId, offsetDate: 0 }));
  }

  /** Iterate a chat's whole history, newest → oldest. */
  async *iterHistory(peer: PeerLike, opts: GetHistoryOptions = {}): AsyncGenerator<Message> {
    let page = await this.getHistory(peer, opts);
    while (page.length) {
      yield* page;
      if (!page.hasNext) return;
      page = await page.next();
    }
  }

  /** Search messages in one chat (`peer`) or across all chats. */
  async searchMessages(query: string, opts: SearchOptions = {}): Promise<Result<Message>> {
    await this.ensureLoggedIn();
    const limit = opts.limit ?? 50;
    const filter = { _: 'inputMessagesFilterEmpty' };
    if (opts.peer !== undefined) {
      const res = await this.invoke('messages.search', {
        peer: await this.getInputPeer(opts.peer),
        q: query,
        filter,
        min_date: 0,
        max_date: 0,
        offset_id: 0,
        add_offset: 0,
        limit,
        max_id: 0,
        min_id: 0,
        hash: '0',
      });
      return this.messagesResult(res, limit);
    }
    const res = await this.invoke('messages.searchGlobal', {
      q: query,
      filter,
      min_date: 0,
      max_date: 0,
      offset_rate: 0,
      offset_peer: { _: 'inputPeerEmpty' },
      offset_id: 0,
      limit,
    });
    return this.messagesResult(res, limit);
  }

  private messagesResult(
    res: any,
    limit: number,
    nextFrom?: (offsetId: number) => Promise<Result<Message>>,
  ): Result<Message> {
    const entities = Entities.fromResponse(res);
    const msgs: Message[] = (res.messages ?? [])
      .filter((m: any) => m._ !== 'messageEmpty')
      .map((m: any) => new Message(m, { entities, myId: this.myId }));
    const oldest = msgs[msgs.length - 1];
    const fetchNext = nextFrom && msgs.length === limit && oldest ? () => nextFrom(oldest.id) : undefined;
    return Result.from_(msgs, fetchNext, res.count ?? msgs.length);
  }

  /**
   * Send a text message.
   *
   * ```ts
   * await tg.sendMessage('@durov', 'Hi!', { typing: true });
   * await tg.sendMessage('+33612345678', 'Hi!');
   * await tg.sendMessage(dialog, 'Hi!');
   * ```
   */
  async sendMessage(peer: PeerLike, text: string, opts: SendMessageOptions = {}): Promise<Message> {
    await this.ensureLoggedIn();
    const input = await this.getInputPeer(peer); // validates the peer is reachable
    const peerId = await this.resolvePeer(peer);

    if (opts.typing) {
      const ms = typeof opts.typing === 'number' ? opts.typing : Math.min(6000, Math.max(1000, text.length * 45));
      await this.setTyping(peerId);
      await sleep(ms);
    }

    // The app pipeline has no "disable link preview" switch, so use the raw call for that.
    if (opts.via === 'api' || opts.noWebpage || this.direct) {
      const res = await this.invoke('messages.sendMessage', {
        peer: input,
        message: text,
        random_id: randomLong(),
        ...(opts.replyTo ? { reply_to: { _: 'inputReplyToMessage', reply_to_msg_id: opts.replyTo } } : {}),
        ...(opts.silent ? { silent: true } : {}),
        ...(opts.noWebpage ? { no_webpage: true } : {}),
        ...(opts.scheduleDate ? { schedule_date: opts.scheduleDate } : {}),
      });
      const sent = findSentMessage(res);
      return new Message(
        sent?.message ?? {
          _: 'message',
          id: sent?.id ?? 0,
          peerId,
          message: text,
          date: sent?.date ?? Math.floor(Date.now() / 1000),
          pFlags: { out: true },
        },
        { entities: Entities.fromResponse(res), myId: this.myId },
      );
    }

    // Through the web app's pipeline: wait for its `message_sent` confirmation.
    const sent = opts.scheduleDate
      ? Promise.resolve(undefined)
      : this.waitForEvent('message_sent', (e) => Number(e?.message?.peerId) === peerId, 30_000);
    await this.callManager('appMessagesManager', 'sendText', {
      peerId,
      text,
      replyToMsgId: opts.replyTo,
      silent: opts.silent,
      scheduleDate: opts.scheduleDate,
      clearDraft: true,
    });
    const evt = await sent;
    return new Message(
      evt?.message ?? { _: 'message', mid: 0, peerId, message: text, date: opts.scheduleDate ?? 0, pFlags: { out: true } },
      { myId: this.myId },
    );
  }

  /** Show "typing…" in a chat (lasts ~5 s, or until you send). */
  async setTyping(peer: PeerLike): Promise<void> {
    await this.invoke('messages.setTyping', {
      peer: await this.getInputPeer(peer),
      action: { _: 'sendMessageTypingAction' },
    });
  }

  /** Mark a chat as read (up to `maxId`, default everything). */
  async markAsRead(peer: PeerLike, maxId = 0): Promise<void> {
    const input = await this.getInputPeer(peer);
    if (input._ === 'inputPeerChannel') {
      await this.invoke('channels.readHistory', {
        channel: { _: 'inputChannel', channel_id: input.channel_id, access_hash: input.access_hash },
        max_id: maxId,
      });
    } else {
      await this.invoke('messages.readHistory', { peer: input, max_id: maxId });
    }
  }

  // ---------------------------------------------------------------------------
  // real-time
  // ---------------------------------------------------------------------------

  /**
   * Listen for new messages as they arrive. Returns an unsubscribe function.
   *
   * ```ts
   * const stop = await tg.onMessage((m) => console.log(m.toString()));
   * ```
   */
  async onMessage(
    handler: (message: Message) => void | Promise<void>,
    opts: { includeOutgoing?: boolean } = {},
  ): Promise<() => void> {
    if (this.direct) {
      return this.direct.onNewMessage((raw) => {
        const msg = new Message(raw, { myId: this.myId });
        if (msg.isOutgoing && !opts.includeOutgoing) return;
        void Promise.resolve(handler(msg)).catch((e) => this.log(`onMessage handler error: ${e}`));
      });
    }
    return this.on('history_multiappend', (raw) => {
      const msg = new Message(raw, { myId: this.myId });
      if (msg.isOutgoing && !opts.includeOutgoing) return;
      void Promise.resolve(handler(msg)).catch((e) => this.log(`onMessage handler error: ${e}`));
    });
  }

  /**
   * Subscribe to any Telegram Web `rootScope` event (`history_multiappend`,
   * `message_sent`, `dialog_unread`, `user_update`, …). Returns an unsubscribe function.
   */
  async on(event: string, handler: EventHandler): Promise<() => void> {
    let set = this.handlers.get(event);
    if (!set) {
      this.handlers.set(event, (set = new Set()));
      await this.requirePage('on()').evaluate(`window.__tgw.subscribe(${J(event)})`);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  /** Resolve with the next `event` payload matching `predicate`. */
  async waitForEvent(event: string, predicate: (payload: any) => boolean = () => true, timeoutMs = 30_000): Promise<any> {
    let off: () => void = () => {};
    let timer: NodeJS.Timeout;
    const done = new Promise<any>((resolve, reject) => {
      timer = setTimeout(() => reject(new TimeoutError(`No "${event}" event within ${timeoutMs} ms`)), timeoutMs);
      void this.on(event, (p) => {
        if (predicate(p)) resolve(p);
      }).then((unsub) => (off = unsub));
    });
    return done.finally(() => {
      clearTimeout(timer);
      off();
    });
  }

  private dispatch(event: string, payload: unknown): void {
    for (const h of this.handlers.get(event) ?? []) {
      try {
        h(payload);
      } catch (e) {
        this.log(`handler for ${event} threw: ${e}`);
      }
    }
  }

  private async resubscribe(): Promise<void> {
    if (!this.handlers.size) return;
    await this.waitReady();
    for (const event of this.handlers.keys()) await this.page.evaluate(`window.__tgw.subscribe(${J(event)})`);
  }

  // ---------------------------------------------------------------------------
  // UI (what you'd do with mouse & keyboard)
  // ---------------------------------------------------------------------------

  /** Open a chat in the window. */
  async openChat(peer: PeerLike): Promise<void> {
    const peerId = await this.resolvePeer(peer);
    await this.requirePage('openChat()').evaluate(`window.appImManager.setInnerPeer({ peerId: ${J(peerId)} })`);
    await this.page
      .locator(COMPOSER)
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .catch(() => {}); // channels you can't post in have no composer
  }

  /**
   * Send by actually typing into the chat's composer, like a human. Slower
   * than `sendMessage()`, and depends on Telegram Web's DOM.
   */
  async sendMessageUI(peer: PeerLike, text: string, opts: { keyDelayMs?: number } = {}): Promise<void> {
    this.requirePage('sendMessageUI()');
    await this.openChat(peer);
    const input = this.page.locator(COMPOSER).first();
    await input.click();
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i) await this.page.keyboard.press('Shift+Enter');
      await this.page.keyboard.type(lines[i], { delay: opts.keyDelayMs ?? 35 });
    }
    await this.page.keyboard.press('Enter');
  }

  async screenshot(path: string): Promise<void> {
    await this.requirePage('screenshot()').screenshot({ path });
  }

  private log(msg: string): void {
    if (this.options.verbose) console.log(`[telegram] ${msg}`);
  }
}

/** Pull `{ id, date, message? }` of the sent message out of a sendMessage `Updates` response. */
function findSentMessage(res: any): { id: number; date: number; message?: any } | undefined {
  if (res?._ === 'updateShortSentMessage') return { id: res.id, date: res.date };
  for (const u of res?.updates ?? []) {
    if (u._ === 'updateNewMessage' || u._ === 'updateNewChannelMessage' || u._ === 'updateNewScheduledMessage')
      return { id: u.message.id, date: u.message.date, message: u.message };
  }
  const idUpdate = (res?.updates ?? []).find((u: any) => u._ === 'updateMessageID');
  return idUpdate ? { id: idUpdate.id, date: res.date } : undefined;
}

/** Headless Chromium advertises "HeadlessChrome"; present as regular Chrome instead. */
async function headfulUserAgent(): Promise<string> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    return (await page.evaluate(() => navigator.userAgent)).replace('HeadlessChrome', 'Chrome');
  } finally {
    await browser.close();
  }
}

