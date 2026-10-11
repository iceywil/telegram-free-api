import type { PeerId } from '../peers.js';

export type ChatType = 'group' | 'supergroup' | 'channel';

/** A basic group, supergroup or channel (raw `chat` / `channel` object). */
export class Chat {
  /** Telegram's (positive) chat/channel id. */
  readonly id: number;
  /** Negative peer id, as used by Telegram Web K and this library. */
  readonly peerId: PeerId;
  readonly type: ChatType;
  readonly title: string;
  readonly username?: string;
  readonly participantsCount?: number;
  /** Whether you left / were kicked, or the chat is otherwise unavailable. */
  readonly isLeft: boolean;
  readonly isCreator: boolean;

  constructor(readonly raw: any) {
    const f = raw.pFlags ?? {};
    this.id = Number(raw.id);
    this.peerId = -this.id;
    this.type =
      raw._ === 'channel' || raw._ === 'channelForbidden'
        ? f.megagroup
          ? 'supergroup'
          : 'channel'
        : 'group';
    this.title = raw.title ?? '';
    this.username =
      raw.username ?? (raw.usernames ?? []).find((u: any) => u.pFlags?.active !== false)?.username;
    this.participantsCount = raw.participants_count;
    this.isLeft = !!f.left || !!f.kicked || raw._ === 'chatForbidden' || raw._ === 'channelForbidden';
    this.isCreator = !!f.creator;
  }

  get name(): string {
    return this.title;
  }

  toString(): string {
    return this.username ? `${this.title} (@${this.username})` : this.title;
  }
}
