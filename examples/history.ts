/**
 * Print the last messages of a chat.
 *
 *   npm run history -- @username 20
 *   npm run history -- 777000
 */
import { connect } from './_client.js';

const [peer = '777000', limit = '20'] = process.argv.slice(2);
const tg = await connect();

const messages = await tg.getHistory(peer, { limit: Number(limit) });
for (const m of [...messages].reverse()) console.log(m.toString());
await tg.close();
