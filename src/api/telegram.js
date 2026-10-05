// POST /api/telegram : le webhook du bot (les commandes /link, /unlink, /status des groupes).
// Telegram signe chaque appel avec le secret réglé par le cron (lib/publish.js).
import { json } from '../../lib/http.js';
import { handleUpdate, webhookSecret } from '../../lib/publish.js';
import { ensureSchema } from '../../lib/schema.js';

export async function telegramHook({ request, env }) {
  if (!env.TELEGRAM_BOT_TOKEN) return json({ error: 'not_found' }, 404);
  if (request.headers.get('x-telegram-bot-api-secret-token') !== await webhookSecret(env)) return json({ error: 'unauthorized' }, 401);
  await ensureSchema(env.DB);
  const update = await request.json().catch(() => null);
  try {
    await handleUpdate(env, update);
  } catch (err) {
    console.error('telegram update', err.message);
  }
  return json({ ok: true });
}
