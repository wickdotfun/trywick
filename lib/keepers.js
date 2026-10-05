// Les Operators : chaque bougie (un coin qui se brûle lui-même, « Make it burn ») a son agent IA.
//
// - Au lancement, le créateur lui choisit une personnalité et un esprit (le modèle qui le fait
//   tourner, servi gratuitement par Cloudflare Workers AI, dans le quota du jour).
// - Quand les fees du coin ont rempli sa bougie (au moins 0,01 SOL mis de côté), le Operator décide
//   QUAND la brûler : maintenant, ou attendre un meilleur moment. Il ne décide jamais combien, ni
//   où vont les SOL : ils ne peuvent que racheter le coin et le brûler (lib/buyback.js).
// - Garde-fous en dur : au plus une décision par heure, jamais plus de 24 h sans brûler quand il
//   y a de quoi, et au-delà de 0,25 SOL il brûle tout de suite. Sans IA (quota épuisé, modèle en
//   panne, réponse illisible), il brûle comme avant, avec une phrase toute prête.
// - Il parle : chaque burn porte sa phrase (sa raison), et il se présente au lancement.
import { CONFIG } from './config.js';
import { onDecide, onIntro, onJournal, onWait } from './operator.js';
import { blocked } from './safety.js';
import { getSetting, setSetting } from './settings.js';

const K = CONFIG.keepers;
const SOL = 1e9;

export const keeperStyle = (id) => (K.styles[id] ? id : null);
export const keeperGoal = (id) => (K.goals[id] ? id : null);
// Le caractère écrit par le créateur : une ligne propre, courte, et rien d'interdit. null sinon.
export function keeperPrompt(text) {
  const s = cleanLine(text, K.customMax);
  return s.length >= 8 && !blocked(s) ? s : null;
}
export const keeperModel = (id) => K.models.find((m) => m.id === id) || null;

// Ce que le site montre des Operators (le formulaire de lancement).
export function keeperChoices() {
  return {
    styles: Object.entries(K.styles).map(([id, s]) => ({ id, label: s.label, hint: s.hint })),
    models: K.models.map(({ id, name, by, logo }) => ({ id, name, by, logo })),
    goals: Object.entries(K.goals).map(([id, g]) => ({ id, label: g.label, hint: g.hint })),
    customMax: K.customMax,
  };
}

// La bougie d'un coin vue par le site : son Operator, s'il en a un.
export function publicKeeper(row) {
  const style = K.styles[row.keeper_style];
  if (!style) return null;
  const model = keeperModel(row.keeper_model) || K.models[0];
  return {
    style: row.keeper_style, label: style.label, model: model.name, by: model.by, logo: model.logo || null,
    goal: K.goals[row.keeper_goal]?.label || null,
    intro: row.keeper_intro || null, thought: row.keeper_thought || null, thoughtAt: row.keeper_thought_at || null,
  };
}

// ------------------------------------------------------------ parler à un modèle
// Le texte d'une réponse Workers AI, quelle que soit sa forme (chat, ou « responses » pour gpt-oss).
export function textOf(res) {
  if (typeof res === 'string') return res;
  if (typeof res?.response === 'string') return res.response;
  if (res?.response && typeof res.response === 'object') return JSON.stringify(res.response);
  if (typeof res?.output_text === 'string') return res.output_text;
  // gpt-oss (format « responses ») : le raisonnement d'abord, puis le message ; seul le message compte.
  const items = Array.isArray(res?.output) ? res.output : [];
  for (const item of items.filter((x) => x?.type !== 'reasoning')) {
    for (const c of item?.content || []) if (typeof c?.text === 'string' && c.type !== 'reasoning_text') return c.text;
  }
  const choice = res?.choices?.[0]?.message?.content;
  return typeof choice === 'string' ? choice : '';
}

// Une phrase propre : sans le raisonnement, sans lien, sans emoji, sans guillemets, courte.
export function cleanLine(text, max = 140) {
  let s = String(text ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/#\w+/g, '')
    .replace(/[#*_`]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”«»]+|["'“”«»]+$/g, '')
    .trim();
  if (s.length > max) s = `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
  return s;
}

// La décision : {"action":"burn"|"wait","line":"…"}. Une réponse illisible : on brûle.
export function parseDecision(text) {
  const raw = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const json = raw.match(/\{[\s\S]*\}/);
  if (json) {
    try {
      const d = JSON.parse(json[0]);
      const line = cleanLine(d.line ?? d.say ?? d.message ?? '');
      if (d.action === 'burn' || d.action === 'wait') return { action: d.action, line };
    } catch { /* illisible */ }
  }
  return null;
}

// Le budget IA du jour, par usage (CONFIG.keepers.daily). Renvoie true si l'appel est permis, et
// le compte. (« count » : les appels des Operators eux-mêmes.)
const field = (kind) => (kind === 'keeper' ? 'count' : kind);
export async function aiToday(db, now) {
  const day = Math.floor(now / 86_400_000);
  const s = await getSetting(db, 'ai.day');
  return s?.day === day ? s : { day };
}
export async function spendAi(db, kind, now) {
  const s = await aiToday(db, now);
  const used = s[field(kind)] || 0;
  if (used >= (K.daily[kind] ?? 0)) return false;
  await setSetting(db, 'ai.day', { ...s, [field(kind)]: used + 1 });
  return true;
}

// Les limites par visiteur et par heure (Spark, logos, questions). Renvoie true si permis.
export async function allowIp(db, kind, ip, now) {
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM ai_uses WHERE kind = ? AND ip = ? AND at > ?')
    .bind(kind, ip, now - 3_600_000).first();
  if (n >= (K.perIpHour[kind] ?? 0)) return false;
  await db.prepare('INSERT INTO ai_uses (kind, ip, at) VALUES (?, ?, ?)').bind(kind, ip, now).run();
  return true;
}

// La réponse sans le raisonnement (DeepSeek R1, Qwen3 : <think>…</think>). Un raisonnement
// coupé avant sa fin ne donne pas de réponse.
export function answerOf(text) {
  let s = String(text ?? '');
  const end = s.lastIndexOf('</think>');
  if (end >= 0) s = s.slice(end + 8);
  if (/<think>/i.test(s)) return '';
  return s.trim();
}

// Demande une réponse au modèle choisi (puis au modèle de secours). null si pas d'IA ou plus de
// quota pour aujourd'hui. kind : l'usage, pour le budget du jour.
export async function think(env, { model, system, prompt, now = Date.now(), kind = 'keeper', maxTokens = 220, temperature = 0.8, fallback = true }) {
  if (!env.AI?.run) return null;
  const chosen = (keeperModel(model) || K.models[0]).model;
  const ids = fallback ? [...new Set([chosen, K.models[0].model])] : [chosen];
  for (const id of ids) {
    if (!(await spendAi(env.DB, kind, now))) return null;
    try {
      // Les modèles qui raisonnent d'abord ont besoin de place pour leur réponse.
      const room = /deepseek-r1|qwen3/.test(id) ? maxTokens + 900 : maxTokens;
      const res = id.includes('gpt-oss')
        ? await env.AI.run(id, { instructions: system, input: prompt })
        : await env.AI.run(id, {
          messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
          max_tokens: room, temperature,
        });
      const text = answerOf(textOf(res));
      if (cleanLine(text)) return text;
    } catch (err) {
      console.log('keeper ai', id, err?.message ?? err);
    }
  }
  return null;
}

// ------------------------------------------------------------ ce qu'il dit sans IA
const LINES = {
  stoic: ['The flame takes what it is owed. {sol} SOL, burned.', 'Patience paid. {sol} SOL of $SYM returns to ash.', 'Another measure of wax, gone. {sol} SOL.'],
  degen: ['{sol} SOL of $SYM straight into the fire. We burn, we eat.', 'Supply goes down, vibes go up. {sol} SOL burned.', 'Fed the candle {sol} SOL. Send it.'],
  poet: ['Wax to smoke, {sol} SOL of $SYM drifts away.', 'The candle shortens, the flame remembers. {sol} SOL.', 'A verse in fire: {sol} SOL of $SYM, gone.'],
  pyro: ['MORE FIRE. {sol} SOL of $SYM, burned.', 'It burns so nicely. {sol} SOL of $SYM, gone.', 'I could watch $SYM burn all day. {sol} SOL.'],
};
const INTROS = {
  stoic: 'I keep the candle of $SYM. {pct}% of its fees will burn it, steadily, forever.',
  degen: '$SYM operator online. {pct}% of the fees buy it back and burn it. Forever. LFG.',
  poet: 'I tend the wax of $SYM. {pct}% of its fees will turn it into light, forever.',
  pyro: 'They gave me $SYM and {pct}% of its fees to burn it. Forever. I am so happy.',
};
const HELLOS = {
  stoic: 'I keep the candle of $SYM. I watch, I speak when it matters.',
  degen: '$SYM operator online. I see everything. We are so early.',
  poet: 'A new wick, a new flame. I will tend $SYM through every night.',
  pyro: 'They gave me $SYM. I love it already. Look at that flame.',
};
const fill = (s, v) => s.replace(/\$SYM/g, `$${v.symbol}`).replace('{sol}', v.sol).replace('{pct}', v.pct);
export function fallbackLine(style, v, i = Date.now()) {
  const lines = LINES[style] || LINES.stoic;
  return fill(lines[Math.floor(i / 1000) % lines.length], v);
}

// Qui est le Operator d'un coin : son coin, sa personnalité, ce qu'il fait.
const RULES = 'Always speak in English, one short line, under 120 characters, no links, no hashtags, no emojis. Never promise anything about price, never tell anyone to buy or sell.';
export function persona(m) {
  const style = K.styles[m.keeper_style] || K.styles.stoic;
  const voice = m.keeper_style === 'custom' && m.keeper_prompt
    ? `Your character, as written by your creator: "${m.keeper_prompt}". Play it, but the rules below always come first.`
    : style.voice;
  const goal = K.goals[m.keeper_goal]?.focus || '';
  const burns = m.self_bps > 0
    ? `${m.self_bps / 100}% of $${m.symbol}'s creator fees buy it back and burn it, forever: you choose the moments, never the amounts.`
    : `You tend its candle and speak to its holders.`;
  return `You are the Operator of $${m.symbol} (${m.name}), its AI agent on WICK, the Solana launchpad where every coin is a candle. ${voice} ${goal} ${burns}`.replace(/\s+/g, ' ');
}

function systemFor(m) {
  return `${persona(m)}
Part of ${m.symbol}'s creator fees piles up for you. You only decide WHEN to buy $${m.symbol} back and burn it: now, or wait for a better moment (for example after a drop, or while it is quiet). You never decide how much, and you never promise anything about price.
${RULES}`;
}

const pct1 = (n) => Math.round((n || 0) * 10) / 10;

// ------------------------------------------------------------ le cron : décider
// Les bougies dont les fees mises de côté suffisent : leur Operator décide (au plus une fois par
// heure). Les coins sans Operator brûlent tout de suite, comme avant. Renvoie le nombre de burns
// mis en file.
export async function runKeepers(env, now, queueSelfBurn) {
  const db = env.DB;
  const { selfBurn } = CONFIG;
  const { results } = await db.prepare(
    `SELECT mint, symbol, name, keeper_style, keeper_model, keeper_goal, keeper_prompt, self_pending, self_last_burn, lit_at, mcap, change24h,
       vol24h, self_burns, self_burned, self_bps
     FROM matches WHERE self_pending >= ? AND seq IS NOT NULL AND (keeper_at IS NULL OR keeper_at < ?)
     ORDER BY self_pending DESC LIMIT ?`,
  ).bind(Math.round(selfBurn.minSol * SOL), now - K.consultEveryMs, K.perRun).all();
  let queued = 0;
  for (const m of results) {
    // Réservé : deux crons qui se chevauchent ne consultent pas deux fois.
    const claimed = await db.prepare('UPDATE matches SET keeper_at = ? WHERE mint = ? AND (keeper_at IS NULL OR keeper_at < ?)')
      .bind(now, m.mint, now - K.consultEveryMs).run();
    if (claimed.meta?.changes !== 1) continue;
    const ref = `${m.mint}:k${now}`;
    if (!keeperStyle(m.keeper_style)) {
      if (await queueSelfBurn(db, m.mint, ref, now)) queued++;
      continue;
    }
    const sol = (m.self_pending / SOL).toFixed(3);
    const since = now - (m.self_last_burn || m.lit_at || now);
    const forced = m.self_pending >= K.maxPendingSol * SOL || since >= K.maxWaitMs;
    const data = {
      coin: `$${m.symbol} (${m.name})`,
      market_cap_usd: m.mcap ?? 'unknown',
      change_24h_percent: m.change24h ?? 'unknown',
      volume_24h_usd: m.vol24h ?? 'unknown',
      sol_ready_to_burn: Number(sol),
      hours_since_last_burn: pct1(since / 3_600_000),
      burns_so_far: m.self_burns || 0,
      supply_burned_percent: pct1(((m.self_burned || 0) / CONFIG.pumpSupply) * 100),
      rule: forced ? 'You MUST burn now.' : `You must burn within ${pct1((K.maxWaitMs - since) / 3_600_000)} hours at the latest.`,
    };
    const prompt = `${JSON.stringify(data)}\nReply with JSON only: {"action":"burn" or "wait","line":"what you say to the holders, in character"}`;
    const decision = parseDecision(await think(env, { model: m.keeper_model, system: systemFor(m), prompt, now }));
    const action = forced || !decision ? 'burn' : decision.action;
    const line = decision?.line || fallbackLine(m.keeper_style, { symbol: m.symbol, sol }, now);
    await db.prepare('UPDATE matches SET keeper_thought = ?, keeper_thought_at = ? WHERE mint = ?').bind(line, now, m.mint).run();
    await (action === 'wait' ? onWait(db, m, line, sol, now) : onDecide(db, m, line, sol, now, forced)).catch((err) => console.error('operator log', err.message));
    if (action === 'wait') continue;
    if (await queueSelfBurn(db, m.mint, ref, now, line)) queued++;
  }
  return queued;
}

// ------------------------------------------------------------ le cron : parler
// Les premiers mots d'un Operator (une fois, après le lancement), et la phrase du Operator de $WICK
// pour chaque buyback de la grande bougie. Renvoie le nombre de phrases écrites.
export async function runVoices(env, now) {
  const db = env.DB;
  let done = 0;
  const { results: fresh } = await db.prepare(
    `SELECT mint, symbol, name, keeper_style, keeper_model, keeper_goal, keeper_prompt, self_bps FROM matches
     WHERE keeper_style IS NOT NULL AND keeper_intro IS NULL AND seq IS NOT NULL AND lit_at > ? LIMIT 2`,
  ).bind(now - 24 * 3_600_000).all();
  for (const m of fresh) {
    if (!keeperStyle(m.keeper_style)) continue;
    const pct = m.self_bps / 100;
    const text = await think(env, {
      model: m.keeper_model, system: `${persona(m)}\n${RULES}`, now,
      prompt: pct
        ? `$${m.symbol} was just launched. Introduce yourself to its holders in one line: ${pct}% of its creator fees will buy it back and burn it, forever, and you choose the moments.`
        : `$${m.symbol} was just launched. Introduce yourself to its holders in one line, in character.`,
    });
    const line = cleanLine(text) || fill((pct ? INTROS : HELLOS)[m.keeper_style] || (pct ? INTROS : HELLOS).stoic, { symbol: m.symbol, pct });
    // Ses premiers mots sont aussi sa première pensée (le fil du site les montre).
    await db.prepare(`UPDATE matches SET keeper_intro = ?, keeper_thought = COALESCE(keeper_thought, ?),
        keeper_thought_at = COALESCE(keeper_thought_at, ?) WHERE mint = ? AND keeper_intro IS NULL`)
      .bind(line, line, now, m.mint).run();
    await onIntro(db, m, line, now).catch((err) => console.error('operator log', err.message));
    done++;
  }
  const b = await db.prepare(
    "SELECT id, ref, sol, burned_ui FROM burns WHERE kind = 'candle' AND status = 'burned' AND voice IS NULL AND burned_at > ? ORDER BY id DESC LIMIT 1",
  ).bind(now - 2 * 3_600_000).first();
  if (b) {
    const ticker = env.TOKEN_TICKER || 'WICK';
    const text = await think(env, {
      model: 'llama', now,
      system: `You are The Wick, the keeper of the great $${ticker} candle on WICK, the launchpad that burns itself. ${K.styles.stoic.voice} Always speak in English, one short line, under 120 characters, no links, no hashtags, no emojis, no promises about price.`,
      prompt: `Buyback #${b.ref} just bought and burned ${Math.round(b.burned_ui || 0).toLocaleString('en-US')} $${ticker} with ${b.sol} SOL. Say one line about it.`,
    });
    const line = cleanLine(text) || `Breath #${b.ref}: ${Math.round(b.burned_ui || 0).toLocaleString('en-US')} $${ticker} returned to ash.`;
    await db.prepare('UPDATE burns SET voice = ? WHERE id = ? AND voice IS NULL').bind(line, b.id).run();
    done++;
  }
  return done;
}

// ------------------------------------------------------------ le cron : le journal
// Une fois par jour au plus, le Operator d'un coin vivant écrit une ligne à ses holders sur ce
// qu'il voit (son marché, sa bougie). Un Operator à la fois, les coins les plus actifs d'abord.
export async function runJournal(env, now) {
  const db = env.DB;
  // Les traces des limites par visiteur au-delà d'un jour ne servent plus.
  await db.prepare('DELETE FROM ai_uses WHERE at < ?').bind(now - 86_400_000).run();
  const m = await db.prepare(
    `SELECT mint, symbol, name, keeper_style, keeper_model, keeper_goal, keeper_prompt, self_bps, self_burned, self_burns, self_pending, mcap,
       change24h, vol24h, lit_at, description
     FROM matches WHERE keeper_style IS NOT NULL AND keeper_intro IS NOT NULL AND seq IS NOT NULL AND lit_at > ?
       AND (keeper_thought_at IS NULL OR keeper_thought_at < ?)
     ORDER BY COALESCE(vol24h, 0) DESC, lit_at DESC LIMIT 1`,
  ).bind(now - 30 * 86_400_000, now - K.journalEveryMs).first();
  if (!m || !keeperStyle(m.keeper_style)) return 0;
  const data = {
    coin: `$${m.symbol} (${m.name})`,
    about: m.description || undefined,
    days_alive: pct1((now - m.lit_at) / 86_400_000),
    market_cap_usd: m.mcap ?? 'unknown',
    change_24h_percent: m.change24h ?? 'unknown',
    volume_24h_usd: m.vol24h ?? 'unknown',
    burns_so_far: m.self_bps ? m.self_burns || 0 : undefined,
    supply_burned_percent: m.self_bps ? pct1(((m.self_burned || 0) / CONFIG.pumpSupply) * 100) : undefined,
  };
  const text = await think(env, {
    model: m.keeper_model, system: `${persona(m)}\n${RULES}`, now, kind: 'journal',
    prompt: `${JSON.stringify(data)}\nWrite today's journal line for $${m.symbol}'s holders: what you see, in character.`,
  });
  const line = cleanLine(text);
  if (!line) return 0;
  await db.prepare('UPDATE matches SET keeper_thought = ?, keeper_thought_at = ? WHERE mint = ?').bind(line, now, m.mint).run();
  await onJournal(db, m, line, now).catch((err) => console.error('operator log', err.message));
  return 1;
}
