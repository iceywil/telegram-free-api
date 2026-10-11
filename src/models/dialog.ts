import { peerIdOf, type PeerId } from '../peers.js';
import { Chat } from './chat.js';
import type { Entities, Entity } from './entities.js';
import { Message } from './message.js';
import { User } from './user.js';

/** A conversation in the chat list. */
export class Dialog {
  readonly peerId: PeerId;
  readonly entity?: Entity;
  readonly unreadCount: number;
  readonly unreadMentionsCount: number;
  readonly isPinned: boolean;
  readonly isMarkedUnread: boolean;
  /** 1 = archived. */
  readonly folderId: number;
  readonly topMessageId: number;
  readonly topMessage?: Message;

  constructor(
    readonly raw: any,
    entities: Entities,
    messages: Map<string, Message>,
  ) {
    const f = raw.pFlags ?? {};
    this.peerId = peerIdOf(raw.peer);
    this.entity = entities.get(this.peerId);
    this.unreadCount = raw.unread_count ?? 0;
    this.unreadMentionsCount = raw.unread_mentions_count ?? 0;
    this.isPinned = !!f.pinned;
    this.isMarkedUnread = !!f.unread_mark;
    this.folderId = raw.folder_id ?? 0;
    this.topMessageId = Number(raw.top_message ?? 0);
    this.topMessage = messages.get(`${this.peerId}:${this.topMessageId}`);
  }

  get title(): string {
    return this.entity?.name ?? String(this.peerId);
  }

  get isUser(): boolean {
    return this.entity instanceof User;
  }

  get isGroup(): boolean {
    return this.entity instanceof Chat && this.entity.type !== 'channel';
  }

  get isChannel(): boolean {
    return this.entity instanceof Chat && this.entity.type === 'channel';
  }

  get isUnread(): boolean {
    return this.unreadCount > 0 || this.isMarkedUnread;
  }

  toString(): string {
    return `${this.title}${this.unreadCount ? ` (${this.unreadCount} unread)` : ''}`;
  }
}
