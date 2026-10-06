// La page Proof (GET /api/proof) : tout ce qu'un investisseur doit pouvoir vérifier lui-même.
// Les wallets et ce que chacun peut faire, les règles des fees, où est allé chaque SOL (ce que les
// crews ont gagné, et ce qu'ils ont dépensé en IA et en posts X), et chaque burn avec sa
// transaction (GET /api/proof/burns.csv : tous, à télécharger). Rien n'est estimé sans le dire.
import { CONFIG } from './config.js';
import { burnTotals, launchTotals } from './cycles.js';
import { tokenInfo } from './http.js';
import { getSetting } from './settings.js';

const P = CONFIG.proof;
const COIN_OF_BURN = "substr(b.ref, 1, instr(b.ref, ':') - 1)";
const SOL = 1e9;

export const burnWalletOf = (env) => env.BURN_WALLET ?? CONFIG.buyback.wallet;
export const teamWalletOf = (env) => env.TEAM_WALLET || env.DEPLOYER_WALLET || CONFIG.launch.deployer;

// Le $WICK de l'équipe bloqué (Streamflow…), seulement s'il l'est vraiment : réglé dans Cloudflare
// (TEAM_LOCK_URL, TEAM_LOCK_AMOUNT, TEAM_LOCK_UNTIL). Sinon : rien, pas de promesse.
export function teamLock(env) {
  if (!/^https:\/\//.test(env.TEAM_LOCK_URL || '')) return null;
  const until = Date.parse(env.TEAM_LOCK_UNTIL || '');
  return { url: env.TEAM_LOCK_URL, amount: Number(env.TEAM_LOCK_AMOUNT) || null, until: Number.isFinite(until) ? until : null };
}

// Les burns, du plus récent au plus ancien, avec ce qu'ils ont brûlé et leur transaction.
export async function burnReceipts(db, { limit = 30, offset = 0 } = {}) {
  const { results } = await db.prepare(
    `SELECT b.kind, b.ref, b.sol, b.burned_ui AS burned, b.burned_at AS at, b.burn_sig AS sig, b.buy_sig AS buySig,
       CASE WHEN b.kind = 'coin' THEN c.symbol WHEN b.kind = 'match' THEN m.symbol END AS symbol,
       CASE WHEN b.kind = 'coin' THEN c.mint END AS mint
     FROM burns b
     LEFT JOIN matches c ON b.kind = 'coin' AND c.mint = ${COIN_OF_BURN}
     LEFT JOIN matches m ON b.kind = 'match' AND m.mint = b.ref
     WHERE b.status = 'burned' AND b.burned_ui > 0
     ORDER BY b.burned_at DESC, b.id DESC LIMIT ? OFFSET ?`,
  ).bind(limit, offset).all();
  return results;
}

// Ce que les crews ont gagné (leur part des creator fees, reçue par le wallet de l'équipe) et
// dépensé (appels aux esprits premium, posts X ; en dollars, au tarif de config.proof).
export async function crewBook(db) {
  const [earned, posts, premium, or] = await Promise.all([
    db.prepare(`SELECT COALESCE(SUM(s.team_lamports * m.share_crew_bps / m.share_team_bps), 0) AS l, COUNT(DISTINCT s.mint) AS coins
      FROM shares s JOIN matches m ON m.mint = s.mint
      WHERE s.status = 'ok' AND s.team_lamports > 0 AND m.share_team_bps > 0 AND m.share_crew_bps > 0`).first(),
    db.prepare("SELECT COUNT(*) AS n FROM operator_log WHERE kind = 'posted' AND title LIKE 'Posted on X%'").first(),
    getSetting(db, 'proof.premium', 0),
    // Les agents sur OpenRouter : leur fuel (payé au lancement), ce qu'ils ont dépensé (prix exacts).
    db.prepare(`SELECT COALESCE(SUM(CASE WHEN fee_state = 'paid' THEN fuel_lamports ELSE 0 END), 0) AS fuel,
      COALESCE(SUM(mind_spent), 0) AS spent, COALESCE(SUM(mind_runs), 0) AS runs FROM matches WHERE mind_or IS NOT NULL`).first(),
  ]);
  const premiumCalls = Number(premium) || 0;
  return {
    earnedSol: (earned?.l || 0) / SOL,
    coins: earned?.coins || 0,
    premiumCalls,
    xPosts: posts?.n || 0,
    fuelSol: (or?.fuel || 0) / SOL,
    mindRuns: or?.runs || 0,
    spentUsd: Math.round((premiumCalls * P.premiumUsdPerCall + (posts?.n || 0) * P.xUsdPerPost + (or?.spent || 0)) * 100) / 100,
    rates: { premiumUsdPerCall: P.premiumUsdPerCall, xUsdPerPost: P.xUsdPerPost },
  };
}

export async function proofPage(env, now = Date.now()) {
  const db = env.DB;
  const [burns, launches, shares, coinBurns, receipts, crew] = await Promise.all([
    burnTotals(db),
    launchTotals(db, now),
    db.prepare(`SELECT COALESCE(SUM(s.wick_lamports), 0) AS wick, COALESCE(SUM(s.self_lamports), 0) AS self,
      COALESCE(SUM(s.team_lamports), 0) AS team, COUNT(*) AS n FROM shares s WHERE s.status = 'ok'`).first(),
    db.prepare("SELECT COALESCE(SUM(sol), 0) AS sol, COUNT(*) AS n FROM burns WHERE kind = 'coin' AND status = 'burned'").first(),
    burnReceipts(db, { limit: 30 }),
    crewBook(db),
  ]);
  const token = tokenInfo(env);
  const split = CONFIG.sharing;
  return {
    token: { mint: token.mint, ticker: token.ticker },
    wallets: [
      { role: 'burn', address: burnWalletOf(env), label: 'Burn wallet',
        does: [`Receives the burn half of every Ignition Fee and the burn share of every coin's creator fees`, `Only buys $${token.ticker} (and coins that burn themselves) and burns them, through the code in this repository`],
        never: ['Never sells', 'Spends SOL only on buybacks and network fees'] },
      { role: 'team', address: teamWalletOf(env), label: 'Team wallet',
        does: [`Launched $${token.ticker}`, 'Receives the team half of every Ignition Fee', 'Receives the team and crew shares of every coin\'s creator fees: the crew share pays for premium minds and X posts'],
        never: ['Its key is never on the site'] },
    ],
    rules: {
      ignition: { burnPct: 100 - CONFIG.team.feeBps / 100, teamPct: CONFIG.team.feeBps / 100 },
      split: {
        creatorPct: (10_000 - split.burnBps - split.teamBps - split.crewBps) / 100,
        crewPct: split.crewBps / 100, burnPct: split.burnBps / 100, teamPct: split.teamBps / 100,
      },
      selfBurnPcts: CONFIG.selfBurn.options.map((b) => b / 100),
      wickCreatorFees: env.BUYBACK_COLLECT_FEES === 'on' ? 'burn' : 'team',
      locked: 'Each coin\'s split is set with pump.fun fee sharing at launch and locked on-chain: nobody can change it.',
    },
    flows: {
      launches: launches.launches,
      ignitionSol: launches.ignitionSol, ignitionBurnSol: launches.ignitionBurnSol, ignitionTeamSol: launches.ignitionTeamSol,
      sharedCoins: shares?.n || 0,
      shareBurnSol: ((shares?.wick || 0) - (shares?.self || 0)) / SOL,
      shareSelfSol: (shares?.self || 0) / SOL,
      shareTeamSol: ((shares?.team || 0) / SOL) - crew.earnedSol,
      shareCrewSol: crew.earnedSol,
      wickBurned: burns.burned, wickBurnSol: burns.sol, wickBurns: (burns.buybacks || 0) + (burns.matchBurns || 0),
      coinBurnSol: coinBurns?.sol || 0, coinBurns: coinBurns?.n || 0,
    },
    crew,
    // Réglé dans Cloudflare (TEAM_LOCK_*), ou posté depuis la page d'admin (« Tokens locked »).
    lock: teamLock(env) || (await getSetting(db, 'team.lock', null)),
    receipts,
    code: { repo: P.repo },
  };
}

// Tous les burns en CSV (date, type, coin, SOL, quantité brûlée, transactions).
export async function burnsCsv(db) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page = await burnReceipts(db, { limit: 500, offset });
    rows.push(...page);
    if (page.length < 500 || rows.length >= 20_000) break;
  }
  const cell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [['date_utc', 'kind', 'token', 'sol', 'burned', 'burn_tx', 'buy_tx'].join(',')];
  for (const r of rows) {
    const what = r.kind === 'coin' ? r.symbol : 'WICK';
    lines.push([r.at ? new Date(r.at).toISOString() : '', r.kind === 'candle' ? 'buyback' : r.kind === 'match' ? 'launch' : 'coin', what, r.sol, r.burned, r.sig, r.buySig].map(cell).join(','));
  }
  return `${lines.join('\n')}\n`;
}
