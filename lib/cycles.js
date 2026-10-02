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
    await db.prepare("UPDATE cycles SET ended_at = ?, status = 'ended', step_at = ? WHERE id = ? AND ended_at IS NULL")
      .bind(now, now, open.id).run();
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

// L'historique : les dernières bougies fondues et leur buyback.
export async function recentCycles(db, limit = 12) {
  const { results } = await db.prepare(
    `SELECT id, started_at, ended_at, matches, status, note, buy_sol, buy_sig, burn_sig, burned_ui
     FROM cycles WHERE ended_at IS NOT NULL ORDER BY id DESC LIMIT ?`,
  ).bind(limit).all();
  return results.map((r) => ({
    number: r.id,
    endedAt: r.ended_at,
    matches: r.matches,
    status: r.status,
    note: r.note,
    buySol: r.buy_sol,
    buySig: r.buy_sig,
    burnSig: r.burn_sig,
    burned: r.burned_ui,
  }));
}

export async function burnTotals(db) {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(burned_ui), 0) AS burned, COALESCE(SUM(buy_sol), 0) AS sol, COUNT(*) AS buybacks
     FROM cycles WHERE status = 'burned' AND burned_ui > 0`,
  ).first();
  return { burned: row.burned, sol: row.sol, buybacks: row.buybacks };
}
