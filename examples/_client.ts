import { TelegramClient } from '../src/index.js';

/**
 * Shared launcher for the examples. Headless by default; `HEADED=1 npm run …` to
 * show the browser. `TG_MODE=direct` skips the browser (after one login),
 * `TG_SESSION=<string>` runs from an exported session string.
 */
export async function connect(): Promise<TelegramClient> {
  const tg = await TelegramClient.launch({
    mode: process.env.TG_MODE === 'direct' ? 'direct' : 'browser',
    session: process.env.TG_SESSION,
    headless: process.env.HEADED !== '1',
    sessionDir: process.env.TG_SESSION_DIR ?? '.telegram-session',
    slowMo: process.env.SLOW_MO ? Number(process.env.SLOW_MO) : undefined,
  });
  await tg.login({ password: process.env.TG_PASSWORD });
  return tg;
}
