/**
 * First run: opens a visible window — scan the QR code with your phone
 * (Telegram → Settings → Devices → Link Desktop Device). The session is saved
 * in .telegram-session/, so every later run (headless too) is already logged in.
 *
 *   npm run login
 */
import { connect } from './_client.js';

const tg = await connect();
const me = await tg.getMe();
console.log(`Logged in as ${me} — id ${me.id}${me.phone ? `, +${me.phone}` : ''}`);
await tg.close();
