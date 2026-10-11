/**
 * List your chats (and which ones are unread).
 *
 *   npm run dialogs            # first 30
 *   npm run dialogs -- unread  # only unread, scanning everything
 */
import { connect } from './_client.js';

const tg = await connect();

if (process.argv[2] === 'unread') {
  for (const d of await tg.getUnreadDialogs()) console.log(`${d.peerId}\t${d}`);
} else {
  const page = await tg.getDialogs({ limit: 30 });
  console.log(`${page.total} dialogs total, showing ${page.length}:`);
  for (const d of page) {
    const kind = d.isUser ? 'user' : d.isChannel ? 'channel' : 'group';
    console.log(`${String(d.peerId).padEnd(15)} ${kind.padEnd(8)} ${d}  — ${d.topMessage?.text.slice(0, 60) ?? ''}`);
  }
}
await tg.close();
