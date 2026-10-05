// SCOUT : le premier agent du crew. Toutes les 30 minutes, il lit ce qui monte sur Solana (les
// tokens les plus boostés et les derniers profils de DEX Screener, avec leur marché), et en tire
// trois narratifs : un titre, un angle, une idée de coin. Chaque narratif cite ses sources (les
// tokens qu'il a vus, avec leur page DEX Screener) : rien n'est inventé. Sans IA, il montre
// simplement ce qui monte le plus. Le site les propose dans le lancement (« Scout's picks »).
import { CONFIG } from './config.js';
import { cleanLine, think } from './keepers.js';
import { blocked } from './safety.js';
import { getSetting, setSetting } from './settings.js';
import { usd } from './missions.js';

const S = CONFIG.scout;
const FEEDS = ['https://api.dexscreener.com/token-boosts/top/v1', 'https://api.dexscreener.com/token-profiles/latest/v1'];
const MARKET = 'https://api.dexscreener.com/tokens/v1/solana/';

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`scout_${res.status}`);
  return res.json();
}

// Ce qui monte : les tokens Solana des flux, avec leur marché. → [{ mint, name, symbol, about, mcap, change, vol, url }]
export async function scoutTokens() {
  const feeds = await Promise.allSettled(FEEDS.map(getJson));
  const seen = new Map();
  for (const f of feeds) {
    if (f.status !== 'fulfilled' || !Array.isArray(f.value)) continue;
    for (const t of f.value) {
      if (t?.chainId !== 'solana' || !t.tokenAddress || seen.has(t.tokenAddress)) continue;
      seen.set(t.tokenAddress, { about: cleanLine(t.description || '', 160) });
      if (seen.size >= S.maxTokens) break;
    }
  }
  if (!seen.size) return [];
  const pairs = await getJson(MARKET + [...seen.keys()].join(',')).catch(() => []);
  const best = new Map();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const mint = p?.baseToken?.address;
    if (!seen.has(mint) || (best.get(mint)?.liquidity?.usd || 0) > (p.liquidity?.usd || 0)) continue;
    best.set(mint, p);
  }
  return [...best.entries()].map(([mint, p]) => ({
    mint,
    name: cleanLine(p.baseToken.name || '', 40),
    symbol: cleanLine(p.baseToken.symbol || '', 12).toUpperCase(),
    about: seen.get(mint).about,
    mcap: p.marketCap || p.fdv || 0,
    change: p.priceChange?.h24 ?? null,
    vol: p.volume?.h24 || 0,
    url: p.url || `https://dexscreener.com/solana/${mint}`,
  }))
    .filter((t) => t.name && t.symbol && t.mcap >= S.minMcap && !blocked(`${t.name} ${t.symbol} ${t.about}`))
    .sort((a, b) => b.vol - a.vol);
}

// La réponse de l'IA : des narratifs dont chaque source est un token qu'il a vraiment vu.
export function parseNarratives(text, tokens) {
  const json = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').match(/\{[\s\S]*\}/);
  if (!json) return null;
  let d;
  try { d = JSON.parse(json[0]); } catch { return null; }
  const bySym = new Map(tokens.map((t) => [t.symbol, t]));
  const out = [];
  for (const n of Array.isArray(d.narratives) ? d.narratives : []) {
    const title = cleanLine(n?.title, 48);
    const angle = cleanLine(n?.angle, 160);
    const idea = cleanLine(n?.idea, 200);
    const sources = [...new Set((Array.isArray(n?.sources) ? n.sources : []).map((s) => String(s).replace(/^\$/, '').toUpperCase()))]
      .filter((s) => bySym.has(s)).slice(0, 3);
    if (title.length < 3 || idea.length < 10 || !sources.length || blocked(`${title} ${angle} ${idea}`)) continue;
    out.push({ title, angle, idea, sources });
    if (out.length >= S.narratives) break;
  }
  return out.length ? out : null;
}

// Sans IA : ce qui monte le plus, tel quel.
export function plainNarratives(tokens) {
  return tokens.slice(0, S.narratives).map((t) => ({
    title: `$${t.symbol} is running`,
    angle: `${usd(t.vol)} traded in 24 hours${t.change != null ? `, ${t.change > 0 ? '+' : ''}${Math.round(t.change)}%` : ''}. ${t.about}`.trim(),
    idea: t.about || `${t.name}, but a candle`,
    sources: [t.symbol],
  }));
}

const rules = (n) => `You are the Scout of WICK, a Solana launchpad. You read what is trending on Solana right now and
find the narratives behind it: the themes, memes and stories several tokens share.
Reply with JSON only: {"narratives":[{"title":"2 to 5 words","angle":"one sentence: what is happening, from the data",
"idea":"one sentence: an original coin idea that rides this narrative (never a copy of an existing token)",
"sources":["SYMBOL", "..."]}]}
Give ${n} narratives. Every narrative cites 1 to 3 sources, by their symbol, taken only from the list. Never invent a
number, never promise a price, never tell anyone to buy.`;

// Le cron : une fois toutes les 30 minutes.
export async function runScout(env, now) {
  // Le Scout (des idées de coins pour le lancement) n'est plus proposé : coupé, sauf SCOUT=on.
  if (env.SCOUT !== 'on') return 0;
  const last = await getSetting(env.DB, 'scout', null);
  if (last?.at && now - last.at < S.everyMs) return 0;
  const tokens = await scoutTokens().catch((err) => { console.error('scout', err.message); return []; });
  if (!tokens.length) return 0;
  const list = tokens.slice(0, S.forAi).map((t) => ({ symbol: t.symbol, name: t.name, about: t.about, mcap: usd(t.mcap), vol24h: usd(t.vol), change24h: t.change }));
  const ai = await think(env, {
    system: rules(S.narratives), prompt: JSON.stringify(list),
    now, kind: 'scout', maxTokens: 700, temperature: 0.7, light: true,
  });
  const found = parseNarratives(ai, tokens);
  const narratives = found || plainNarratives(tokens);
  const used = new Set(narratives.flatMap((n) => n.sources));
  await setSetting(env.DB, 'scout', {
    at: now,
    ai: Boolean(found),
    narratives,
    sources: tokens.filter((t) => used.has(t.symbol)).map(({ mint, name, symbol, mcap, change, vol, url }) => ({ mint, name, symbol, mcap, change, vol, url })),
    seen: tokens.length,
  });
  return 1;
}

// Ce que le site montre.
export async function scoutPicks(db) {
  const s = await getSetting(db, 'scout', null);
  return s?.narratives?.length ? s : null;
}
