// La salle des bougies : chaque bougie consumée (un palier de supply de $WICK brûlé pour de
// bon) y reste, avec son histoire : quand, combien de coins lancés pendant qu'elle brûlait,
// combien de $WICK, les SOL dépensés en rachats, ses burns (et le dernier), et le coin le plus chaud.
import { supplyCandle } from './candle.js';
import { candlePct } from './config.js';
import { supplyBurned } from './supply.js';

export async function lastHall(db) {
  return db.prepare('SELECT * FROM hall ORDER BY number DESC LIMIT 1').first();
}

export async function hallList(db, limit = 20) {
  const { results } = await db.prepare('SELECT * FROM hall ORDER BY number DESC LIMIT ?').bind(limit).all();
  return results.map((h) => ({
    number: h.number, startedAt: h.started_at, completedAt: h.completed_at, launches: h.launches,
    burned: h.burned, pct: h.pct, top: h.top_mint ? { mint: h.top_mint, symbol: h.top_symbol, mcap: h.top_mcap } : null,
    sol: h.sol ?? null, burns: h.burns ?? null, sig: h.last_sig ?? null,
  }));
}

// Après chaque burn : les paliers franchis entrent dans la salle (une seule fois chacun).
export async function checkMilestones(env, now) {
  const db = env.DB;
  const supply = await supplyBurned(env, now);
  if (!supply.original) return 0;
  const step = candlePct(env);
  const candle = supplyCandle(supply.pct, step);
  const last = await lastHall(db);
  let added = 0;
  let prev = last;
  for (let n = (last?.number ?? 0) + 1; n <= candle.consumed; n++) {
    const startedAt = prev?.completed_at ?? 0;
    const [{ launches }, top, spent, lastBurn] = await Promise.all([
      db.prepare('SELECT COUNT(*) AS launches FROM matches WHERE seq IS NOT NULL AND lit_at > ? AND lit_at <= ?').bind(startedAt, now).first(),
      db.prepare('SELECT mint, symbol, mcap FROM matches WHERE seq IS NOT NULL AND lit_at > ? AND lit_at <= ? AND mcap > 0 ORDER BY mcap DESC LIMIT 1')
        .bind(startedAt, now).first(),
      // Les SOL dépensés en rachats pendant cette bougie, et ses burns.
      db.prepare("SELECT COALESCE(SUM(sol), 0) AS sol, COUNT(*) AS n FROM burns WHERE status = 'burned' AND burned_at > ? AND burned_at <= ?")
        .bind(startedAt, now).first(),
      db.prepare("SELECT burn_sig FROM burns WHERE status = 'burned' AND burned_at <= ? ORDER BY burned_at DESC LIMIT 1").bind(now).first(),
    ]);
    const res = await db.prepare(
      `INSERT OR IGNORE INTO hall (number, started_at, completed_at, launches, burned, pct, top_mint, top_symbol, top_mcap, sol, burns, last_sig)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(n, startedAt, now, launches, (supply.original * step) / 100, n * step,
      top?.mint ?? null, top?.symbol ?? null, top?.mcap ?? null, spent.sol, spent.n, lastBurn?.burn_sig ?? null).run();
    if (res.meta?.changes === 1) added++;
    prev = { completed_at: now };
  }
  return added;
}
