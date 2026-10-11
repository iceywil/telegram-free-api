/**
 * telegram-web-api — control your Telegram account through web.telegram.org
 * with Playwright, calling the real Telegram (MTProto) API via the web app's
 * logged-in session.
 */

export {
  TelegramClient,
  type ClientOptions,
  type LoginOptions,
  type GetDialogsOptions,
  type GetHistoryOptions,
  type SendMessageOptions,
  type SearchOptions,
  type RecentConversationsOptions,
  type Conversation,
  type ContactedSinceOptions,
  type ContactedPerson,
} from './client.js';
export { User } from './models/user.js';
export { Chat, type ChatType } from './models/chat.js';
export { Dialog } from './models/dialog.js';
export { Message } from './models/message.js';
export { Entities, type Entity } from './models/entities.js';
export { Result } from './result.js';
export { parsePeerLike, peerIdOf, isUserPeer, type PeerId, type PeerLike, type ParsedPeer } from './peers.js';
export {
  TelegramWebError,
  RpcError,
  FloodWaitError,
  PeerFloodError,
  NotLoggedInError,
  PeerNotFoundError,
  TimeoutError,
} from './errors.js';
export { sleep, randomSleep, randomLong } from './utils.js';
