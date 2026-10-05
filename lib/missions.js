// Ce que l'Operator d'un coin a fait et ce qu'il vise (« Missions »), calculé à partir de son
// coin et de son journal d'actions : rien n'est inventé, chaque mission se coche toute seule.
// Sans accès à la base : le serveur (lib/candles.js) et la démo s'en servent tous les deux.
import { CONFIG } from './config.js';

const OP = CONFIG.operator;
const DAY = 86_400_000;

export const usd = (n) => (n >= 1e6 ? `$${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`);
const pctText = (p) => `${p >= 10 ? Math.round(p) : +p.toFixed(p >= 1 ? 1 : 2)}%`;

// Le palier le plus haut franchi depuis le dernier noté (ou null).
export function crossed(steps, value, last = 0) {
  if (!(value > 0)) return null;
  const hit = steps.filter((s) => s <= value && s > (last || 0)).pop();
  return hit ?? null;
}
export const nextStep = (steps, last = 0) => steps.find((s) => s > (last || 0)) ?? null;

// La part de la supply brûlée par le coin lui-même, en %.
export const burnedPct = (m) => ((m.self_burned || 0) / CONFIG.pumpSupply) * 100;

// m : la ligne du coin (mcap, op_mcap, self_bps, self_pending, self_burned, self_burns…).
// log : son journal (le plus récent d'abord). → [{ id, title, status, hint, progress, at }]
// status : 'done' | 'active' | 'ongoing'.
export function missions(m, log = [], now = Date.now()) {
  const first = (kind) => log.filter((e) => e.kind === kind).at(-1) || null;
  const sym = `$${m.symbol}`;
  const list = [];
  const launched = first('launched');
  list.push({ id: 'launch', title: `Launch ${sym} on pump.fun`, status: 'done', at: launched?.at ?? m.lit_at ?? null });
  const burns = m.self_bps > 0;
  if (burns) {
    const sealed = first('sealed');
    list.push({ id: 'seal', title: `Lock ${m.self_bps / 100}% of creator fees to burn ${sym}`, status: sealed ? 'done' : 'active',
      at: sealed?.at ?? null, hint: sealed ? null : 'Confirming the split on pump.fun' });
  }
  const intro = first('intro');
  list.push({ id: 'intro', title: 'Introduce itself to the holders', status: intro ? 'done' : 'active', at: intro?.at ?? null,
    hint: intro ? null : 'Within minutes of the launch' });
  const kit = first('kit');
  list.push({ id: 'kit', title: 'Prepare the launch kit', status: kit || m.op_kit ? 'done' : 'active', at: kit?.at ?? null,
    hint: kit || m.op_kit ? 'Lore, 3 X posts and a Telegram post: see the Kit tab' : 'Right after the launch' });

  // Ses groupes Telegram : il y poste dès qu'un admin l'a relié (/link).
  if (m.op_groups != null) {
    list.push({ id: 'telegram', title: 'Post in its Telegram groups', status: m.op_groups > 0 ? 'done' : 'active',
      hint: m.op_groups > 0 ? `Posting in ${m.op_groups} group${m.op_groups > 1 ? 's' : ''}: milestones, burns, a daily recap` : 'Waiting for a group: add the WICK bot, then /link <CA>' });
  }

  // Son compte X : il y poste dès que son créateur l'a relié.
  if (m.op_x != null) {
    list.push({ id: 'x', title: 'Run its X account', status: m.op_x ? 'done' : 'active',
      hint: m.op_x ? `Posting as @${m.op_x}: its kit, milestones, burns, journal` : 'Waiting for its creator to connect it (Kit tab)' });
  }

  // Le marché : le prochain palier de market cap.
  const goal = nextStep(OP.mcapSteps, m.op_mcap);
  const reached = log.find((e) => e.kind === 'milestone' && /market cap/.test(e.title));
  list.push(goal
    ? { id: 'mcap', title: `Reach a ${usd(goal)} market cap`, status: 'active',
      progress: m.mcap ? Math.min(0.99, m.mcap / goal) : 0,
      hint: m.mcap ? `Now ${usd(m.mcap)}${reached ? ` · last milestone: ${reached.title.replace(/^Reached an? /, '')}` : ''}` : 'Waiting for its first trades on DEX Screener' }
    : { id: 'mcap', title: 'Every market cap milestone reached', status: 'done', at: reached?.at ?? null });

  // Les burns : le premier, puis les paliers de la supply brûlée.
  if (burns) {
    if (!(m.self_burns > 0)) {
      const pending = (m.self_pending || 0) / 1e9;
      list.push({ id: 'burn', title: 'Make its first burn', status: 'active', progress: Math.min(0.99, pending / CONFIG.selfBurn.minSol),
        hint: `${pending.toFixed(4)} of ${CONFIG.selfBurn.minSol} SOL of creator fees set aside` });
    } else {
      const p = burnedPct(m);
      const target = nextStep(OP.burnSteps, m.op_burn);
      list.push(target
        ? { id: 'burn', title: `Burn ${target}% of the ${sym} supply`, status: 'active', progress: Math.min(0.99, p / target),
          hint: `${pctText(p)} burned so far, in ${m.self_burns} burn${m.self_burns > 1 ? 's' : ''}` }
        : { id: 'burn', title: `Burn ${OP.burnSteps.at(-1)}% of the ${sym} supply`, status: 'done' });
    }
  }

  // Sa mission d'objectif.
  const days = new Set(log.filter((e) => (e.kind === 'journal' || e.kind === 'intro') && now - e.at < 7 * DAY).map((e) => Math.floor(e.at / DAY))).size;
  const lines = log.filter((e) => e.kind === 'journal').length;
  const recaps = log.filter((e) => e.kind === 'posted' && /recap/.test(e.title)).length;
  const objective = {
    survive: () => ({ id: 'goal', title: 'Show up 7 days in a row', status: days >= 7 ? 'done' : 'active', progress: Math.min(0.99, days / 7), hint: `Objective: survive · ${days} of the last 7 days` }),
    meme: () => ({ id: 'goal', title: 'Grow its lore: 10 journal lines', status: lines >= 10 ? 'done' : 'active', progress: Math.min(0.99, lines / 10), hint: `Objective: meme engine · ${lines} so far` }),
    openbook: () => ({ id: 'goal', title: 'Publish a daily recap', status: recaps ? 'done' : 'active', hint: recaps ? `Objective: open book · ${recaps} recap${recaps > 1 ? 's' : ''} posted` : 'Objective: open book · once a Telegram group is linked' }),
  }[m.keeper_goal];
  if (objective) list.push(objective());

  // Le journal du jour.
  const lastWords = log.find((e) => e.kind === 'journal' || e.kind === 'intro');
  const today = lastWords && now - lastWords.at < DAY;
  list.push({ id: 'journal', title: "Write today's journal", status: today ? 'done' : 'active', at: today ? lastWords.at : null,
    hint: today ? null : 'Once a day, from what it sees' });

  // Ce qu'il fait tout le temps.
  list.push({ id: 'watch', title: `Track ${sym}'s market cap, volume${burns ? ' and burns' : ''}`, status: 'ongoing', hint: 'Every few minutes, for 30 days' });
  return list;
}
