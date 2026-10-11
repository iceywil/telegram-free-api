import { describe, expect, it } from 'vitest';
import { decodeSession, encodeSession, type DirectSession } from '../src/direct/session.js';
import { fromGram, gramName, loadGram, toGram, webName } from '../src/direct/tl.js';

describe('TL name mapping', () => {
  it('maps between Telegram Web and GramJS names', () => {
    expect(gramName('messages.getDialogs')).toBe('messages.GetDialogs');
    expect(gramName('inputPeerUser')).toBe('InputPeerUser');
    expect(webName('messages.DialogsSlice')).toBe('messages.dialogsSlice');
    expect(webName('User')).toBe('user');
  });
});

describe('toGram', () => {
  const { Api, bigInt } = loadGram();

  it('builds requests with longs, flags and nested objects', () => {
    const req = toGram({
      _: 'messages.sendMessage',
      peer: { _: 'inputPeerUser', user_id: '1445410439', access_hash: '-8394729347293847' },
      message: '12345', // a digit-only *string* must stay a string
      random_id: '-42',
      silent: true,
      reply_to: { _: 'inputReplyToMessage', reply_to_msg_id: 7 },
    });
    expect(req).toBeInstanceOf(Api.messages.SendMessage);
    expect(req.message).toBe('12345');
    expect(bigInt.isInstance(req.randomId) && req.randomId.toString()).toBe('-42');
    expect(req.silent).toBe(true);
    expect(req.peer.userId.toString()).toBe('1445410439');
    expect(req.peer.accessHash.toString()).toBe('-8394729347293847');
    expect(req.replyTo.replyToMsgId).toBe(7);
    expect(() => req.getBytes()).not.toThrow();
  });

  it('handles vectors and bytes', () => {
    const req = toGram({ _: 'users.getUsers', id: [{ _: 'inputUserSelf' }] });
    expect(req.id[0]).toBeInstanceOf(Api.InputUserSelf);
    const bytes = toGram({ _: 'inputPhoto', id: '1', access_hash: '2', file_reference: { _bytes: Buffer.from([1, 2]).toString('base64') } });
    expect([...bytes.fileReference]).toEqual([1, 2]);
  });

  it('rejects unknown types', () => {
    expect(() => toGram({ _: 'messages.notAThing' })).toThrow(/Unknown TL/);
  });
});

describe('fromGram', () => {
  const { Api, bigInt } = loadGram();

  it('produces Telegram Web-shaped objects', () => {
    const user = new Api.User({ id: bigInt(5), accessHash: bigInt('-9'), firstName: 'Al', self: true, contact: false, username: 'al' });
    expect(fromGram(user)).toMatchObject({ _: 'user', id: '5', access_hash: '-9', first_name: 'Al', username: 'al', pFlags: { self: true } });
    expect(fromGram(user).pFlags.contact).toBeUndefined();

    const msg = new Api.Message({ id: 3, peerId: new Api.PeerUser({ userId: bigInt(5) }), date: 10, message: 'hi', out: true });
    expect(fromGram(msg)).toMatchObject({ _: 'message', id: 3, peer_id: { _: 'peerUser', user_id: '5' }, message: 'hi', pFlags: { out: true } });
  });

  it('round-trips', () => {
    const plain = { _: 'inputPeerChannel', channel_id: '123', access_hash: '456', pFlags: {} };
    expect(fromGram(toGram(plain))).toEqual(plain);
  });
});

describe('session strings', () => {
  it('encode/decode', () => {
    const s: DirectSession = { v: 1, dcId: 4, authKey: 'ab'.repeat(256), userId: 1, apiId: 2496, apiHash: 'h', deviceModel: 'ua', systemVersion: 'MacIntel', systemLangCode: 'en', appVersion: '2.2 K', langPack: 'webk' };
    expect(decodeSession(encodeSession(s))).toEqual(s);
    expect(() => decodeSession('bm9wZQ')).toThrow();
  });
});
