// CREATE : le kit de lancement que l'Operator d'un coin prépare juste après son lancement :
// son lore, trois posts pour X (le lancement, l'histoire, l'Operator et ses burns) et une annonce
// Telegram. Écrit par son esprit, dans sa personnalité ; sans IA (quota épuisé, réponse
// inutilisable, contenu interdit), un kit tout prêt à partir de ses modèles. Chaque coin en a un.
// Le kit est public (onglet « Kit » de la page du coin) : le créateur, et tous les holders, peuvent
// le poster.
import { onKit } from './operator.js';
import { keeperStyle, persona, think } from './keepers.js';
import { blocked } from './spark.js';

const DAY = 86_400_000;

// Un post propre : sans raisonnement, sans lien ni hashtag, sans emoji, sans guillemets autour.
// keepLines : garder les retours à la ligne (l'annonce Telegram).
export function cleanPost(text, max, keepLines = false) {
  let s = String(text ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/#\w+/g, '')
    .replace(/[*_`]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '');
  s = keepLines
    ? s.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n')
    : s.replace(/\s+/g, ' ');
  s = s.trim().replace(/^["'“”«»]+|["'“”«»]+$/g, '').trim();
  if (s.length > max) s = `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
  return s;
}

const burnLine = (m) => (m.self_bps > 0
  ? `${m.self_bps / 100}% of its creator fees buy it back and burn it, forever.`
  : 'Launched on WICK, where every coin is a candle.');

// Le kit sans IA : écrit à partir de ses modèles (le même pour chaque coin, avec ses chiffres).
export function templateKit(m) {
  const sym = `$${m.symbol}`;
  const about = cleanPost(m.description, 180) || `${m.name}, a new candle on WICK.`;
  return {
    lore: cleanPost(`${about} ${sym} was launched on WICK with its own AI Operator, which tends its candle and speaks to its holders.`, 400),
    x: [
      `${sym} is live on pump.fun. ${burnLine(m)}`,
      `${m.name}: ${about}`,
      `${sym} has its own AI Operator. Every action it takes is public: the launch, its journal, every burn.`,
    ].map((p) => cleanPost(p, 220)),
    telegram: cleanPost(`${sym} is live.\n\n${about}\n\n${burnLine(m)}`, 500, true),
    ai: false,
  };
}

// La réponse de l'IA, nettoyée. null si inutilisable ou interdite.
export function parseKit(text) {
  const json = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').match(/\{[\s\S]*\}/);
  if (!json) return null;
  let d;
  try { d = JSON.parse(json[0]); } catch { return null; }
  const x = (Array.isArray(d.x) ? d.x : Array.isArray(d.posts) ? d.posts : []).map((p) => cleanPost(p, 220)).filter((p) => p.length >= 20).slice(0, 3);
  const lore = cleanPost(d.lore, 400);
  const telegram = cleanPost(d.telegram, 500, true);
  if (x.length < 3 || lore.length < 20 || telegram.length < 20) return null;
  if (blocked(`${lore} ${x.join(' ')} ${telegram}`)) return null;
  return { lore, x, telegram, ai: true };
}

const RULES = `Write the launch kit of this coin, in character, in English:
- "lore": its story in 2 or 3 sentences (max 400 characters);
- "x": 3 posts for X, each with a different angle (the launch, its story, its Operator and its burns), max 220 characters each;
- "telegram": one announcement for its Telegram group (max 500 characters, line breaks allowed).
No links, no hashtags, no emojis. Never promise anything about price, never tell anyone to buy.
Reply with JSON only: {"lore":"…","x":["…","…","…"],"telegram":"…"}`;

// Le kit d'un coin (avec son CA au bon endroit).
export async function makeKit(env, m, now) {
  const facts = {
    coin: `$${m.symbol} (${m.name})`,
    about: m.description || 'no description yet',
    burn: burnLine(m),
    launched_on: 'WICK, the Solana launchpad where every coin is a candle and gets its own AI Operator',
  };
  const out = parseKit(await think(env, {
    model: m.keeper_model, system: `${persona(m)}\n${RULES}`, prompt: JSON.stringify(facts),
    now, kind: 'kit', maxTokens: 700, temperature: 0.9,
  })) || templateKit(m);
  return {
    ...out,
    x: out.x.map((p, i) => (i === 0 ? `${p}\n\nCA: ${m.mint}` : p)),
    telegram: `${out.telegram}\n\nCA: ${m.mint}`,
    at: now,
  };
}

// Le cron : un coin à la fois, ceux lancés depuis moins de 7 jours qui n'ont pas encore leur kit.
export async function runKits(env, now) {
  const db = env.DB;
  const m = await db.prepare(
    `SELECT mint, symbol, name, description, keeper_style, keeper_model, keeper_goal, keeper_prompt, self_bps FROM matches
     WHERE keeper_style IS NOT NULL AND op_kit IS NULL AND seq IS NOT NULL AND lit_at > ?
     ORDER BY lit_at DESC LIMIT 1`,
  ).bind(now - 7 * DAY).first();
  if (!m || !keeperStyle(m.keeper_style)) return 0;
  const kit = await makeKit(env, m, now);
  const saved = await db.prepare('UPDATE matches SET op_kit = ? WHERE mint = ? AND op_kit IS NULL').bind(JSON.stringify(kit), m.mint).run();
  if (saved.meta?.changes !== 1) return 0;
  await onKit(db, m, kit, now).catch((err) => console.error('operator log', err.message));
  return 1;
}

export function readKit(json) {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

