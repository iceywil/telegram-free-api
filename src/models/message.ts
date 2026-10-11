import { peerIdOf, type PeerId } from '../peers.js';
import type { Entities, Entity } from './entities.js';

/**
 * A message. Built from a raw MTProto `message`/`messageService`, or from a
 * Telegram Web processed message (real-time events), which carries `mid`,
 * `peerId` and `fromId` instead of `id`, `peer_id` and `from_id`.
 */
export class Message {
  readonly id: number;
  /** The chat this message belongs to. */
  readonly peerId: PeerId;
  /** Who sent it (a user, or the chat itself for channel posts). */
  readonly senderId: PeerId;
  readonly text: string;
  /** Unix seconds. */
  readonly date: number;
  readonly isOutgoing: boolean;
  readonly isService: boolean;
  readonly replyToId?: number;
  /** Raw media type, e.g. `messageMediaPhoto`, `messageMediaDocument`. */
  readonly mediaType?: string;
  /** Chat entity (User/Chat), when the response included it. */
  readonly chat?: Entity;
  /** Sender entity (User/Chat), when the response included it. */
  readonly sender?: Entity;

  constructor(
    readonly raw: any,
    opts: { entities?: Entities; myId?: PeerId } = {},
  ) {
    const f = raw.pFlags ?? {};
    this.id = Number(raw.id ?? raw.mid);
    this.peerId = raw.peerId !== undefined ? Number(raw.peerId) : peerIdOf(raw.peer_id);
    this.isOutgoing = !!f.out;
    this.isService = raw._ === 'messageService';

    const from = raw.fromId !== undefined ? Number(raw.fromId) : raw.from_id ? peerIdOf(raw.from_id) : undefined;
    // Private chats omit from_id: the sender is either us or the other side.
    this.senderId = from ?? (this.isOutgoing && opts.myId ? opts.myId : this.peerId);

    this.text = raw.message ?? '';
    this.date = Number(raw.date ?? 0);
    this.replyToId = raw.reply_to?.reply_to_msg_id;
    this.mediaType = raw.media?._;
    this.chat = opts.entities?.get(this.peerId);
    this.sender = opts.entities?.get(this.senderId);
  }

  get dateObject(): Date {
    return new Date(this.date * 1000);
  }

  toString(): string {
    const who = this.isOutgoing ? 'me' : (this.sender?.name ?? this.senderId);
    return `[${this.dateObject.toISOString()}] ${who}: ${this.text || (this.mediaType ?? '')}`;
  }
}
