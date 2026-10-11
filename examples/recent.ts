/**
 * Your 10 most recent private conversations, with their last messages.
 *
 *   npm run recent              # 10 people, 10 messages each
 *   npm run recent -- 5 30      # 5 people, 30 messages each
 */
import { connect } from './_client.js';

const [limit = '10', perChat = '10'] = process.argv.slice(2);
const tg = await connect();

const conversations = await tg.getRecentConversations({ limit: Number(limit), messagesPerChat: Number(perChat) });
for (const { user, dialog, messages } of conversations) {
  console.log(`\n=== ${user} — peer ${user.peerId}${dialog.unreadCount ? `, ${dialog.unreadCount} unread` : ''}`);
  for (const m of [...messages].reverse()) console.log('  ' + m.toString());
}
await tg.close();
