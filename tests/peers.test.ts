import { describe, expect, it } from 'vitest';
import { parsePeerLike, peerIdOf } from '../src/peers.js';

describe('parsePeerLike', () => {
  it('parses ids', () => {
    expect(parsePeerLike(777000)).toEqual({ kind: 'id', peerId: 777000 });
    expect(parsePeerLike('-1234567')).toEqual({ kind: 'id', peerId: -1234567 });
    expect(parsePeerLike({ peerId: 42 })).toEqual({ kind: 'id', peerId: 42 });
  });

  it('parses usernames and links', () => {
    for (const s of ['durov', '@durov', 'https://t.me/durov', 't.me/Durov?start=x', '@DUROV'])
      expect(parsePeerLike(s)).toEqual({ kind: 'username', username: 'durov' });
  });

  it('parses phones', () => {
    expect(parsePeerLike('+33 6 12 34 56 78')).toEqual({ kind: 'phone', phone: '33612345678' });
  });

  it('rejects junk', () => {
    expect(() => parsePeerLike('a b')).toThrow(TypeError);
    expect(() => parsePeerLike('@ab')).toThrow(TypeError);
  });
});

describe('peerIdOf', () => {
  it('maps raw peers to Telegram Web K peer ids', () => {
    expect(peerIdOf({ _: 'peerUser', user_id: 5 })).toBe(5);
    expect(peerIdOf({ _: 'peerChat', chat_id: 6 })).toBe(-6);
    expect(peerIdOf({ _: 'peerChannel', channel_id: '1001' })).toBe(-1001);
  });
});
