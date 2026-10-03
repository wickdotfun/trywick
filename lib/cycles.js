// Les bougies (cycles) dans la base D1 : celle qui brûle, celles qui ont fondu.
import { cycleProgress } from './candle.js';
import { cycleTiming } from './config.js';

export function getOpenCycle(db) {
  return db.prepare('SELECT * FROM cycles WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1').first();
}

// La bougie qui brûle maintenant. Si elle a fini de fondre, elle s'éteint (son buyback
// partira au prochain cron) et une nouvelle s'allume. Renvoie la bougie allumée.
export async function tickCycle(env, now) {
  const db = env.DB;
  const timing = cycleTiming(env);
  for (let i = 0; i < 3; i++) {
    const open = await getOpenCycle(db);
    if (!open) {
      // INSERT OR IGNORE : l'index cycles_one_open refuse une deuxième bougie allumée.
      await db.prepare('INSERT OR IGNORE INTO cycles (started_at) VALUES (?)').bind(now).run();
      continue;
    }
    const p = cycleProgress({ startedAt: open.started_at, matches: open.matches }, now, timing);
    if (!p.done) return open;
    const res = await db.prepare("UPDATE cycles SET ended_at = ?, status = 'ended', step_at = ? WHERE id = ? AND ended_at IS NULL")
      .bind(now, now, open.id).run();
    // Son buyback rejoint la file des burns (une seule fois, même si deux requêtes l'éteignent).
    if (res.meta?.changes === 1) {
      await db.prepare("INSERT OR IGNORE INTO burns (kind, ref, created_at) VALUES ('candle', ?, ?)")
        .bind(String(open.id), now).run();
    }
  }
  return getOpenCycle(db);
}

export function publicCycle(row, env, now) {
  const timing = cycleTiming(env);
  const p = cycleProgress({ startedAt: row.started_at, matches: row.matches }, now, timing);
  return {
    number: row.id,
    startedAt: row.started_at,
    matches: row.matches,
    durationMs: timing.durationMs,
    matchMs: timing.matchMs,
    melted: p.melted,
    endsAt: p.endsAt,
  };
}

// L'historique : les dernières bougies fondues et leur buyback. (Les bougies d'avant la file
// des burns gardent leur état dans la table cycles.)
export async function recentCycles(db, limit = 12) {
  const { results } = await db.prepare(
    `SELECT c.id, c.ended_at, c.matches, COALESCE(b.status, c.status) AS status, COALESCE(b.note, c.note) AS note,
       COALESCE(b.sol, c.buy_sol) AS sol, b.buy_sig, b.burn_sig, COALESCE(b.burned_ui, c.burned_ui) AS burned
     FROM cycles c LEFT JOIN burns b ON b.kind = 'candle' AND b.ref = CAST(c.id AS TEXT)
     WHERE c.ended_at IS NOT NULL ORDER BY c.id DESC LIMIT ?`,
  ).bind(limit).all();
  return results.map((r) => ({
    number: r.id,
    endedAt: r.ended_at,
    matches: r.matches,
    status: r.status === 'queued' ? 'ended' : r.status,
    note: r.note,
    buySol: r.sol,
    buySig: r.buy_sig,
    burnSig: r.burn_sig,
    burned: r.burned,
  }));
}

// Les totaux : tout ce qui a été brûlé, en $WICK et en SOL, par les bougies et les lancements.
export async function burnTotals(db) {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(burned_ui), 0) AS burned, COALESCE(SUM(sol), 0) AS sol,
       SUM(kind = 'candle') AS buybacks, SUM(kind = 'match') AS matchBurns
     FROM burns WHERE status = 'burned' AND burned_ui > 0`,
  ).first();
  return { burned: row.burned, sol: row.sol, buybacks: row.buybacks ?? 0, matchBurns: row.matchBurns ?? 0 };
}

// Les lancements : combien de coins, les Ignition Fees payées (en SOL) et le volume des coins
// échangés ces dernières 24 h (DexScreener, rafraîchi par le cron).
export async function launchTotals(db, now) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS launches,
       COALESCE(SUM(CASE WHEN fee_state = 'paid' THEN fee_lamports END), 0) AS fees,
       COALESCE(SUM(CASE WHEN fee_state = 'paid' THEN team_lamports END), 0) AS team,
       COALESCE(SUM(CASE WHEN mcap_at > ? THEN vol24h END), 0) AS volume
     FROM matches WHERE seq IS NOT NULL`,
  ).bind(now - 24 * 3600_000).first();
  const last = await db.prepare('SELECT mint, symbol, lit_at AS at, signature AS sig FROM matches WHERE seq IS NOT NULL ORDER BY seq DESC LIMIT 1').first();
  return { launches: row.launches, ignitionSol: row.fees / 1e9, ignitionTeamSol: row.team / 1e9, ignitionBurnSol: (row.fees - row.team) / 1e9, volume24h: row.volume, lastLaunch: last ? { ...last } : null };
}

// Le suivi des burns : chaque burn (date, quantité, sorte), pour la courbe cumulée et la liste.
export async function burnLog(db, limit = 400) {
  const { results } = await db.prepare(
    `SELECT b.kind, b.ref, b.burned_at AS at, b.burned_ui AS burned, b.sol, b.burn_sig AS sig, m.symbol
     FROM burns b LEFT JOIN matches m ON b.kind = 'match' AND m.mint = b.ref
     WHERE b.status = 'burned' AND b.burned_ui > 0 ORDER BY b.burned_at DESC LIMIT ?`,
  ).bind(limit).all();
  return results;
}
