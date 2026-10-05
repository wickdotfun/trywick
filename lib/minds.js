// Les esprits premium : Claude (Anthropic), GPT (OpenAI), Gemini (Google), Grok (xAI), appelés
// par leur API. Chacun n'existe que si sa clé est réglée dans Cloudflare (ANTHROPIC_API_KEY,
// OPENAI_API_KEY, GEMINI_API_KEY, XAI_API_KEY), et son modèle peut être changé sans redéployer le
// code (PREMIUM_CLAUDE_MODEL…). Ils sont payés par la part « crew » des creator fees de chaque coin :
// un coin y a droit ses 7 premiers jours, puis tant que son crew gagne de quoi les payer
// (premiumFunded). Sinon, et si l'appel échoue, l'Operator pense avec l'esprit gratuit (Llama).
import { CONFIG } from './config.js';

const K = CONFIG.keepers;
const DAY = 86_400_000;

export const isPremium = (mind) => Boolean(mind?.premium);
export const premiumReady = (env, mind) => Boolean(isPremium(mind) && env?.[mind.key]);
export const modelOf = (env, mind) => env?.[mind.modelEnv] || mind.model;

async function postJson(url, headers, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}: ${JSON.stringify(data?.error || data || '').slice(0, 160)}`);
  return data;
}

// Un appel à un esprit premium. Renvoie son texte (ou lève une erreur).
export async function callPremium(env, mind, { system, prompt, maxTokens = 220, temperature = 0.8 }) {
  const model = modelOf(env, mind);
  const key = env[mind.key];
  if (mind.provider === 'anthropic') {
    const d = await postJson('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      { model, max_tokens: maxTokens, temperature, system, messages: [{ role: 'user', content: prompt }] });
    return (d?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  }
  if (mind.provider === 'google') {
    const d = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      // Les modèles qui réfléchissent d'abord ont besoin de place pour leur réponse.
      generationConfig: { maxOutputTokens: maxTokens + 1000, temperature },
    });
    return (d?.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  }
  // OpenAI, xAI et MiniMax : la même API (chat completions).
  const url = { xai: 'https://api.x.ai/v1/chat/completions', minimax: 'https://api.minimax.io/v1/chat/completions' }[mind.provider] || 'https://api.openai.com/v1/chat/completions';
  const messages = [{ role: 'system', content: system }, { role: 'user', content: prompt }];
  const d = await postJson(url, { authorization: `Bearer ${key}` }, mind.provider !== 'openai'
    ? { model, max_tokens: maxTokens + 1000, temperature, messages }
    // Les modèles GPT-5 raisonnent d'abord, et n'acceptent que leur température par défaut.
    : { model, max_completion_tokens: maxTokens + 1000, messages });
  return d?.choices?.[0]?.message?.content || '';
}

// Ce que le crew d'un coin a gagné ces 7 derniers jours (en lamports) : sa part de ce que le wallet
// de l'équipe a reçu à chaque distribution.
export async function crewEarned(db, mint, now) {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(s.team_lamports * m.share_crew_bps / m.share_team_bps), 0) AS lamports
     FROM shares s JOIN matches m ON m.mint = s.mint
     WHERE s.mint = ? AND s.status = 'ok' AND s.at > ? AND s.team_lamports > 0 AND m.share_team_bps > 0`,
  ).bind(mint, now - 7 * DAY).first();
  return Math.floor(row?.lamports || 0);
}

// Un coin a-t-il droit à son esprit premium ? Avant son lancement (Spark), et ses 7 premiers jours :
// oui. Ensuite, tant que son crew a gagné assez ces 7 derniers jours.
export async function premiumFunded(db, coin, now) {
  if (!coin?.mint) return true;
  if (coin.lit_at && now - coin.lit_at < K.premiumBoostMs) return true;
  return (await crewEarned(db, coin.mint, now)) >= K.premiumMinCrewSol * 1e9;
}
