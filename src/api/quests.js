// GET /api/quests : mes quêtes (faites, en cours, à venir) et mon code.
// POST /api/quest { id, step?, url? } : faire avancer la quête en cours.
import { json } from '../../lib/http.js';
import { HONOR_DELAY, OFFICIAL_X, checkPost, codesFor, fetchPost, parseStatusUrl } from '../../lib/quests.js';
import { addEvents } from '../../lib/store.js';
import { forgetCommunityCache, saveCandle } from '../../lib/world.js';
import { context, loadQuests as load, snapshot } from './common.js';

async function payload(env, ctx, now, states) {
  return {
    code: ctx.player ? (await codesFor(ctx.player.row, env.IP_SALT || ''))[0] : null,
    x: ctx.player?.view.x ?? null,
    official: OFFICIAL_X,
    needCandle: !ctx.candle || Boolean(ctx.candle.diedAt),
    // Le lien « follow » suit le compte X réglé dans Cloudflare (X_URL), s'il existe.
    quests: states.map((q) => (q.id === 'follow' && env.X_URL ? { ...q, url: env.X_URL } : q)),
  };
}

export async function onRequestGet({ request, env }) {
  const now = Date.now();
  const ctx = await context(request, env, now);
  const { states } = await load(env, ctx, now);
  return json(await payload(env, ctx, now, states));
}

// why : un petit détail technique (ce qu'X a répondu), affiché discrètement pour comprendre un échec.
const fail = (error, status = 409, why = undefined) => json({ error, ...(why ? { why } : {}) }, status);

export async function onRequestPost({ request, env }) {
  const now = Date.now();
  let body;
  try { body = await request.json(); } catch { return fail('bad_json', 400); }
  const ctx = await context(request, env, now);
  if (!ctx.player) return fail('no_player', 401);
  if (!ctx.candle || ctx.candle.diedAt) return fail('no_candle');
  const { quests, rows, states } = await load(env, ctx, now);
  const quest = quests.find((q) => q.id === body?.id);
  const state = states.find((q) => q.id === body?.id);
  if (!quest) return fail('unknown_quest', 404);
  if (state.status === 'done') return fail('already_done');
  if (state.status !== 'current') return fail('locked');
  const db = env.DB;
  const pid = ctx.player.row.id;
  let proof = null;

  if (quest.kind === 'honor') {
    // 1re étape : le lien vient d'être ouvert. On note l'heure, puis on attend quelques secondes.
    if (body.step === 'start') {
      await db.prepare(`INSERT INTO quests (player_id, quest, started_at) VALUES (?, ?, ?)
        ON CONFLICT(player_id, quest) DO UPDATE SET started_at = COALESCE(quests.started_at, excluded.started_at)`)
        .bind(pid, quest.id, now).run();
      const again = await load(env, ctx, now);
      return json(await payload(env, ctx, now, again.states));
    }
    const started = rows.get(quest.id)?.started_at;
    if (!started || now - started < HONOR_DELAY) return fail('too_soon');
  }

  if (quest.kind === 'game' && !state.ready) return fail('not_yet');

  if (quest.kind.startsWith('x_')) {
    const post = await fetchPost(body.url);
    if (post.error) return fail(post.error, post.error === 'x_unreachable' ? 502 : 400, post.why);
    const x = ctx.player.view.x;
    if (quest.kind !== 'x_claim' && !x) return fail('link_first');
    const err = checkPost(post, {
      codes: await codesFor(ctx.player.row, env.IP_SALT || ''),
      handle: quest.kind === 'x_claim' ? null : x,
      // Claim : une réponse au post d'annonce. Une quête x_post avec un lien : une réponse à ce post.
      replyTo: parseStatusUrl(quest.kind === 'x_photo' ? null : quest.url)?.id ?? null,
      photo: quest.kind === 'x_photo',
    });
    if (err) return fail(err, 400, `${post.source}: @${post.author} “${post.text.slice(0, 90)}”`);
    proof = `x:${post.id}`;
    const used = await db.prepare('SELECT player_id FROM quests WHERE proof = ?').bind(proof).first();
    if (used) return fail('proof_used');
    if (quest.kind === 'x_claim') {
      const taken = await db.prepare('SELECT id FROM players WHERE lower(x_handle) = lower(?) AND id != ?').bind(post.author, pid).first();
      if (taken) return fail('handle_taken');
      await db.prepare('UPDATE players SET x_handle = ? WHERE id = ?').bind(post.author, pid).run();
      ctx.player.view.x = post.author;
      ctx.player.row.x_handle = post.author;
    }
  }

  // Quête réussie : elle est notée, et la bougie gagne sa croissance.
  await db.prepare(`INSERT INTO quests (player_id, quest, done_at, proof) VALUES (?, ?, ?, ?)
    ON CONFLICT(player_id, quest) DO UPDATE SET done_at = excluded.done_at, proof = excluded.proof`)
    .bind(pid, quest.id, now, proof).run();
  ctx.candle = { ...ctx.candle, growth: ctx.candle.growth + quest.rewardMs };
  await saveCandle(db, ctx.candle);
  await addEvents(db, now, [{ kind: 'quest', who: ctx.candle.name, candle: ctx.candle.id, detail: quest.title }]);
  forgetCommunityCache();
  const after = await load(env, ctx, now);
  return json({
    ok: true, rewardMs: quest.rewardMs,
    ...await snapshot(env, now, ctx),
    questsData: await payload(env, ctx, now, after.states),
  });
}
