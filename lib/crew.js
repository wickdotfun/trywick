// La page du crew (GET /api/crew) : ses quatre agents au travail, en direct.
// Scout : ses narratifs du moment, avec leurs sources. Chandler : les derniers coins qu'il a faits.
// Igniter : les derniers lancements, avec leur transaction. Operator : ce que les Operators font
// en ce moment (leur journal d'actions), et ceux qui portent les plus gros coins.
import { CONFIG } from './config.js';
import { keeperModel } from './keepers.js';
import { scoutPicks } from './scout.js';

const K = CONFIG.keepers;
const mind = (id) => {
  const m = keeperModel(id) || K.models[0];
  return { id: m.id, name: m.name, by: m.by, logo: m.logo };
};
const coin = (r) => ({
  mint: r.mint, symbol: r.symbol, name: r.name, image: r.image, mcap: r.mcap || null,
  character: K.styles[r.keeper_style]?.label || null, goal: K.goals[r.keeper_goal]?.label || null, mind: mind(r.keeper_model),
});

export async function crewPage(db, now = Date.now()) {
  const COIN = 'm.mint, m.symbol, m.name, m.image, m.mcap, m.keeper_style, m.keeper_goal, m.keeper_model';
  const [scout, live, fresh, top, stats] = await Promise.all([
    scoutPicks(db),
    db.prepare(`SELECT l.at, l.kind, l.title, l.detail, l.sig, ${COIN} FROM operator_log l JOIN matches m ON m.mint = l.mint
      WHERE l.kind NOT IN ('launched', 'sealed') ORDER BY l.at DESC, l.id DESC LIMIT 16`).all(),
    db.prepare(`SELECT ${COIN}, m.description, m.lit_at AS at, m.signature AS sig, m.self_bps FROM matches m
      WHERE m.seq IS NOT NULL AND m.keeper_style IS NOT NULL ORDER BY m.lit_at DESC LIMIT 8`).all(),
    db.prepare(`SELECT ${COIN}, m.change24h AS change, m.self_burns FROM matches m
      WHERE m.seq IS NOT NULL AND m.keeper_style IS NOT NULL AND m.mcap > 0 AND m.lit_at > ? ORDER BY m.mcap DESC LIMIT 6`).bind(now - 30 * 86_400_000).all(),
    db.prepare(`SELECT (SELECT COUNT(*) FROM matches WHERE seq IS NOT NULL AND keeper_style IS NOT NULL) AS coins,
      (SELECT COUNT(*) FROM operator_log) AS actions,
      (SELECT COUNT(*) FROM operator_log WHERE kind = 'burned') AS burns,
      (SELECT COUNT(*) FROM operator_log WHERE kind = 'posted') AS posts`).first(),
  ]);
  return {
    scout: scout ? { at: scout.at, ai: scout.ai, narratives: scout.narratives, sources: scout.sources, seen: scout.seen } : null,
    live: live.results.map((r) => ({ at: r.at, kind: r.kind, title: r.title, detail: r.detail, sig: r.sig, coin: coin(r) })),
    fresh: fresh.results.map((r) => ({ ...coin(r), about: r.description, at: r.at, sig: r.sig, burns: r.self_bps > 0 ? r.self_bps / 100 : 0 })),
    top: top.results.map((r) => ({ ...coin(r), change: r.change, burns: r.self_burns || 0 })),
    stats: { coins: stats?.coins || 0, actions: stats?.actions || 0, burns: stats?.burns || 0, posts: stats?.posts || 0 },
  };
}
