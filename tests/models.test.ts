import { describe, expect, it } from 'vitest';
import { Dialog, Entities, Message, Result, User } from '../src/index.js';

const res = {
  _: 'messages.dialogsSlice',
  count: 120,
  dialogs: [
    { _: 'dialog', peer: { _: 'peerUser', user_id: 10 }, top_message: 7, unread_count: 2, pFlags: { pinned: true } },
    { _: 'dialog', peer: { _: 'peerChannel', channel_id: 99 }, top_message: 300, unread_count: 0, pFlags: {} },
  ],
  messages: [
    { _: 'message', id: 7, peer_id: { _: 'peerUser', user_id: 10 }, message: 'hey', date: 1700000000, pFlags: {} },
    {
      _: 'message',
      id: 300,
      peer_id: { _: 'peerChannel', channel_id: 99 },
      from_id: { _: 'peerUser', user_id: 10 },
      message: 'in group',
      date: 1700000100,
      pFlags: { out: false },
    },
  ],
  users: [
    {
      _: 'user',
      id: 10,
      first_name: 'Alice',
      last_name: 'Doe',
      usernames: [{ _: 'username', username: 'alice', pFlags: { active: true } }],
      pFlags: { contact: true },
      status: { _: 'userStatusOffline', was_online: 1699999999 },
    },
  ],
  chats: [{ _: 'channel', id: 99, title: 'Builders', pFlags: { megagroup: true } }],
};

describe('models', () => {
  const entities = Entities.fromResponse(res);
  const messages = new Map(res.messages.map((m) => {
    const msg = new Message(m, { entities, myId: 1 });
    return [`${msg.peerId}:${msg.id}`, msg] as const;
  }));

  it('builds dialogs with entities and top messages', () => {
    const [dm, group] = res.dialogs.map((d) => new Dialog(d, entities, messages));
    expect(dm.peerId).toBe(10);
    expect(dm.title).toBe('Alice Doe');
    expect(dm.isUser && dm.isPinned && dm.isUnread).toBe(true);
    expect(dm.topMessage?.text).toBe('hey');
    expect(group.peerId).toBe(-99);
    expect(group.isGroup).toBe(true);
    expect(group.isChannel).toBe(false);
    expect(group.topMessage?.sender?.name).toBe('Alice Doe');
  });

  it('builds users', () => {
    const u = entities.user(10)!;
    expect(u).toBeInstanceOf(User);
    expect(u.username).toBe('alice');
    expect(u.isContact).toBe(true);
    expect(u.lastSeen).toBe(1699999999);
    expect(String(u)).toBe('Alice Doe (@alice)');
  });

  it('infers the sender of private messages', () => {
    const incoming = new Message({ _: 'message', id: 1, peer_id: { _: 'peerUser', user_id: 10 }, date: 0, pFlags: {} }, { myId: 1 });
    const outgoing = new Message({ _: 'message', id: 2, peer_id: { _: 'peerUser', user_id: 10 }, date: 0, pFlags: { out: true } }, { myId: 1 });
    expect(incoming.senderId).toBe(10);
    expect(outgoing.senderId).toBe(1);
  });

  it('reads Telegram Web processed messages (real-time events)', () => {
    const m = new Message({ _: 'message', mid: 55, peerId: -99, fromId: 10, message: 'live', date: 5, pFlags: {} });
    expect([m.id, m.peerId, m.senderId, m.text]).toEqual([55, -99, 10, 'live']);
  });
});

describe('Result', () => {
  it('is an array that paginates', async () => {
    const page2 = Result.from_([3]);
    const page1 = Result.from_([1, 2], async () => page2, 3);
    expect([...page1]).toEqual([1, 2]);
    expect(page1.total).toBe(3);
    expect(page1.hasNext).toBe(true);
    expect([...(await page1.next())]).toEqual([3]);
    expect((await page2.next()).length).toBe(0);
    expect(page1.map((x) => x * 2)).toEqual([2, 4]);
  });
});
