/** Base class for every error thrown by the library. */
export class TelegramWebError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** An MTProto RPC error returned by Telegram (e.g. `USERNAME_NOT_OCCUPIED`). */
export class RpcError extends TelegramWebError {
  constructor(
    /** Telegram error type, e.g. `PEER_FLOOD`, `FLOOD_WAIT_30`. */
    readonly type: string,
    readonly code: number | undefined,
    /** The MTProto method (or manager call) that failed. */
    readonly method: string,
  ) {
    super(`${method} failed: ${type}${code ? ` (${code})` : ''}`);
  }
}

/** `FLOOD_WAIT_X` — Telegram asks us to wait `seconds` before retrying. */
export class FloodWaitError extends RpcError {
  constructor(
    readonly seconds: number,
    code: number | undefined,
    method: string,
  ) {
    super(`FLOOD_WAIT_${seconds}`, code, method);
  }
}

/**
 * `PEER_FLOOD` — the account is limited for messaging people it has no
 * conversation with. Stop sending; see https://t.me/SpamBot.
 */
export class PeerFloodError extends RpcError {
  constructor(code: number | undefined, method: string) {
    super('PEER_FLOOD', code, method);
    this.message +=
      ' — this account is restricted from messaging non-contacts. Stop outreach and check @SpamBot.';
  }
}

export class NotLoggedInError extends TelegramWebError {
  constructor() {
    super('Not logged in to Telegram Web. Run client.login() with headless: false first.');
  }
}

export class PeerNotFoundError extends TelegramWebError {
  constructor(readonly peer: unknown, hint = '') {
    super(`Could not resolve peer ${JSON.stringify(peer)}${hint ? ` — ${hint}` : ''}`);
  }
}

export class TimeoutError extends TelegramWebError {}

/** Build the most specific error class for a raw error from the page. */
export function toRpcError(err: { type?: string; code?: number }, method: string): RpcError {
  const type = err.type || 'UNKNOWN';
  const flood = /^FLOOD_(?:PREMIUM_)?WAIT_(\d+)$/.exec(type);
  if (flood) return new FloodWaitError(Number(flood[1]), err.code, method);
  if (type === 'PEER_FLOOD') return new PeerFloodError(err.code, method);
  return new RpcError(type, err.code, method);
}
