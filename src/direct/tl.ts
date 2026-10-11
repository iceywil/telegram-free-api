/**
 * Converts between the library's plain TL objects (Telegram Web K's shape:
 * `{ _: 'inputPeerUser', user_id, access_hash, pFlags }`, longs as strings,
 * bytes as `{ _bytes: base64 }`) and GramJS class instances (camelCase fields,
 * `big-integer` longs, Buffers), driven by GramJS's bundled schema.
 */
import { createRequire } from 'node:module';

type ArgConfig = { type: string; isVector: boolean; isFlag: boolean; flagIndicator: boolean };
type TlDef = { name: string; namespace?: string; argsConfig: Record<string, ArgConfig> };

const require_ = createRequire(import.meta.url);
const LONG_TYPES = new Set(['long', 'int128', 'int256']);

let gram: { Api: any; bigInt: any; defs: Map<string, TlDef> } | undefined;

/** Lazily load GramJS (only needed in direct mode). */
export function loadGram() {
  if (gram) return gram;
  let telegram: any, helpers: any, apiTl: any, bigInt: any;
  try {
    telegram = require_('telegram');
    helpers = require_('telegram/tl/generationHelpers');
    apiTl = require_('telegram/tl/apiTl');
    // Resolve big-integer from GramJS's own location (the exact copy it checks instances against).
    bigInt = createRequire(require_.resolve('telegram'))('big-integer');
  } catch {
    throw new Error('Direct mode needs the "telegram" package: npm install telegram');
  }
  const schema: string = typeof apiTl === 'string' ? apiTl : apiTl.default;
  const defs = new Map<string, TlDef>();
  for (const d of helpers.parseTl(schema, 0) as TlDef[]) defs.set(d.namespace ? `${d.namespace}.${d.name}` : d.name, d);
  gram = { Api: telegram.Api, bigInt, defs };
  return gram;
}

const upperFirst = (s: string) => s[0].toUpperCase() + s.slice(1);
const lowerFirst = (s: string) => s[0].toLowerCase() + s.slice(1);
const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** `messages.getDialogs` → `messages.GetDialogs`; `inputPeerUser` → `InputPeerUser`. */
export function gramName(webName: string): string {
  const i = webName.lastIndexOf('.');
  return i < 0 ? upperFirst(webName) : `${webName.slice(0, i)}.${upperFirst(webName.slice(i + 1))}`;
}

/** `messages.DialogsSlice` → `messages.dialogsSlice`. */
export function webName(gramClassName: string): string {
  const i = gramClassName.lastIndexOf('.');
  return i < 0 ? lowerFirst(gramClassName) : `${gramClassName.slice(0, i)}.${lowerFirst(gramClassName.slice(i + 1))}`;
}

function bytesOf(v: any): Buffer {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (v && typeof v._bytes === 'string') return Buffer.from(v._bytes, 'base64');
  if (typeof v === 'string') return Buffer.from(v, 'utf8');
  throw new TypeError(`Expected bytes, got ${JSON.stringify(v)}`);
}

/** Plain TL object → GramJS instance. */
export function toGram(obj: any): any {
  const { Api, defs } = loadGram();
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (obj.CONSTRUCTOR_ID !== undefined) return obj; // already GramJS
  if (Array.isArray(obj)) return obj.map(toGram);
  if (typeof obj._ !== 'string') throw new TypeError(`TL object without "_": ${JSON.stringify(obj).slice(0, 120)}`);

  const name = gramName(obj._);
  const def = defs.get(name);
  const ns = name.includes('.') ? name.split('.')[0] : undefined;
  const Cls = ns ? Api[ns]?.[name.split('.')[1]] : Api[name];
  if (!def || !Cls) throw new TypeError(`Unknown TL type/method: ${obj._}`);

  const args: Record<string, unknown> = {};
  for (const [key, cfg] of Object.entries(def.argsConfig)) {
    if (cfg.flagIndicator) continue;
    const snake = toSnake(key);
    let v = obj[snake] ?? obj[key];
    if (v === undefined && cfg.type === 'true') v = obj.pFlags?.[snake];
    if (v === undefined || v === null) continue;
    args[key] = cfg.isVector ? (v as any[]).map((x) => convertArg(x, cfg.type)) : convertArg(v, cfg.type);
  }
  return new Cls(args);
}

function convertArg(v: any, type: string): any {
  const { bigInt } = loadGram();
  if (LONG_TYPES.has(type)) return bigInt.isInstance(v) ? v : bigInt(String(v));
  switch (type) {
    case 'int':
    case 'double':
    case 'date':
      return Number(v);
    case 'true':
    case 'Bool':
      return Boolean(v);
    case 'bytes':
      return bytesOf(v);
    case 'string':
      return String(v);
    default:
      return toGram(v);
  }
}

/** GramJS result → plain TL object (the same shape Telegram Web returns). */
export function fromGram(v: any): any {
  const { bigInt, defs } = loadGram();
  if (v === null || v === undefined) return v;
  if (typeof v !== 'object') return v;
  if (bigInt.isInstance(v)) return v.toString();
  if (typeof v === 'bigint') return v.toString();
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { _bytes: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(fromGram);

  const def = typeof v.className === 'string' ? defs.get(v.className) : undefined;
  if (!def) return v;

  const out: Record<string, any> = { _: webName(v.className) };
  const pFlags: Record<string, true> = {};
  for (const [key, cfg] of Object.entries(def.argsConfig)) {
    if (cfg.flagIndicator) continue;
    const snake = toSnake(key);
    const x = v[key];
    if (cfg.type === 'true') {
      if (x) pFlags[snake] = true;
      continue;
    }
    if (x === undefined || x === null) continue;
    out[snake] = fromGram(x);
  }
  out.pFlags = pFlags;
  return out;
}
