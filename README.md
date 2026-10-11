# Free-Telegram-API

Free Telegram API for Telegram in TypeScript. Control your own Telegram account from TypeScript by driving
[web.telegram.org](https://web.telegram.org/k/) with Playwright.

It doesn't scrape the DOM. Telegram Web K runs a full MTProto client in the
page (`window.rootScope.managers`), and this library calls it directly. You
get the **real Telegram API** (the one GramJS/Telethon speak, not the Bot API)
on your logged-in web session. You don't need an `api_id`, an `api_hash` or a
bot token, and you can watch every action happen in the browser window.

> **ToS / ban risk.** This automates a user account. Telegram aggressively
> restricts accounts that cold-message many strangers (`PEER_FLOOD`). Keep
> volumes low, space messages out, and don't use an account you can't lose.

## Highlights

- **Two modes.** `browser` drives Telegram Web so you can watch it. `direct`
  uses the browser only to log in once, then talks MTProto straight to
  Telegram: no browser, faster startup, about 100 MB of memory.
- Log in once by scanning a QR code in a visible window. The session persists
  in `.telegram-session/`, and every later run, headed or headless, is already
  logged in.
- Dialogs, unread chats, history, search, contacts and user profiles, with
  cursor pagination (`Result<T>` is an array with `.next()`).
- Sending goes through Telegram Web's own pipeline, so the message appears in
  the open window, with an optional "typing…" indicator first.
- Live incoming messages (`onMessage`).
- `invoke(method, params)` gives raw access to any of the
  [MTProto methods](https://core.telegram.org/methods).
- UI helpers: open a chat, type a message key by key, take screenshots.
- Automatic `FLOOD_WAIT` sleeps, and typed errors (`PeerFloodError`,
  `PeerNotFoundError`, …).

## Install

```bash
npm install git+https://github.com/iceywil/telegram-free-api.git#v1.0.0
npx playwright install chromium   # if you don't have it yet
```

Node 20+. The package builds itself on install (`prepare`). On npm 12+, git
dependencies are opt-in: add `--allow-git=all` to the install command.

From source:

```bash
git clone https://github.com/iceywil/telegram-free-api.git && cd telegram-free-api
npm install && npm test
```

## Log in (once)

```bash
HEADED=1 npm run login            # opens a window → scan the QR with your phone
```

On your phone, go to Telegram → **Settings → Devices → Link Desktop Device**
and scan the QR code. If you have a 2FA password, type it in the window or set
`TG_PASSWORD`. In headless mode, `login()` saves the QR code to
`telegram-login.png` instead.

From then on everything runs headless and is already logged in:

```bash
npm run dialogs
```

## Scripts

| Command                                    | What it does                                     |
| ------------------------------------------ | ------------------------------------------------ |
| `npm run login`                            | Log in (first time) / print who you are          |
| `npm run dialogs` · `npm run dialogs -- unread` | List chats / only unread ones               |
| `npm run history -- @user 20`              | Last 20 messages of a chat                       |
| `npm run recent -- 10 10`                  | 10 most recent private chats + 10 messages each  |
| `npm run contacted -- 2026-10-03`          | Everyone you messaged since a date, with bios (`--json` too) |
| `npm run send -- @user "Hello"`            | Send a message (also `+33612345678` or a peer id) |
| `npm run listen`                           | Print incoming messages live                     |
| `npm run outreach -- targets.json`         | Paced bulk DMs (dry run unless `SEND=1`)         |

Environment variables: `HEADED=1` (show the browser; default is headless), `TG_MODE=direct`, `TG_SESSION`, `SLOW_MO=200` (ms per action, to watch),
`TG_SESSION_DIR` (one dir per account), `TG_PASSWORD`.

## Usage

```ts
import { TelegramClient } from 'free-telegram-api';

const tg = await TelegramClient.launch(); // headless; pass { headless: false } to watch
await tg.login();

// chats
const dialogs = await tg.getDialogs({ limit: 50 });
for (const d of dialogs) console.log(d.peerId, d.title, d.unreadCount, d.topMessage?.text);
const more = await dialogs.next();
const unread = await tg.getUnreadDialogs();

// your 10 most recent 1:1 conversations (no groups/channels/bots), with messages
for (const { user, dialog, messages } of await tg.getRecentConversations({ limit: 10, messagesPerChat: 20 })) {
  console.log(user.name, dialog.unreadCount, messages.map((m) => m.text)); // messages newest first
}

// everyone you sent a message to since a date, with their profile bio
for (const { user, about, sentCount } of await tg.getContactedSince(new Date('2026-10-03T00:00'))) {
  console.log(`@${user.username}`, user.name, about, sentCount);
}

// messages
const history = await tg.getHistory('@alice', { limit: 20 }); // newest first
for await (const m of tg.iterHistory('@alice')) { /* whole history */ }
const hits = await tg.searchMessages('invoice');                // all chats
const inChat = await tg.searchMessages('invoice', { peer: '@alice' });

// send
await tg.sendMessage('@alice', 'Hey!', { typing: true });
await tg.sendMessage('+33612345678', 'Hi');      // must be on Telegram & allow phone lookup
await tg.sendMessage(dialogs[0], 'Reply', { replyTo: dialogs[0].topMessageId });
await tg.markAsRead('@alice');

// people
const me = await tg.getMe();
const alice = await tg.getEntity('@alice');      // User | Chat
const full = await tg.getFullUser('@alice');     // bio, common chats…
const contacts = await tg.getContacts();
const members = await tg.getParticipants(-1001234567); // group members + role (creator/admin/member)

// live
const stop = await tg.onMessage((m) => console.log(m.senderId, m.text));

// UI: do it "by hand" in the window
await tg.openChat('@alice');
await tg.sendMessageUI('@alice', 'typed key by key');

await tg.close();
```

### Direct mode (no browser)

After one browser login, the client can export the session's MTProto auth key
and drop the browser entirely. The same methods work, and calls go straight to
Telegram through [GramJS](https://github.com/gram-js/gramjs).

```ts
const tg = await TelegramClient.launch({ mode: 'direct' });
await tg.login();               // first run: exports the key from the browser profile, then closes it
await tg.getDialogs();          // plain MTProto from Node from now on

// Run anywhere (a server, CI) with no browser and no session dir:
const session = await tg.exportSession();          // a string. It IS your login, so keep it secret
const remote = await TelegramClient.launch({ session });
```

From the scripts: `TG_MODE=direct npm run dialogs`, or `TG_SESSION=<string> npm run dialogs`.

| | `browser` (default) | `direct` |
|---|---|---|
| Runtime | Chromium + Telegram Web | Node only (GramJS) |
| Startup | about 4 s | about 1 s (0.7 s from a session string) |
| Sending | Telegram Web's own pipeline (shows in the window) | `messages.sendMessage` |
| `openChat`, `sendMessageUI`, `screenshot`, `callManager`, `on` | Yes | No (throws) |
| `onMessage` | Telegram Web events | GramJS update handler |

Direct mode reuses Telegram Web's own app id and reports the same device,
platform, app version and language pack. Telegram sees it as the same Web
session. It is still the *same* login, though: terminating that session in
Telegram's settings ends both. The key is saved to
`<sessionDir>/free-telegram-api.session.json` with file mode 600, and the
peer cache (access hashes) to `free-telegram-api.peers.json`.

### Peers

Anything that takes a `peer` accepts any of these:

- `'@username'`, `'username'` or `'https://t.me/username'`
- `'+33612345678'` (phone, must start with `+`)
- a peer id: users are positive, groups and channels are negative, as in the
  Telegram Web URL (`web.telegram.org/k/#-1234567`)
- any `User` / `Chat` / `Dialog` / `Message` object

A bare numeric id only works if this session already knows that peer (it's
in your chats, or you resolved it before). Otherwise use the username or
phone.

### Raw API

`invoke` takes any method from <https://core.telegram.org/methods>. Params use
the schema's snake_case names, `true` flags are plain booleans, and longs are
strings. Users and chats in the response are added to the peer cache
automatically.

```ts
const input = await tg.getInputPeer('@alice');
await tg.invoke('messages.sendReaction', {
  peer: input, msg_id: 123, reaction: [{ _: 'reactionEmoji', emoticon: '👍' }],
});
await tg.invoke('contacts.addContact', { id: { _: 'inputUser', user_id: …, access_hash: … }, first_name: 'Alice', last_name: '', phone: '' });
```

`callManager(manager, method, ...args)` reaches Telegram Web's internal
managers (`appMessagesManager`, `appUsersManager`, …). Those aren't a stable
API, so prefer `invoke()`.

`on(event, handler)` subscribes to any Telegram Web event
(`history_multiappend`, `message_sent`, `dialog_unread`, …).

### Errors

| Error               | When                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| `NotLoggedInError`  | No session. Run `npm run login` headed                               |
| `PeerNotFoundError` | Unknown username or phone, or an id this session hasn't seen         |
| `FloodWaitError`    | Telegram rate limit longer than `floodSleepThreshold` (default 60 s; shorter waits are slept automatically) |
| `PeerFloodError`    | Account restricted from messaging strangers. **Stop**, then check @SpamBot |
| `RpcError`          | Any other Telegram error (`.type`, e.g. `USER_PRIVACY_RESTRICTED`)   |

## How it works

Browser mode:

```
Node (TelegramClient) ──page.evaluate──▶ window.__tgw (injected bridge)
                                            │
                                            ▼
                          rootScope.managers (Telegram Web K)
                          ├─ apiManager.invokeApi ──▶ MTProto ──▶ Telegram
                          └─ appMessagesManager / appUsersManager / …
```

Direct mode reads the auth key that Telegram Web keeps in `localStorage`
(`dcN_auth_key`) once, then connects to the same data center with GramJS.

The Chromium profile in `sessionDir` stores Telegram Web's auth key, so it is
the logged-in account. Never commit it (it's gitignored). Use one
`sessionDir` per account.

Only the **K** client (`/k/`) is supported, since the A client has different
internals. If Telegram ships a breaking change to Web K internals, the bridge
in `src/internal/bridge.ts` is the one place to fix.

## Development

```bash
npm run typecheck
npm test        # unit tests (no account needed)
npm run build   # dist/ (ESM + CJS + .d.ts)
```
