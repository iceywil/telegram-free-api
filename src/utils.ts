import { randomBytes } from 'node:crypto';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Sleep a random duration in [minMs, maxMs] — use between outreach actions. */
export const randomSleep = (minMs: number, maxMs: number) => sleep(minMs + Math.random() * (maxMs - minMs));

/** Random signed 64-bit integer as a decimal string (MTProto `long`, e.g. `random_id`). */
export const randomLong = (): string => randomBytes(8).readBigInt64LE().toString();
