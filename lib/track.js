// TRACK : l'Operator d'un coin suit son marché (market cap, volume 24 h, via lib/markets.js) et ses
// burns, et note dans son Activity les paliers franchis : une fois chacun, le plus haut franchi
// depuis le dernier noté, jamais plus d'un toutes les 15 minutes (le suivant attend son tour).
import { CONFIG } from './config.js';
import { burnedPct, crossed, usd } from './missions.js';
import { logAction } from './operator.js';

const OP = CONFIG.operator;

async function cooling(db, mint, now) {
  const last = await db.prepare("SELECT MAX(at) AS at FROM operator_log WHERE mint = ? AND kind = 'milestone'").bind(mint).first();
  return Boolean(last?.at && now - last.at < OP.cooldownMs);
}

// Après un rafraîchissement du marché d'un coin. m : { mint, symbol, keeper_style, op_mcap, op_vol },
// market : { mcap, vol }. Renvoie le palier noté (ou null).
export async function trackMarket(db, m, market, now) {
  if (!m.keeper_style) return null;
  const mcapHit = crossed(OP.mcapSteps, market.mcap, m.op_mcap);
  const volHit = crossed(OP.volSteps, market.vol, m.op_vol);
  if (!mcapHit && !volHit) return null;
  if (await cooling(db, m.mint, now)) return null;
  // La market cap d'abord ; le volume attendra le prochain passage.
  if (mcapHit) {
    await db.prepare('UPDATE matches SET op_mcap = ? WHERE mint = ? AND op_mcap < ?').bind(mcapHit, m.mint, mcapHit).run();
    await logAction(db, m.mint, {
      kind: 'milestone', at: now, ref: `mcap:${mcapHit}`,
      title: `Reached a ${usd(mcapHit)} market cap`,
      detail: `$${m.symbol} trades at a ${usd(market.mcap)} market cap.`,
    });
    return `mcap:${mcapHit}`;
  }
  await db.prepare('UPDATE matches SET op_vol = ? WHERE mint = ? AND op_vol < ?').bind(volHit, m.mint, volHit).run();
  await logAction(db, m.mint, {
    kind: 'milestone', at: now, ref: `vol:${volHit}`,
    title: `${usd(volHit)} traded in 24 hours`,
    detail: `$${m.symbol}'s busiest day so far: ${usd(market.vol)} of volume.`,
  });
  return `vol:${volHit}`;
}

// Après un burn du coin : la part de sa supply qu'il a brûlée d'elle-même.
export async function trackBurn(db, mint, now) {
  const m = await db.prepare('SELECT mint, symbol, self_burned, self_burns, self_sol, op_burn FROM matches WHERE mint = ?').bind(mint).first();
  if (!m) return null;
  const hit = crossed(OP.burnSteps, burnedPct(m), m.op_burn);
  if (!hit || (await cooling(db, mint, now))) return null;
  await db.prepare('UPDATE matches SET op_burn = ? WHERE mint = ? AND op_burn < ?').bind(hit, mint, hit).run();
  await logAction(db, mint, {
    kind: 'milestone', at: now, ref: `burn:${hit}`,
    title: `${hit}% of the $${m.symbol} supply burned`,
    detail: `${m.self_burns} burn${m.self_burns > 1 ? 's' : ''}, ${(+m.self_sol || 0).toFixed(3)} SOL of its creator fees.`,
  });
  return `burn:${hit}`;
}
