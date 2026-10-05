// Les allumettes dans la base D1.
import { buybackLive, buybackWallet, potSol } from './buyback.js';
import { supplyCandle } from './candle.js';
import { CONFIG, candlePct } from './config.js';
import { burnLog, burnTotals, launchTotals, publicCycle, recentCycles, tickCycle } from './cycles.js';
import { candleTotals, coinBurnLog } from './candles.js';
import { publicKeeper } from './keepers.js';
import { hallList, lastHall } from './hall.js';
import { buybackPaused } from './settings.js';
import { bytesFromBase64, getTransaction, judgeConfirmed, sendTransaction, signatureStatus, tokenHolding } from './solana.js';
import { shareTotals } from './sharing.js';
import { supplyBurned } from './supply.js';

// Ce que le site montre d'une allumette, avec le $WICK brûlé par son frais de lancement.
export const PUBLIC = `seq, mint, creator, name, symbol, image, dev_buy AS devBuy, lit_at AS at, holder, mcap,
  change24h AS change, vol24h AS volume, signature AS sig, fee_lamports, team_lamports, fee_state, share_bps, share_team_bps, share_state,
  self_bps, self_burned, self_sol, self_burns, keeper_style, keeper_model, keeper_intro, keeper_thought, keeper_thought_at,
  (SELECT burned_ui FROM burns WHERE kind = 'match' AND ref = matches.mint AND status = 'burned') AS burned`;

export function getMatch(db, mint) {
  return db.prepare('SELECT * FROM matches WHERE mint = ?').bind(mint).first();
}

function feeOf(row) {
  if (!(row.fee_state === 'paid' || row.fee_state === 'sent') || !(row.fee_lamports > 0)) return { fee: null, burnFee: null };
  return { fee: row.fee_lamports / 1e9, burnFee: (row.fee_lamports - (row.team_lamports || 0)) / 1e9 };
}

export function publicMatch(row) {
  return {
    seq: row.seq, mint: row.mint, creator: row.creator, name: row.name, symbol: row.symbol,
    image: row.image, devBuy: row.devBuy ?? row.dev_buy, at: row.at ?? row.lit_at,
    holder: Boolean(row.holder), mcap: row.mcap ?? null, change: row.change ?? row.change24h ?? null,
    burned: row.burned ?? null, volume: row.volume ?? row.vol24h ?? null, sig: row.sig ?? row.signature ?? null,
    // L'Ignition Fee de ce lancement (en SOL), envoyée avec lui (ou déjà confirmée on-chain), et
    // sa part qui brûle $WICK (l'autre va à l'équipe).
    ...feeOf(row),
    // Le partage des creator fees : la part de WICK (points de base : burn + équipe) une fois actif on-chain.
    share: row.share_bps > 0 && ['shared', 'sent', 'held', 'sending'].includes(row.share_state)
      ? { bps: row.share_bps - (row.self_bps || 0), teamBps: row.share_team_bps || 0, live: row.share_state === 'shared' } : null,
    // « Make it burn » : la bougie du coin (la part de ses fees qui le rachète et le brûle, ce qui
    // a déjà brûlé, en unités et en % de sa supply, les SOL que ça a coûté, le nombre de burns).
    candle: candleOf(row),
    // Son Keeper (l'agent IA du coin) : sa personnalité, son esprit, ses premiers mots, sa dernière pensée.
    keeper: publicKeeper(row),
  };
}

export function candleOf(row) {
  if (!(row.self_bps > 0) || !['shared', 'sent', 'held', 'sending'].includes(row.share_state)) return null;
  const burned = row.self_burned || 0;
  return {
    bps: row.self_bps,
    burned,
    pct: Math.min(100, (burned / CONFIG.pumpSupply) * 100),
    sol: row.self_sol || 0,
    burns: row.self_burns || 0,
    live: row.share_state === 'shared',
    keeper: publicKeeper(row),
  };
}

// Le créateur détient-il du $WICK ? (Alors son allumette brûle en or.)
async function isHolder(env, creator) {
  if (!env.TOKEN_MINT) return false;
  try {
    const h = await tokenHolding(env, creator, env.TOKEN_MINT);
    const min = Number(env.HOLDER_MIN || 0);
    const ui = h.decimals == null ? 0 : Number(h.raw) / 10 ** h.decimals;
    return h.raw > 0n && ui >= min;
  } catch {
    return false;
  }
}

// Le frais de lancement est-il passé ? Si oui, son burn rejoint la file (il sera racheté en
// $WICK et brûlé au prochain cron).
export async function settleFee(env, row, now) {
  if (row.fee_state !== 'sent' || !row.fee_sig || row.seq == null) return row.fee_state;
  const st = await signatureStatus(env, row.fee_sig).catch(() => null);
  let state = null;
  if (st?.ok) state = 'paid';
  else if (st?.ok === false || now - (row.sent_at || now) > 10 * 60_000) state = 'failed';
  if (!state) return 'sent';
  const res = await env.DB.prepare(
    "UPDATE matches SET fee_state = ?, share_state = CASE WHEN share_bps > 0 THEN ? ELSE share_state END WHERE mint = ? AND fee_state = 'sent'",
  ).bind(state, state === 'paid' ? 'shared' : 'failed', row.mint).run();
  // Seule la part burn de l'Ignition Fee est rachetée et brûlée (l'autre est allée à l'équipe).
  const burnLamports = row.fee_lamports - (row.team_lamports || 0);
  if (state === 'paid' && res.meta?.changes === 1 && burnLamports > 0) {
    const keep = CONFIG.buyback.matchKeepSol;
    await env.DB.prepare("INSERT OR IGNORE INTO burns (kind, ref, created_at, sol) VALUES ('match', ?, ?, ?)")
      .bind(row.mint, now, Math.max(0, burnLamports / 1e9 - keep)).run();
  }
  return state;
}

// Le lancement est confirmé : la transaction de l'Ignition Fee (avec le partage, s'il est choisi),
// gardée depuis la soumission, part maintenant. Si son blockhash a expiré entre-temps, elle ne
// passe pas : le coin reste lancé, sans fee ni partage.
export async function releaseHeld(env, row, now) {
  if (row.fee_state !== 'held' || row.seq == null || !row.share_tx) return row;
  const claimed = await env.DB.prepare("UPDATE matches SET fee_state = 'sending' WHERE mint = ? AND fee_state = 'held'").bind(row.mint).run();
  if (claimed.meta?.changes !== 1) return getMatch(env.DB, row.mint);
  let state = 'sent', share = 'sent';
  try {
    await sendTransaction(env, bytesFromBase64(row.share_tx));
  } catch (err) {
    console.error('share send', row.mint, err.message);
    state = 'failed';
    share = /blockhash/i.test(`${err.message} ${JSON.stringify(err.rpc?.data || '')}`) ? 'expired' : 'failed';
  }
  await env.DB.prepare(`UPDATE matches SET fee_state = ?, share_state = CASE WHEN share_bps > 0 THEN ? ELSE share_state END,
      sent_at = COALESCE(sent_at, ?) WHERE mint = ?`)
    .bind(state, share, now, row.mint).run();
  return getMatch(env.DB, row.mint);
}

// La transaction est confirmée : l'allumette prend le numéro suivant, en une seule
// requête (D1 exécute les écritures une par une, deux allumettes n'ont jamais le même),
// et rejoint la bougie qui brûle, qui fond d'une minute de plus.
export async function lightMatch(env, mint, now, holder = false) {
  const db = env.DB;
  const cycle = await tickCycle(env, now);
  const res = await db.prepare(
    'UPDATE matches SET seq = (SELECT COALESCE(MAX(seq), 0) + 1 FROM matches), lit_at = ?, cycle = ?, holder = ? WHERE mint = ? AND seq IS NULL',
  ).bind(now, cycle.id, holder ? 1 : 0, mint).run();
  if (res.meta?.changes === 1) {
    await db.prepare('UPDATE cycles SET matches = matches + 1 WHERE id = ?').bind(cycle.id).run();
  }
  return getMatch(db, mint);
}

// Regarde où en est une allumette envoyée. Renvoie la ligne (à jour) et son état :
// 'lit', 'pending', 'failed' ou 'prepared' (rien d'envoyé).
export async function settle(env, row, now) {
  if (row.seq != null) return { row, status: 'lit' };
  if (!row.signature) return { row, status: 'prepared' };
  const verdict = judgeConfirmed(await getTransaction(env, row.signature), row);
  if (verdict === 'ok') {
    let lit = await lightMatch(env, row.mint, now, await isHolder(env, row.creator));
    lit = await releaseHeld(env, lit, now).catch((err) => { console.error('held', row.mint, err.message); return lit; });
    const fee = await settleFee(env, lit, now).catch((err) => { console.error('fee', row.mint, err.message); return lit.fee_state; });
    return { row: fee === lit.fee_state ? lit : await getMatch(env.DB, row.mint), status: 'lit' };
  }
  if (verdict === 'failed' || verdict === 'mismatch') {
    // On efface la signature : le créateur peut réessayer avec le même mint.
    await env.DB.prepare('UPDATE matches SET signature = NULL, sent_at = NULL WHERE mint = ? AND seq IS NULL')
      .bind(row.mint).run();
    return { row, status: 'failed' };
  }
  return { row, status: 'pending' };
}

// Tout ce que le site affiche. since = le dernier seq déjà connu du navigateur.
//
// - candle : la bougie de $WICK (la part de la supply brûlée, une bougie = 0,5 %) ;
// - breath : le souffle, le compte à rebours du prochain buyback ;
// - matches : les allumettes qui tournent autour de la bougie (celles lancées depuis qu'elle
//   s'est allumée, les 600 dernières).
export async function worldState(env, now, since = 0, withMarkets = false) {
  const db = env.DB;
  const full = !(Number(since) > 0);
  const [cycle, supply, last] = await Promise.all([tickCycle(env, now), supplyBurned(env, now), lastHall(db)]);
  const candleStart = last?.completed_at ?? 0;
  const candle = { ...supplyCandle(supply.pct, candlePct(env)), startedAt: candleStart };
  const [{ total }, { heat }, { results: matches }, history, counts, launched, shared, live, pot, wallet, paused, { results: hot }, burns, hall, recent, coinBurns, lit] = await Promise.all([
    db.prepare('SELECT COALESCE(MAX(seq), 0) AS total FROM matches').first(),
    db.prepare('SELECT COUNT(*) AS heat FROM matches WHERE lit_at > ?').bind(now - CONFIG.heatWindowMs).first(),
    db.prepare(`SELECT ${PUBLIC} FROM matches WHERE seq > ? AND lit_at > ? ORDER BY seq DESC LIMIT ?`)
      .bind(Number(since) || 0, candleStart, CONFIG.maxMatchesPerResponse).all(),
    recentCycles(db),
    burnTotals(db),
    launchTotals(db, now),
    shareTotals(db),
    buybackLive(env),
    potSol(env, now),
    buybackWallet(env).catch(() => null),
    buybackPaused(db),
    // Les coins WICK les plus chauds des dernières 24 h (market cap DexScreener).
    db.prepare(`SELECT ${PUBLIC} FROM matches WHERE seq IS NOT NULL AND lit_at > ? AND mcap > 0 ORDER BY mcap DESC LIMIT 5`)
      .bind(now - 24 * 3600_000).all(),
    // Le journal des burns : en entier au premier chargement, les 20 derniers ensuite.
    burnLog(db, full ? 400 : 20),
    hallList(db),
    // Les derniers lancements, toutes bougies confondues (pour le fil), au premier chargement.
    full ? db.prepare(`SELECT ${PUBLIC} FROM matches WHERE seq IS NOT NULL ORDER BY seq DESC LIMIT 30`).all() : null,
    // Les burns des coins qui se brûlent eux-mêmes (« Make it burn »), pour le fil.
    coinBurnLog(db, full ? 30 : 10),
    candleTotals(db),
  ]);
  // Ce que disent les Keepers (leurs premiers mots, leur journal, leurs décisions) depuis 24 h.
  const { results: thoughts } = await db.prepare(
    `SELECT mint, symbol, image, holder, keeper_style, keeper_model, keeper_thought AS line, keeper_thought_at AS at
     FROM matches WHERE seq IS NOT NULL AND keeper_thought IS NOT NULL AND keeper_thought_at > ?
     ORDER BY keeper_thought_at DESC LIMIT 8`,
  ).bind(now - 24 * 3600_000).all();
  // Le marché de chaque allumette en orbite (pour qu'elles grossissent ou pâlissent en direct).
  const markets = full || withMarkets
    ? (await db.prepare(`SELECT mint, mcap, change24h AS change FROM matches
        WHERE seq IS NOT NULL AND lit_at > ? AND mcap IS NOT NULL ORDER BY seq DESC LIMIT ?`)
      .bind(candleStart, CONFIG.maxMatchesPerResponse).all()).results
    : null;
  return {
    now,
    total,
    heat,
    candle,
    breath: publicCycle(cycle, env, now),
    matches: matches.reverse().map(publicMatch),
    history,
    // Le tableau de bord : uniquement des chiffres réels (la base, la chaîne, DexScreener).
    totals: {
      ...counts,
      ...launched,
      ...shared,
      ...lit,
      burned: supply.burned,
      supplyPct: supply.original ? supply.pct : null,
      supply: supply.original ? { original: supply.original, current: supply.original - supply.burned } : null,
    },
    burns: { full, list: burns },
    coinBurns,
    thoughts: thoughts.map((t) => ({ mint: t.mint, symbol: t.symbol, image: t.image, holder: Boolean(t.holder), line: t.line, at: t.at, keeper: publicKeeper(t) })),
    hall,
    hot: hot.map(publicMatch),
    recent: recent ? recent.results.map(publicMatch) : null,
    markets,
    buyback: { live, paused, potSol: pot, wallet: wallet?.publicKey ?? null },
  };
}

// Le cron : on vérifie les allumettes envoyées et leurs frais, on oublie celles jamais signées.
export async function sweep(env, now) {
  const { results: held } = await env.DB.prepare(
    "SELECT * FROM matches WHERE seq IS NOT NULL AND fee_state = 'held' LIMIT 10",
  ).all();
  for (const row of held) {
    try { await releaseHeld(env, row, now); } catch (err) { console.error('held', row.mint, err?.message); }
  }
  const { results: fees } = await env.DB.prepare(
    "SELECT * FROM matches WHERE seq IS NOT NULL AND fee_state = 'sent' LIMIT 25",
  ).all();
  for (const row of fees) {
    try { await settleFee(env, row, now); } catch (err) { console.error('fee', row.mint, err?.message); }
  }
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
