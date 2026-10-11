/**
 * Message a list of people, one by one, with human-like pacing.
 *
 *   npm run outreach -- targets.json            # dry run: prints what it would send
 *   SEND=1 npm run outreach -- targets.json     # actually send
 *
 * targets.json: [{ "peer": "@alice", "name": "Alice" }, { "peer": "+33612345678", "name": "Bob" }]
 *
 * Safety:
 *  - skips anyone you already have a conversation with
 *  - waits 45–120 s between messages (Telegram limits cold DMs hard)
 *  - stops immediately on PEER_FLOOD (account restricted from messaging strangers)
 *  - logs every result to outreach-log.jsonl
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { PeerFloodError, PeerNotFoundError, randomSleep } from '../src/index.js';
import { connect } from './_client.js';

const TEMPLATE = `Hi {name}! 👋`;

const file = process.argv[2] ?? 'targets.json';
const send = process.env.SEND === '1';
const targets: { peer: string; name?: string }[] = JSON.parse(readFileSync(file, 'utf8'));
const log = (entry: object) => appendFileSync('outreach-log.jsonl', JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');

const tg = await connect();
console.log(`${targets.length} targets — ${send ? 'SENDING' : 'dry run (SEND=1 to send)'}`);

for (const [i, t] of targets.entries()) {
  const text = TEMPLATE.replace('{name}', t.name ?? '').replace(/\s+!/, '!');
  try {
    const peerId = await tg.resolvePeer(t.peer);
    const existing = await tg.getHistory(peerId, { limit: 1 });
    if (existing.length) {
      console.log(`- ${t.peer}: already have a conversation, skipping`);
      log({ peer: t.peer, status: 'skipped_existing' });
      continue;
    }
    if (!send) {
      console.log(`- ${t.peer}: would send ${JSON.stringify(text)}`);
      continue;
    }
    await tg.openChat(peerId);
    const msg = await tg.sendMessage(peerId, text);
    console.log(`✓ ${t.peer}: sent #${msg.id}`);
    log({ peer: t.peer, peerId, status: 'sent', messageId: msg.id });
  } catch (e) {
    if (e instanceof PeerFloodError) {
      console.error(`✗ PEER_FLOOD — account restricted, stopping. Check @SpamBot.`);
      log({ peer: t.peer, status: 'peer_flood' });
      break;
    }
    const status = e instanceof PeerNotFoundError ? 'not_found' : 'error';
    console.error(`✗ ${t.peer}: ${(e as Error).message}`);
    log({ peer: t.peer, status, error: (e as Error).message });
    continue;
  }
  if (send && i < targets.length - 1) await randomSleep(45_000, 120_000);
}
await tg.close();
