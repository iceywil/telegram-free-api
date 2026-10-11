/**
 * Everyone you messaged since a date: @username, name and bio.
 *
 *   npm run contacted -- 2026-10-03          # since that day, 00:00 local time
 *   npm run contacted -- 2026-10-03 --json   # machine-readable
 */
import { connect } from './_client.js';

const [day, flag] = process.argv.slice(2);
if (!day) throw new Error('usage: npm run contacted -- YYYY-MM-DD [--json]');
const since = new Date(`${day}T00:00:00`); // local timezone

const tg = await connect();
const people = await tg.getContactedSince(since);

if (flag === '--json') {
  console.log(JSON.stringify(people.map(({ user, about, sentCount, lastOutgoing }) => ({
    username: user.username ? `@${user.username}` : null,
    name: user.name,
    peerId: user.peerId,
    bio: about,
    sentCount,
    lastSentAt: lastOutgoing.dateObject.toISOString(),
  })), null, 2));
} else {
  console.log(`${people.length} people messaged since ${since.toString()}\n`);
  for (const { user, about } of people) {
    console.log(`${user.username ? '@' + user.username : `(no username, id ${user.peerId})`} — ${user.name}`);
    console.log(`  ${about ? about.replace(/\n/g, ' ') : '(no bio)'}\n`);
  }
}
await tg.close();
