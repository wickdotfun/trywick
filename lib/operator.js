// L'Operator d'un coin : son agent IA (la personnalité, l'esprit et les décisions viennent de
// lib/keepers.js). Ici, deux choses publiques :
//
// - Son journal d'actions (table operator_log) : tout ce qu'il a fait, daté, avec la transaction
//   quand il y en a une. C'est sa mémoire, et ce que la page du coin montre (« Activity »).
//   Chaque action a une clé (ref) : la même action n'est jamais notée deux fois.
// - Sa Constitution : ce qui a été fixé au lancement et ne change plus (personnalité, esprit, part
//   des creator fees qui brûle le coin, règles), avec la preuve on-chain du partage.
import { CONFIG } from './config.js';
import { keeperModel, keeperStyle } from './keepers.js';

const K = CONFIG.keepers;
const HOUR = 3_600_000;

export const KINDS = ['launched', 'sealed', 'intro', 'kit', 'journal', 'wait', 'decide', 'burned', 'fed', 'posted', 'milestone'];

// Note une action. Renvoie true si elle est nouvelle.
export async function logAction(db, mint, { kind, title, detail = null, sig = null, ref = null, at = Date.now() }) {
  if (!mint || !KINDS.includes(kind) || !title) return false;
  const res = await db.prepare(
    'INSERT OR IGNORE INTO operator_log (mint, at, kind, title, detail, sig, ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(mint, at, kind, String(title).slice(0, 140), detail ? String(detail).slice(0, 300) : null, sig, ref || `${kind}:${at}`).run();
  return res.meta?.changes === 1;
}

// Le journal d'un coin, le plus récent d'abord.
export async function operatorLog(db, mint, limit = 50) {
  const { results } = await db.prepare(
    'SELECT at, kind, title, detail, sig FROM operator_log WHERE mint = ? ORDER BY at DESC, id DESC LIMIT ?',
  ).bind(mint, limit).all();
  return results;
}

const sym = (m) => `$${m.symbol}`;
const pct = (bps) => `${(bps || 0) / 100}%`;

// La Constitution d'un coin (ce que montre sa page). null pour un coin lancé avant les Operators.
export function constitution(m) {
  const style = keeperStyle(m.keeper_style);
  if (!style) return null;
  const mind = keeperModel(m.keeper_model) || K.models[0];
  const burns = m.self_bps > 0 && ['shared', 'sent', 'held', 'sending'].includes(m.share_state);
  return {
    personality: K.styles[style].label,
    character: style === 'custom' && m.keeper_prompt ? m.keeper_prompt : null,
    objective: K.goals[m.keeper_goal] ? { label: K.goals[m.keeper_goal].label, hint: K.goals[m.keeper_goal].hint } : null,
    mind: { name: mind.name, by: mind.by, logo: mind.logo },
    burn: burns ? { pct: m.self_bps / 100, wickPct: ((m.share_bps || 0) - (m.self_bps || 0) - (m.share_team_bps || 0)) / 100, teamPct: ((m.share_team_bps || 0) - (m.share_crew_bps || 0)) / 100, crewPct: (m.share_crew_bps || 0) / 100 } : null,
    // La preuve : la transaction qui a fixé le partage des creator fees sur pump.fun.
    proof: burns && m.share_state === 'shared' && m.fee_sig ? m.fee_sig : null,
    rules: burns
      ? [
        `Decides at most once every ${K.consultEveryMs / HOUR} hour`,
        `Burns at least every ${K.maxWaitMs / HOUR} hours when there is something to burn`,
        `Burns at once past ${K.maxPendingSol} SOL`,
        `Can only buy back ${sym(m)} and burn it`,
      ]
      : ['Talks to holders, writes its journal', 'Holds no funds'],
    canSell: false,
    canMoveFunds: false,
    locked: true,
  };
}

// ------------------------------------------------------------ les actions notées
export const onLaunched = (db, m, at) => logAction(db, m.mint, {
  kind: 'launched', at, sig: m.signature || null, ref: 'launched',
  title: `Launched ${sym(m)} on pump.fun`,
  detail: keeperStyle(m.keeper_style)
    ? `Operator summoned: ${K.styles[m.keeper_style].label} on ${(keeperModel(m.keeper_model) || K.models[0]).name}.`
    : null,
});

export const onSealed = (db, m, at) => logAction(db, m.mint, {
  kind: 'sealed', at, sig: m.fee_sig || null, ref: 'sealed',
  title: m.self_bps > 0 ? `Locked ${pct(m.self_bps)} of creator fees to burn ${sym(m)}` : 'Creator fee split locked on pump.fun',
  detail: 'Set with pump.fun fee sharing at launch. Nobody can change it.',
});

export const onIntro = (db, m, line, at) => logAction(db, m.mint, { kind: 'intro', at, ref: 'intro', title: 'First words', detail: line });

export const onJournal = (db, m, line, at) => logAction(db, m.mint, {
  kind: 'journal', at, ref: `journal:${Math.floor(at / 86_400_000)}`, title: 'Journal', detail: line,
});

// Attendre : noté au plus une fois toutes les 6 heures (sinon le journal ne parle que de ça).
export async function onWait(db, m, line, sol, at) {
  const last = await db.prepare("SELECT MAX(at) AS at FROM operator_log WHERE mint = ? AND kind = 'wait'").bind(m.mint).first();
  if (last?.at && at - last.at < 6 * HOUR) return false;
  return logAction(db, m.mint, { kind: 'wait', at, ref: `wait:${at}`, title: `Held ${sol} SOL, waiting for a better moment`, detail: line });
}

export const onDecide = (db, m, line, sol, at, forced) => logAction(db, m.mint, {
  kind: 'decide', at, ref: `decide:${at}`, title: forced ? `Burn due by its rules: ${sol} SOL` : `Decided to burn: ${sol} SOL`, detail: line,
});

export const onBurned = (db, mint, symbol, { burned, sol, sig, voice }, at) => logAction(db, mint, {
  kind: 'burned', at, sig, ref: `burned:${sig || at}`,
  title: `Burned ${Math.round(burned).toLocaleString('en-US')} $${symbol}`,
  detail: `${(+sol || 0).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} SOL of its creator fees.${voice ? ` “${voice}”` : ''}`,
});

export const onFed = (db, mint, { burned, sig, ticker = 'WICK' }, at) => logAction(db, mint, {
  kind: 'fed', at, sig, ref: `fed:${sig || at}`,
  title: `Fed the $${ticker} candle: ${Math.round(burned).toLocaleString('en-US')} $${ticker} burned`,
  detail: 'Half of its Ignition Fee bought $WICK and burned it.'.replace('$WICK', `$${ticker}`),
});

export const onKit = (db, m, kit, at) => logAction(db, m.mint, {
  kind: 'kit', at, ref: 'kit',
  title: 'Prepared the launch kit',
  detail: `${kit.x.length} X posts, a Telegram post and the lore of $${m.symbol}${kit.ai ? '' : ' (from its templates: the AI was resting)'}.`,
});
