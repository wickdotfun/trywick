// « Make it burn » : chaque coin lancé sur WICK peut se brûler lui-même. Une part de ses creator
// fees (choisie au lancement, verrouillée sur pump.fun) le rachète et le brûle, pour toujours :
// le coin devient une bougie. Ce module lit ces bougies pour le site (la forêt, la page d'un coin,
// le fil des burns). Le rachat lui-même passe par la file des burns (lib/buyback.js, kind 'coin').
import { constitution, operatorLog } from './operator.js';
import { PUBLIC, publicMatch } from './matches.js';

const SHARING = "('shared', 'sent', 'held', 'sending')";
// Le coin d'un burn « coin » : sa ref est « mint:id de la distribution ».
const COIN_OF_BURN = "substr(b.ref, 1, instr(b.ref, ':') - 1)";

// Les derniers burns des coins qui se brûlent eux-mêmes (pour le fil).
export async function coinBurnLog(db, limit = 30, mint = null) {
  const { results } = await db.prepare(
    `SELECT b.burned_at AS at, b.burned_ui AS burned, b.sol, b.burn_sig AS sig, b.voice, m.mint, m.symbol, m.image
     FROM burns b JOIN matches m ON m.mint = ${COIN_OF_BURN}
     WHERE b.kind = 'coin' AND b.status = 'burned' AND b.burned_ui > 0 ${mint ? 'AND m.mint = ?' : ''}
     ORDER BY b.burned_at DESC LIMIT ?`,
  ).bind(...(mint ? [mint, limit] : [limit])).all();
  return results;
}

// Les totaux : combien de coins brûlent, combien de burns, combien de SOL y sont passés.
export async function candleTotals(db) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS candles, COALESCE(SUM(self_burns), 0) AS burns, COALESCE(SUM(self_sol), 0) AS sol
     FROM matches WHERE seq IS NOT NULL AND self_bps > 0 AND share_state IN ${SHARING}`,
  ).first();
  return { candles: row.candles, candleBurns: row.burns, candleSol: row.sol };
}

// La forêt : les coins qui se brûlent eux-mêmes, les plus brûlés d'abord, puis les plus gros.
export async function candleForest(db, limit = 40) {
  const { results } = await db.prepare(
    `SELECT ${PUBLIC} FROM matches WHERE seq IS NOT NULL AND self_bps > 0 AND share_state IN ${SHARING}
     ORDER BY self_burned DESC, COALESCE(mcap, 0) DESC, seq DESC LIMIT ?`,
  ).bind(limit).all();
  return results.map(publicMatch);
}

// La page d'un coin : le coin, sa bougie et chacun de ses burns.
export async function coinPage(db, mint) {
  const row = await db.prepare(`SELECT ${PUBLIC}, description, fee_sig FROM matches WHERE mint = ? AND seq IS NOT NULL`).bind(mint).first();
  if (!row) return null;
  const [burns, log] = await Promise.all([coinBurnLog(db, 100, mint), operatorLog(db, mint, 60)]);
  // Son Operator : sa Constitution (fixée au lancement) et son journal d'actions.
  return {
    match: { ...publicMatch(row), description: row.description || null },
    burns,
    operator: { constitution: constitution(row), log },
  };
}
