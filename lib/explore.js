// Explorer les coins lancés avec WICK, et le profil de chaque wallet (« Your flames »).
// Uniquement des données réelles : la base (lancements confirmés on-chain, burns), et le
// marché DexScreener que le cron rafraîchit.
import { PUBLIC, publicMatch } from './matches.js';
import { titleFor } from './leaderboard.js';

const DAY = 24 * 3600_000;

// Les tris de la page Explore.
// - trending : les coins des 3 derniers jours, par volume sur 24 h ;
// - new : les plus récents ;
// - volume : tous les coins, par volume sur 24 h ;
// - burner : ceux qui ont fait brûler le plus de $WICK.
export const SORTS = {
  trending: { where: 'AND lit_at > ?', order: 'COALESCE(volume, 0) DESC, COALESCE(mcap, 0) DESC, seq DESC', since: 3 * DAY },
  new: { where: '', order: 'seq DESC' },
  volume: { where: '', order: 'COALESCE(volume, 0) DESC, seq DESC' },
  burner: { where: '', order: 'COALESCE(burned, 0) DESC, seq DESC' },
};

export async function exploreLaunches(db, { sort = 'trending', offset = 0, limit = 30, now = Date.now() } = {}) {
  const s = SORTS[sort] || SORTS.trending;
  const binds = s.since ? [now - s.since] : [];
  const { results } = await db.prepare(
    `SELECT * FROM (SELECT ${PUBLIC} FROM matches WHERE seq IS NOT NULL ${s.where})
     ORDER BY ${s.order} LIMIT ? OFFSET ?`,
  ).bind(...binds, Math.min(60, limit) + 1, Math.max(0, offset)).all();
  const more = results.length > limit;
  return { sort: SORTS[sort] ? sort : 'trending', coins: results.slice(0, limit).map(publicMatch), more };
}

// Les succès d'un wallet, calculés sur ses lancements.
export const ACHIEVEMENTS = [
  { id: 'first', icon: '🔥', label: 'First Match', hint: 'Launch your first coin', test: (p) => p.launches >= 1 },
  { id: 'firestarter', icon: '🧨', label: 'Firestarter', hint: 'Launch 3 coins', test: (p) => p.launches >= 3 },
  { id: 'arsonist', icon: '🚒', label: 'Arsonist', hint: 'Launch 10 coins', test: (p) => p.launches >= 10 },
  { id: 'burn100k', icon: '🕯️', label: 'Burned 100K $WICK', hint: 'Your launches burn 100K $WICK', test: (p) => p.burned >= 100_000 },
  { id: 'burn1m', icon: '🌋', label: 'Burned 1M $WICK', hint: 'Your launches burn 1M $WICK', test: (p) => p.burned >= 1_000_000 },
  { id: 'golden', icon: '👑', label: 'Golden Flame', hint: 'Launch a coin while holding $WICK', test: (p) => p.holder },
  { id: 'busy', icon: '📈', label: 'Busy Flame', hint: 'One of your coins trades $10K in a day', test: (p) => p.bestVolume >= 10_000 },
  { id: 'viral', icon: '🚀', label: 'Viral Flame', hint: 'One of your coins reaches a $100K market cap', test: (p) => p.bestMcap >= 100_000 },
];

export async function walletProfile(db, wallet, now = Date.now()) {
  const [stats, { results }, rank] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS launches, MAX(holder) AS holder, MIN(lit_at) AS since,
         COALESCE(SUM(CASE WHEN mcap_at > ? THEN vol24h END), 0) AS volume,
         COALESCE(MAX(mcap_peak), 0) AS bestMcap, COALESCE(MAX(vol_peak), 0) AS bestVolume,
         COALESCE(SUM(CASE WHEN fee_state = 'paid' THEN fee_lamports END), 0) AS fees,
         COALESCE((SELECT SUM(b.burned_ui) FROM burns b JOIN matches m2 ON b.kind = 'match' AND b.ref = m2.mint
           WHERE m2.creator = ? AND b.status = 'burned'), 0) AS burned
       FROM matches WHERE creator = ? AND seq IS NOT NULL`,
    ).bind(now - DAY, wallet, wallet).first(),
    db.prepare(`SELECT ${PUBLIC} FROM matches WHERE creator = ? AND seq IS NOT NULL ORDER BY seq DESC LIMIT 50`).bind(wallet).all(),
    // Le rang dans le classement des Pyromanes (par $WICK brûlé, puis par lancements).
    db.prepare(
      `WITH c AS (
         SELECT m.creator, COUNT(*) AS launches, COALESCE(SUM(b.burned_ui), 0) AS burned
         FROM matches m LEFT JOIN burns b ON b.kind = 'match' AND b.ref = m.mint AND b.status = 'burned'
         WHERE m.seq IS NOT NULL GROUP BY m.creator)
       SELECT (SELECT COUNT(*) FROM c WHERE c.burned > me.burned OR (c.burned = me.burned AND c.launches > me.launches)) + 1 AS rank,
         (SELECT COUNT(*) FROM c) AS of
       FROM c AS me WHERE me.creator = ?`,
    ).bind(wallet).first(),
  ]);
  const p = {
    wallet,
    launches: stats.launches,
    holder: Boolean(stats.holder),
    since: stats.since,
    burned: stats.burned,
    volume24h: stats.volume,
    bestMcap: stats.bestMcap,
    bestVolume: stats.bestVolume,
    ignitionSol: stats.fees / 1e9,
  };
  return {
    ...p,
    title: p.launches ? titleFor(p.launches) : null,
    rank: rank ? { rank: rank.rank, of: rank.of } : null,
    achievements: ACHIEVEMENTS.map(({ id, icon, label, hint, test }) => ({ id, icon, label, hint, done: Boolean(test(p)) })),
    coins: results.map(publicMatch),
  };
}
