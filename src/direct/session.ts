import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';

/**
 * Everything needed to talk MTProto directly as the browser's logged-in
 * session. `authKey` IS the login — treat this like a password.
 */
export interface DirectSession {
  v: 1;
  dcId: number;
  /** 256-byte MTProto auth key, hex. */
  authKey: string;
  userId: number;
  apiId: number;
  apiHash: string;
  /** Reported in initConnection, copied from the browser so it stays the same session. */
  deviceModel: string;
  systemVersion: string;
  systemLangCode: string;
  appVersion: string;
  langPack: string;
}

/** Telegram Web K's public app credentials (from its JS bundle). */
export const WEBK_API_ID = 2496;
export const WEBK_API_HASH = '8da85b0d5bfe62527e5b244c209159c3';

/** Production data-center addresses. */
export const DC_ADDRESSES: Record<number, string> = {
  1: '149.154.175.53',
  2: '149.154.167.51',
  3: '149.154.175.100',
  4: '149.154.167.91',
  5: '91.108.56.130',
};

export const SESSION_FILE = 'free-telegram-api.session.json';

/** Read the auth key Telegram Web K keeps in localStorage. */
export async function exportFromPage(page: Page): Promise<DirectSession> {
  const raw: any = await page.evaluate(`(() => {
    const user = JSON.parse(localStorage.getItem('user_auth') || 'null');
    if (!user || !user.dcID) return null;
    const key = localStorage.getItem('dc' + user.dcID + '_auth_key');
    return {
      dcId: user.dcID,
      userId: Number(user.id),
      authKey: key ? JSON.parse(key) : null,
      deviceModel: navigator.userAgent,
      systemVersion: navigator.platform,
      systemLangCode: navigator.language || 'en',
    };
  })()`);
  if (!raw?.authKey || !/^[0-9a-f]{512}$/i.test(raw.authKey)) {
    throw new Error('Could not read the auth key from Telegram Web (not logged in, or storage format changed).');
  }
  return {
    v: 1,
    ...raw,
    apiId: WEBK_API_ID,
    apiHash: WEBK_API_HASH,
    appVersion: '2.2 K',
    langPack: 'webk',
  };
}

export const encodeSession = (s: DirectSession) => Buffer.from(JSON.stringify(s)).toString('base64url');

export function decodeSession(str: string): DirectSession {
  const s = JSON.parse(Buffer.from(str.trim(), 'base64url').toString('utf8'));
  if (s?.v !== 1 || !s.authKey || !s.dcId) throw new Error('Invalid session string');
  return s;
}

export function loadSessionFile(dir: string): DirectSession | undefined {
  const path = join(dir, SESSION_FILE);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function saveSessionFile(dir: string, s: DirectSession): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, SESSION_FILE);
  writeFileSync(path, JSON.stringify(s, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}
