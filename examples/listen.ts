/**
 * Print incoming messages live. Ctrl+C to stop.
 *
 *   npm run listen
 */
import { connect } from './_client.js';

const tg = await connect();
await tg.onMessage(async (m) => {
  const from = await tg.getEntity(m.senderId).catch(() => undefined);
  console.log(`[${m.peerId}] ${from?.name ?? m.senderId}: ${m.text || m.mediaType || ''}`);
});
console.log('listening for new messages…');
process.on('SIGINT', () => void tg.close().then(() => process.exit(0)));
