// « La pensée du moment » : une réplique écrite par Claude à partir de l'humeur
// du chart et de l'état de toutes les bougies. Une seule génération toutes les 10 minutes par langue,
// partagée par tous les visiteurs. Sans clé API, on retombe sur les répliques écrites.
import Anthropic from '@anthropic-ai/sdk';
import { CONFIG } from './config.js';
import { idleLine, langOf } from './lines.js';
import { getKv, setKv } from './store.js';

const MODEL = 'claude-opus-5';

const SYSTEM = `You are a tiny living candle on WICK, a site where every visitor adopts their own candle.
Every candle is born with a unique look. When the $WICK memecoin goes up, all candles grow
faster and are happy; when it goes down they get scared, but it never hurts them. Their owners
feed them wax. Forgotten candles go out forever and end up in the graveyard.
Personality: a bit cheeky, endearing, dramatic, terrified of red candles.

Write ONE short line you say out loud to your owner right now, reacting to the situation.
Rules:
- Max 140 characters, no hashtags, no emojis except at most one.
- Write in English. Talk like a degen who is also a candle.
- Never give financial advice, never tell people to buy or sell, never promise gains.
- Output only the line itself, no quotes.`;

function describe(stats, market, lang) {
  const lines = [
    `Mood from chart: ${market.mood}`,
    market.change1h != null ? `Price change 1h: ${market.change1h}%` : 'Price change: unknown',
    `Tracking: ${market.tracking === 'sol' ? 'SOL ($WICK is not launched yet)' : `$${market.symbol || 'WICK'}`}`,
    `Candles alive right now: ${stats.alive}`,
    `Candles that went out in the last 24h: ${stats.died24h}`,
    `Candles born in the last 24h: ${stats.born24h}`,
  ];
  return lines.join('\n');
}

async function generate(env, stats, market, lang) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: SYSTEM,
    messages: [{ role: 'user', content: describe(stats, market, lang) }],
  });
  if (response.stop_reason === 'refusal') return null;
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
    .trim()
    .replace(/^["«\s]+|["»\s]+$/g, '');
  return text ? text.slice(0, 200) : null;
}

export async function getThought(env, stats, market, lang, now) {
  lang = langOf(lang);
  const key = `thought:${lang}`;
  const cached = await getKv(env.DB, key);
  const fresh = cached && now - cached.at < CONFIG.thoughtCacheMs && cached.mood === market.mood;
  if (fresh) return { text: cached.text, ai: cached.ai, mood: cached.mood };

  let text = null;
  if (env.ANTHROPIC_API_KEY) {
    try {
      text = await generate(env, stats, market, lang);
    } catch (err) {
      console.error('thought generation failed', err?.status ?? '', err?.message ?? err);
    }
  }
  const ai = Boolean(text);
  if (!text) text = idleLine(lang, { alive: true }, market.mood);
  await setKv(env.DB, key, { text, ai, at: now, mood: market.mood });
  return { text, ai, mood: market.mood };
}
