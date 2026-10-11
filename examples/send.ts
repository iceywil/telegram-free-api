/**
 * Send one message (watch it appear in the window).
 *
 *   npm run send -- @username "Hello from the bot"
 *   npm run send -- +33612345678 "Hello"
 */
import { connect } from './_client.js';

const [peer, ...words] = process.argv.slice(2);
if (!peer || !words.length) throw new Error('usage: npm run send -- <@username|+phone|peerId> <text>');

const tg = await connect();
await tg.openChat(peer); // so you can see it happen
const msg = await tg.sendMessage(peer, words.join(' '));
console.log(`sent message #${msg.id} to ${peer}`);
await tg.close();
