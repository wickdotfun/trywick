// POST /api/light { lang } : gratter l'allumette = allumer SA bougie.
// Au tout premier passage, on crée aussi le joueur : la réponse contient alors
// son jeton et sa phrase de flamme (une seule fois).
import { ipHash, json } from '../../lib/http.js';
import { LINES, langOf, pick } from '../../lib/lines.js';
import { CONFIG } from '../../lib/config.js';
import { checkName, createPlayer, nameTaken } from '../../lib/players.js';
import { addEvents } from '../../lib/store.js';
import { birthsFromIp, forgetCommunityCache, insertCandle } from '../../lib/world.js';
import { context, snapshot } from './common.js';

export async function onRequestPost({ request, env }) {
  const now = Date.now();
  let body = {};
  try { body = await request.json(); } catch { /* corps vide accepté */ }
  const lang = langOf(body?.lang);
  const ctx = await context(request, env, now);
  if (ctx.candle && !ctx.candle.diedAt) return json({ error: 'already_lit' }, 409);

  // En local, tous les visiteurs partagent la même IP : DEV_NO_IP_LIMIT=1 lève cette limite.
  const ip = await ipHash(request, env);
  if (!env.DEV_NO_IP_LIMIT && await birthsFromIp(env.DB, ip, now) >= CONFIG.maxBirthsPerIpPerDay) {
    return json({ error: 'too_many_births', line: pick(LINES[lang].tooMany) }, 429);
  }

  let welcome = null;
  if (!ctx.player) {
    // Le pseudo choisi (vérifié ici aussi), sinon un pseudo libre au hasard.
    let name = null;
    if (body?.name) {
      const checked = checkName(body.name);
      if (checked.error) return json({ error: 'bad_name', reason: checked.error }, 400);
      if (await nameTaken(env.DB, checked.name)) return json({ error: 'name_taken' }, 409);
      name = checked.name;
    }
    let created;
    try {
      created = await createPlayer(env.DB, now, name);
    } catch (err) {
      // Deux visiteurs ont pris le même pseudo à la même seconde.
      if (/UNIQUE/i.test(String(err?.message))) return json({ error: 'name_taken' }, 409);
      throw err;
    }
    ctx.player = created;
    welcome = { token: created.token, phrase: created.phrase };
  }
  const reborn = Boolean(ctx.candle);
  ctx.candle = await insertCandle(env.DB, ctx.player.view, ip, now);
  await addEvents(env.DB, now, [{ kind: 'born', who: ctx.candle.name, candle: ctx.candle.id, detail: ctx.candle.gen }]);
  forgetCommunityCache();

  return json({
    ...await snapshot(env, now, ctx),
    line: pick(LINES[lang].event[reborn ? 'reborn' : 'born']),
    ...(welcome ? { welcome } : {}),
  });
}
