// OpenRouter : n'importe quel modèle d'IA (des centaines : OpenAI, Anthropic, Google, xAI, DeepSeek,
// Qwen, Mistral, Moonshot, MiniMax, Z.ai…) pour l'agent d'un coin, avec une seule clé
// (OPENROUTER_API_KEY, des crédits prépayés).
//
// Qui paie : le coin lui-même. Son « carburant » (fuel, en SOL, ajouté par son créateur au
// lancement) et sa part des creator fees (les 20 % de son agent) forment son budget ; chaque réponse
// coûte ce que le modèle coûte (OpenRouter renvoie le prix exact), retiré de son budget. Budget vide :
// l'agent pense avec un esprit gratuit (Workers AI, puis Groq), jusqu'au prochain versement.
//
// Le catalogue (les modèles et leurs prix) est relu toutes les 6 heures, gardé dans les réglages.
import { CONFIG } from './config.js';
import { getSetting, setSetting } from './settings.js';
import { solUsd } from './telegram.js';
import { labLogo, labName, labOf } from './labs.js';

const API = 'https://openrouter.ai/api/v1';
const DAY = 86_400_000;
const O = CONFIG.openrouter;

export const orReady = (env) => Boolean(env.OPENROUTER_API_KEY);

export { labLogo, labName };
export const isModelId = (id) => typeof id === 'string' && id.length <= 120 && /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i.test(id);

// Un modèle du catalogue d'OpenRouter, réduit à ce que le site montre. null s'il ne convient pas
// (pas de texte en sortie, prix inconnu, gratuit à quota, routeur automatique).
export function trimModel(m) {
  const id = m?.id;
  if (!isModelId(id) || id.endsWith(':free') || labOf(id) === 'openrouter') return null;
  const pin = Number(m.pricing?.prompt), pout = Number(m.pricing?.completion);
  if (!Number.isFinite(pin) || !Number.isFinite(pout) || pin < 0 || pout < 0 || pin + pout === 0) return null;
  const out = m.architecture?.output_modalities;
  const inp = m.architecture?.input_modalities;
  if ((Array.isArray(out) && !out.includes('text')) || (Array.isArray(inp) && !inp.includes('text'))) return null;
  const name = String(m.name || id).replace(/^[^:]{1,40}:\s*/, '').slice(0, 60);
  return { id, name, lab: labName(id), pin, pout, ctx: Number(m.context_length) || null, created: Number(m.created) || null };
}

// Ce que coûte un « run » (une réponse typique de l'agent), en dollars.
export const runCost = (m) => O.runTokens.in * m.pin + O.runTokens.out * m.pout;

export async function catalog(db) {
  return (await getSetting(db, 'or.models', null))?.models || [];
}
export async function findModel(db, id) {
  return (await catalog(db)).find((m) => m.id === id) || null;
}

// Le cron : le catalogue relu toutes les 6 heures (public, sans clé).
export async function refreshCatalog(env, now, { force = false } = {}) {
  const known = await getSetting(env.DB, 'or.models', null);
  if (!force && known?.at && now - known.at < O.catalogEveryMs) return known.models.length;
  const res = await fetch(`${API}/models`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`openrouter_models_${res.status}`);
  const data = await res.json();
  const models = (Array.isArray(data?.data) ? data.data : []).map(trimModel).filter(Boolean)
    .sort((a, b) => (b.created || 0) - (a.created || 0));
  if (!models.length) throw new Error('openrouter_models_empty');
  await setSetting(env.DB, 'or.models', { at: now, models });
  return models.length;
}

// Ce que l'admin a dépensé chez OpenRouter aujourd'hui (tous les agents) : un plafond de sécurité.
export async function orSpentToday(db, now) {
  const s = await getSetting(db, 'or.day', null);
  return s?.day === Math.floor(now / DAY) ? s.usd : 0;
}
async function addSpent(db, now, usd) {
  const day = Math.floor(now / DAY);
  const s = await getSetting(db, 'or.day', null);
  await setSetting(db, 'or.day', { day, usd: (s?.day === day ? s.usd : 0) + usd });
}

// Une réponse d'un modèle d'OpenRouter. → { text, cost } (cost en dollars, le prix exact).
export async function callOpenRouter(env, model, { system, prompt, maxTokens = 220, temperature = 0.8 }) {
  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': env.SITE_URL || 'https://trywick.fun',
      'X-Title': 'WICK',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature,
      // Les modèles qui réfléchissent d'abord : peu, et sans le montrer.
      reasoning: { effort: 'low', exclude: true },
      usage: { include: true },
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) throw new Error(`openrouter ${res.status}: ${JSON.stringify(data?.error?.message || data?.error || '').slice(0, 160)}`);
  const text = data?.choices?.[0]?.message?.content || '';
  const u = data?.usage || {};
  const cost = Number(u.cost) >= 0 && u.cost != null ? Number(u.cost) : null;
  return { text, cost, tokens: { in: u.prompt_tokens || 0, out: u.completion_tokens || 0 } };
}

// Les crédits restants du compte (pour l'admin).
export async function orCredits(env) {
  const res = await fetch(`${API}/credits`, { headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}` } });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.data) throw new Error(`openrouter ${res.status}: ${JSON.stringify(data?.error?.message || data?.error || '').slice(0, 120)}`);
  return { total: Number(data.data.total_credits) || 0, used: Number(data.data.total_usage) || 0 };
}

// ------------------------------------------------------------ le budget d'un coin
// Le prix du SOL : le dernier connu (gardé dans les réglages, DEX Screener peut être occupé).
export async function solPrice(db, now, fresh = null) {
  if (fresh > 0) {
    const known = await getSetting(db, 'sol.usd', null);
    if (!known || now - known.at > 10 * 60_000) await setSetting(db, 'sol.usd', { usd: fresh, at: now });
    return fresh;
  }
  return (await getSetting(db, 'sol.usd', null))?.usd ?? null;
}

// Ce que l'agent d'un coin a reçu (son fuel, une fois la fee payée, et sa part des creator fees,
// depuis toujours), ce qu'il a dépensé, et ce qui lui reste, en dollars.
export async function mindBudget(db, mint, sol) {
  const row = await db.prepare(
    `SELECT m.fuel_lamports, m.fee_state, m.mind_spent,
       (SELECT COALESCE(SUM(s.team_lamports * m.share_crew_bps / m.share_team_bps), 0) FROM shares s
         WHERE s.mint = m.mint AND s.status = 'ok' AND s.team_lamports > 0 AND m.share_team_bps > 0) AS crew
     FROM matches m WHERE m.mint = ?`,
  ).bind(mint).first();
  if (!row) return null;
  const fuel = row.fee_state === 'paid' ? row.fuel_lamports || 0 : 0;
  const inSol = (fuel + Math.floor(row.crew || 0)) / 1e9;
  const inUsd = sol ? inSol * sol : 0;
  const spent = row.mind_spent || 0;
  return { fuelSol: fuel / 1e9, crewSol: Math.floor(row.crew || 0) / 1e9, inSol, inUsd, spentUsd: spent, leftUsd: Math.max(0, inUsd - spent) };
}

// L'agent d'un coin pense avec son modèle d'OpenRouter, si son budget le permet. → { text, mind } ou null.
export async function orThink(env, coin, { system, prompt, maxTokens, temperature, now }) {
  if (!orReady(env) || !coin?.mint) return null;
  const db = env.DB;
  const row = coin.mind_or !== undefined ? coin : await db.prepare('SELECT mint, mind_or FROM matches WHERE mint = ?').bind(coin.mint).first();
  if (!row?.mind_or) return null;
  const model = await findModel(db, row.mind_or);
  if (!model) return null;
  // Le plafond de sécurité du jour (tous les agents) : les crédits de l'admin ne fondent jamais d'un coup.
  const cap = Number(env.OPENROUTER_DAILY_USD ?? O.dailyUsd);
  if ((await orSpentToday(db, now)) >= cap) return null;
  // Pas (ou plus) de crédits sur le compte : on ne réessaie pas avant 15 minutes. Le budget du coin
  // reste intact : il servira dès que les crédits seront rechargés avec le fuel reçu.
  if (((await getSetting(db, 'or.pause', 0)) || 0) > now) return null;
  const budget = await mindBudget(db, coin.mint, await solPrice(db, now));
  const estimate = (prompt.length + system.length) / 4 * model.pin + maxTokens * model.pout;
  if (!budget || budget.leftUsd < estimate) return null;
  try {
    const out = await callOpenRouter(env, model.id, { system, prompt, maxTokens, temperature });
    const cost = out.cost ?? out.tokens.in * model.pin + out.tokens.out * model.pout;
    await db.prepare('UPDATE matches SET mind_spent = mind_spent + ?, mind_runs = mind_runs + 1 WHERE mint = ?').bind(cost, coin.mint).run();
    await addSpent(db, now, cost);
    if (!out.text) return null;
    return { text: out.text, mind: { id: `or:${model.id}`, name: model.name, by: model.lab, logo: labLogo(model.id) } };
  } catch (err) {
    console.log('openrouter', model.id, err?.message ?? err);
    if (/\b402\b|credit|insufficient/i.test(String(err?.message))) await setSetting(db, 'or.pause', now + 15 * 60_000);
    return null;
  }
}

// Le cron : le catalogue (toutes les 6 heures) et le prix du SOL (pour les budgets).
export async function runOpenRouter(env, now) {
  await solPrice(env.DB, now, await solUsd(now).catch(() => null));
  return refreshCatalog(env, now).catch((err) => { console.log('openrouter catalog', err.message); return 0; });
}

// GET /api/models : le catalogue, avec le prix d'un run de chaque modèle.
export async function publicModels(env, now) {
  const models = await catalog(env.DB);
  return {
    ready: orReady(env),
    solUsd: await solPrice(env.DB, now),
    fuelOptions: O.fuelOptions,
    runTokens: O.runTokens,
    models: models.map((m) => ({ ...m, run: runCost(m), logo: labLogo(m.id) })),
  };
}
