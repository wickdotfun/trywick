// Les allumettes dans la base D1.
import { candleState } from './candle.js';
import { CONFIG, matchesPerCandle } from './config.js';
import { getTransaction, judgeConfirmed } from './solana.js';

const PUBLIC = 'seq, mint, creator, name, symbol, image, dev_buy AS devBuy, lit_at AS at';

export function getMatch(db, mint) {
  return db.prepare('SELECT * FROM matches WHERE mint = ?').bind(mint).first();
}

export function publicMatch(row) {
  return {
    seq: row.seq, mint: row.mint, creator: row.creator, name: row.name, symbol: row.symbol,
    image: row.image, devBuy: row.devBuy ?? row.dev_buy, at: row.at ?? row.lit_at,
  };
}

// La transaction est confirmée : l'allumette prend le numéro suivant, en une seule
// requête (D1 exécute les écritures une par une, deux allumettes n'ont jamais le même).
export async function lightMatch(db, mint, now) {
  await db.prepare(
    'UPDATE matches SET seq = (SELECT COALESCE(MAX(seq), 0) + 1 FROM matches), lit_at = ? WHERE mint = ? AND seq IS NULL',
  ).bind(now, mint).run();
  return getMatch(db, mint);
}

// Regarde où en est une allumette envoyée. Renvoie la ligne (à jour) et son état :
// 'lit', 'pending', 'failed' ou 'prepared' (rien d'envoyé).
export async function settle(env, row, now) {
  if (row.seq != null) return { row, status: 'lit' };
  if (!row.signature) return { row, status: 'prepared' };
  const verdict = judgeConfirmed(await getTransaction(env, row.signature), row);
  if (verdict === 'ok') return { row: await lightMatch(env.DB, row.mint, now), status: 'lit' };
  if (verdict === 'failed' || verdict === 'mismatch') {
    // On efface la signature : le créateur peut réessayer avec le même mint.
    await env.DB.prepare('UPDATE matches SET signature = NULL, sent_at = NULL WHERE mint = ? AND seq IS NULL')
      .bind(row.mint).run();
    return { row, status: 'failed' };
  }
  return { row, status: 'pending' };
}

// Tout ce que le site affiche. since = le dernier seq déjà connu du navigateur.
export async function worldState(env, now, since = 0) {
  const per = matchesPerCandle(env);
  const db = env.DB;
  const [{ total }, { heat }] = await Promise.all([
    db.prepare('SELECT COALESCE(MAX(seq), 0) AS total FROM matches').first(),
    db.prepare('SELECT COUNT(*) AS heat FROM matches WHERE lit_at > ?').bind(now - CONFIG.heatWindowMs).first(),
  ]);
  const candle = candleState(total, per);
  const from = Math.max(Number(since) || 0, candle.firstSeq - 1);
  const [{ results: matches }, { results: finals }] = await Promise.all([
    db.prepare(`SELECT ${PUBLIC} FROM matches WHERE seq > ? ORDER BY seq LIMIT ?`)
      .bind(from, CONFIG.maxMatchesPerResponse).all(),
    // Les dernières allumettes des bougies déjà fondues (les 12 plus récentes).
    candle.burnedOut
      ? db.prepare(`SELECT ${PUBLIC} FROM matches WHERE seq > 0 AND seq % ? = 0 ORDER BY seq DESC LIMIT 12`).bind(per).all()
      : { results: [] },
  ]);
  return {
    now,
    total,
    heat,
    candle,
    matches: matches.map(publicMatch),
    finals: finals.map((m) => ({ candle: m.seq / per, match: publicMatch(m) })),
  };
}

// Le cron : on vérifie les allumettes envoyées, on oublie celles jamais signées.
export async function sweep(env, now) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM matches WHERE seq IS NULL AND signature IS NOT NULL AND sent_at > ? LIMIT 25',
  ).bind(now - CONFIG.pendingTtlMs).all();
  for (const row of results) {
    try { await settle(env, row, now); } catch (err) { console.error('sweep', row.mint, err?.message); }
  }
  const old = now - CONFIG.pendingTtlMs;
  await env.DB.prepare('DELETE FROM matches WHERE seq IS NULL AND created_at < ? AND (sent_at IS NULL OR sent_at < ?)')
    .bind(old, old).run();
}
