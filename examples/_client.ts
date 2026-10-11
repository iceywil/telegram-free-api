import { TelegramClient } from '../src/index.js';

/** Shared launcher for the examples. Headless by default; `HEADED=1 npm run …` to show the browser. */
export async function connect(): Promise<TelegramClient> {
  const tg = await TelegramClient.launch({
    headless: process.env.HEADED !== '1',
    sessionDir: process.env.TG_SESSION_DIR ?? '.telegram-session',
    slowMo: process.env.SLOW_MO ? Number(process.env.SLOW_MO) : undefined,
  });
  await tg.login({ password: process.env.TG_PASSWORD });
  return tg;
}
