// Le classement des Pyromanes : les créateurs qui ont lancé des coins sur WICK, classés par le
// $WICK que leurs lancements ont fait brûler, puis par nombre de lancements.
export const TITLES = [
  [25, 'Pyromaniac'],
  [10, 'Arsonist'],
  [3, 'Firestarter'],
  [1, 'Spark'],
];

export function titleFor(launches) {
  return (TITLES.find(([min]) => launches >= min) || [0, 'Spark'])[1];
}

let cache = null;

export async function leaderboard(db, now, limit = 25) {
  if (cache && now - cache.at < 60_000) return cache.data;
  const { results } = await db.prepare(
    `SELECT m.creator, COUNT(*) AS launches, MAX(m.holder) AS holder,
       COALESCE(SUM(b.burned_ui), 0) AS burned,
       (SELECT symbol FROM matches m2 WHERE m2.creator = m.creator AND m2.seq IS NOT NULL ORDER BY m2.mcap DESC LIMIT 1) AS bestSymbol,
       (SELECT mint FROM matches m2 WHERE m2.creator = m.creator AND m2.seq IS NOT NULL ORDER BY m2.mcap DESC LIMIT 1) AS bestMint,
       MAX(m.mcap) AS bestMcap
     FROM matches m LEFT JOIN burns b ON b.kind = 'match' AND b.ref = m.mint AND b.status = 'burned'
     WHERE m.seq IS NOT NULL
     GROUP BY m.creator ORDER BY burned DESC, launches DESC LIMIT ?`,
  ).bind(limit).all();
  const data = results.map((r, i) => ({
    rank: i + 1,
    creator: r.creator,
    launches: r.launches,
    burned: r.burned,
    holder: Boolean(r.holder),
    title: titleFor(r.launches),
    best: r.bestMint ? { mint: r.bestMint, symbol: r.bestSymbol, mcap: r.bestMcap } : null,
  }));
  cache = { at: now, data };
  return data;
}
