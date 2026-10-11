import { Chat } from './chat.js';
import { User } from './user.js';
import type { PeerId } from '../peers.js';

export type Entity = User | Chat;

/** Peer-id → User/Chat lookup built from a response's `users` / `chats` arrays. */
export class Entities extends Map<PeerId, Entity> {
  static fromResponse(res: any): Entities {
    const map = new Entities();
    for (const u of res?.users ?? []) if (u._ === 'user') map.set(Number(u.id), new User(u));
    for (const c of res?.chats ?? []) if (c._ !== 'chatEmpty') map.set(-Number(c.id), new Chat(c));
    return map;
  }

  user(peerId: PeerId): User | undefined {
    const e = this.get(peerId);
    return e instanceof User ? e : undefined;
  }
}
