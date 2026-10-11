/**
 * Peer ids follow Telegram Web K's convention, so ids match what you see in the
 * address bar (`web.telegram.org/k/#-1234567`):
 *
 *   user                → positive user id         (e.g. 777000)
 *   basic group/channel → negative chat/channel id (e.g. -1234567)
 */
export type PeerId = number;

/**
 * Anything that identifies a chat:
 *   - a peer id number (`777000`, `-1234567`) or numeric string (`"777000"`)
 *   - a username (`"durov"`, `"@durov"`, `"https://t.me/durov"`)
 *   - a phone number with a leading `+` (`"+33612345678"`)
 *   - any object with a `peerId` (User, Chat, Dialog, Message)
 */
export type PeerLike = PeerId | string | { peerId: PeerId };

export type ParsedPeer =
  | { kind: 'id'; peerId: PeerId }
  | { kind: 'username'; username: string }
  | { kind: 'phone'; phone: string };

const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/;

export function parsePeerLike(peer: PeerLike): ParsedPeer {
  if (typeof peer === 'number') return { kind: 'id', peerId: peer };
  if (typeof peer === 'object' && peer !== null) return { kind: 'id', peerId: peer.peerId };

  const s = String(peer).trim();
  if (/^-?\d+$/.test(s)) return { kind: 'id', peerId: Number(s) };
  if (/^\+[\d\s()-]{6,}$/.test(s)) return { kind: 'phone', phone: s.replace(/\D/g, '') };

  const link = /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([^/?#]+)/i.exec(s);
  const username = (link ? link[1] : s).replace(/^@/, '');
  if (!USERNAME_RE.test(username)) throw new TypeError(`Not a valid peer: ${JSON.stringify(peer)}`);
  return { kind: 'username', username: username.toLowerCase() };
}

/** Raw MTProto `Peer` (`peerUser` / `peerChat` / `peerChannel`) → peer id. */
export function peerIdOf(peer: any): PeerId {
  if (!peer) return 0;
  switch (peer._) {
    case 'peerUser':
      return Number(peer.user_id);
    case 'peerChat':
      return -Number(peer.chat_id);
    case 'peerChannel':
      return -Number(peer.channel_id);
    default:
      throw new TypeError(`Unknown peer type: ${peer._}`);
  }
}

export const isUserPeer = (peerId: PeerId) => peerId > 0;
