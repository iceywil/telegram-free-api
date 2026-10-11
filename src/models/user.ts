import type { PeerId } from '../peers.js';

/** A Telegram user (from a raw MTProto `user` object). */
export class User {
  readonly id: number;
  readonly peerId: PeerId;
  readonly firstName: string;
  readonly lastName: string;
  readonly username?: string;
  readonly usernames: string[];
  readonly phone?: string;
  readonly isBot: boolean;
  readonly isSelf: boolean;
  readonly isContact: boolean;
  readonly isMutualContact: boolean;
  readonly isPremium: boolean;
  readonly isVerified: boolean;
  readonly isDeleted: boolean;
  /** Raw `UserStatus._`, e.g. `userStatusOnline`, `userStatusRecently`. */
  readonly status?: string;
  /** Unix seconds, when status is `userStatusOffline`. */
  readonly lastSeen?: number;

  constructor(readonly raw: any) {
    const f = raw.pFlags ?? {};
    this.id = Number(raw.id);
    this.peerId = this.id;
    this.firstName = raw.first_name ?? '';
    this.lastName = raw.last_name ?? '';
    this.usernames = [
      ...(raw.username ? [raw.username] : []),
      ...(raw.usernames ?? []).filter((u: any) => u.pFlags?.active !== false).map((u: any) => u.username),
    ].filter((u, i, a) => a.indexOf(u) === i);
    this.username = this.usernames[0];
    this.phone = raw.phone;
    this.isBot = !!f.bot;
    this.isSelf = !!f.self;
    this.isContact = !!f.contact;
    this.isMutualContact = !!f.mutual_contact;
    this.isPremium = !!f.premium;
    this.isVerified = !!f.verified;
    this.isDeleted = !!f.deleted;
    this.status = raw.status?._;
    this.lastSeen = raw.status?.was_online;
  }

  get name(): string {
    return [this.firstName, this.lastName].filter(Boolean).join(' ') || (this.username ? `@${this.username}` : String(this.id));
  }

  toString(): string {
    return this.username ? `${this.name} (@${this.username})` : this.name;
  }
}
