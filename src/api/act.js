// POST /api/act { action: 'nourrir' | 'abri', lang }, avec le jeton du joueur.
import { ACTIONS, applyAction } from '../../lib/candles.js';
import { json } from '../../lib/http.js';
import { LINES, langOf, pick } from '../../lib/lines.js';
import { addEvents } from '../../lib/store.js';
import { saveCandle } from '../../lib/world.js';
import { context, snapshot } from './common.js';

export async function onRequestPost({ request, env }) {
  const now = Date.now();
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const action = body?.action;
  const lang = langOf(body?.lang);
  if (!ACTIONS.includes(action)) return json({ error: 'unknown_action' }, 400);

  const ctx = await context(request, env, now);
  const result = applyAction(ctx.candle, action, now);
  if (result.error) {
    const line = result.error === 'cooldown' ? pick(LINES[lang].cooldown) : null;
    return json({ error: result.error, line, ...await snapshot(env, now, ctx) }, result.error === 'cooldown' ? 429 : 409);
  }
  ctx.candle = result.candle;
  await saveCandle(env.DB, ctx.candle);
  await addEvents(env.DB, now, [{ kind: action, who: ctx.candle.name, candle: ctx.candle.id }]);

  return json({ ok: true, line: pick(LINES[lang].act[action]), ...await snapshot(env, now, ctx) });
}
