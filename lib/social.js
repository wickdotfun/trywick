// Les grands moments de $WICK, postés tout seuls avec leur carte (lib/cards.js) :
// - DEX payé : le profil de $WICK approuvé sur DEX Screener (vérifié toutes les 3 minutes) ;
// - les paliers de market cap ($50K, $100K, $250K…), une fois chacun, le plus haut atteint ;
// - les tokens lockés : depuis la page d'admin (montant, date, lien de preuve), la carte dessinée
//   dans le navigateur.
// Chaque post part sur Telegram (le canal du bot) et sur X si ses clés sont réglées (lib/x.js).
// Jamais deux fois le même : chaque moment est réservé dans les réglages avant d'être posté.
import { tgToken } from './tgtoken.js';
import { dexJson } from './dex.js';
import { MILESTONES, milestoneFile, usdShort } from './cards.js';
import { getSetting, setSetting } from './settings.js';
import { agentLine, telegramReady } from './telegram.js';
import { xPost, xReady } from './x.js';

const CHECK_EVERY_MS = 3 * 60_000;
const site = (env) => (env.SITE_URL || 'https://trywick.fun').replace(/\/$/, '');
const ticker = (env) => env.TOKEN_TICKER || 'WICK';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// L'image d'une carte dessinée d'avance (public/cards/), servie par le site lui-même.
export async function cardBytes(env, file) {
  const res = await env.ASSETS.fetch(new Request(`${site(env)}/cards/${file}`));
  if (!res.ok) throw new Error(`card ${file}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Une photo dans le canal Telegram (envoyée en octets : pas besoin que Telegram lise le site).
export async function tgPhoto(env, { image, caption, buttons }) {
  const form = new FormData();
  form.append('chat_id', env.TELEGRAM_CHAT_ID);
  form.append('photo', new Blob([image], { type: 'image/png' }), 'card.png');
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');
  if (buttons) form.append('reply_markup', JSON.stringify({ inline_keyboard: buttons }));
  const res = await fetch(`https://api.telegram.org/bot${tgToken(env)}/sendPhoto`, { method: 'POST', body: form });
  const data = await res.json().catch(() => null);
  if (!data?.ok) throw new Error(`telegram_sendPhoto: ${data?.description || res.status}`);
  return data.result;
}

export const buttons = (env, mint) => [
  [{ text: `Buy $${ticker(env)}`, url: `https://pump.fun/coin/${mint}` }, { text: 'Chart', url: `https://dexscreener.com/solana/${mint}` }],
  [{ text: 'trywick.fun', url: site(env) }],
];

// Ce que dit chaque moment : la légende Telegram (HTML) et le texte du post X.
export function postText(kind, d, env) {
  const t = `$${ticker(env)}`;
  const ca = d.mint ? `\n\nCA: ${d.mint}` : '';
  const caHtml = d.mint ? `\n\n<code>${esc(d.mint)}</code>` : '';
  switch (kind) {
    case 'dexpaid':
      return {
        caption: `<b>DEX PAID</b>\n\n${t} is official on DEX Screener: logo, banner and socials are live.${d.mcap ? `\n\nMarket cap: <b>${usdShort(d.mcap)}</b>` : ''}${caHtml}`,
        x: `dex paid.\n\n${t} is official on DEX Screener: logo, banner, socials, all verified.${ca}`,
      };
    case 'mcap':
      return {
        caption: `<b>${usdShort(d.mcap)}</b>\n\n${t} just crossed a ${usdShort(d.mcap)} market cap.\nEvery coin launched on WICK keeps burning it.${caHtml}`,
        x: `${t} just crossed a ${usdShort(d.mcap)} market cap.\n\nevery launch on WICK buys ${t} and burns it. more launches, less ${t}.${ca}`,
      };
    case 'lock': {
      const amount = `${Math.round(d.amount).toLocaleString('en-US')} ${t}`;
      const pct = d.pct ? ` (${+d.pct.toFixed(2)}% of the supply)` : '';
      const until = d.until ? ` until ${d.until}` : '';
      return {
        caption: `<b>TOKENS LOCKED</b>\n\n${esc(amount)}${pct} locked${esc(until)}${d.where ? ` on ${esc(d.where)}` : ''}.${d.link ? `\n\nProof: <a href="${esc(d.link)}">${esc(d.where || 'the lock contract')}</a>` : ''}`,
        x: `tokens are locked.\n\n${amount}${pct} locked${until}.${d.link ? `\n\n${d.link}` : ''}`,
      };
    }
    default:
      return { caption: '', x: '' };
  }
}

// Poste un moment (une fois : key le réserve). image : les octets de la carte.
// Renvoie { telegram, x } (id du message / du post, ou l'erreur), ou null s'il était déjà posté.
export async function publish(env, key, { image, caption, x, mint }, { once = true } = {}) {
  const db = env.DB;
  const k = `social.${key}`;
  if (once) {
    const claimed = await db.prepare('INSERT OR IGNORE INTO settings (k, v) VALUES (?, ?)').bind(k, JSON.stringify({ status: 'sending', at: Date.now() })).run();
    if (claimed.meta?.changes !== 1) return null;
  }
  const out = {};
  if (telegramReady(env)) {
    try { out.telegram = (await tgPhoto(env, { image, caption, buttons: mint ? buttons(env, mint) : null })).message_id; } catch (err) { out.telegramError = err.message; }
  }
  if (xReady(env)) {
    try { out.x = await xPost(env, { text: x, image }); } catch (err) { out.xError = err.message; }
  }
  const sent = Boolean(out.telegram || out.x);
  const tried = telegramReady(env) || xReady(env);
  // Rien n'est parti alors qu'un canal est prêt : on retentera au prochain passage.
  if (once && tried && !sent) {
    await db.prepare('DELETE FROM settings WHERE k = ?').bind(k).run();
    return out;
  }
  if (once) await setSetting(db, k, { status: sent ? 'posted' : 'no_channel', at: Date.now(), ...out });
  return out;
}

// DEX Screener : le profil payé (une commande « tokenProfile » approuvée, ou les infos du profil
// déjà affichées sur la paire) et la market cap.
async function dex(mint) {
  const get = (url) => dexJson(url).catch(() => null);
  const [orders, pairs] = await Promise.all([
    get(`https://api.dexscreener.com/orders/v1/solana/${mint}`),
    get(`https://api.dexscreener.com/tokens/v1/solana/${mint}`),
  ]);
  const list = Array.isArray(orders) ? orders : orders?.orders || [];
  const ps = Array.isArray(pairs) ? pairs : pairs?.pairs || [];
  const paid = list.some((o) => o?.type === 'tokenProfile' && o?.status === 'approved') || ps.some((p) => p?.info?.imageUrl);
  const mcap = Math.max(0, ...ps.map((p) => Number(p?.marketCap ?? p?.fdv) || 0));
  return { paid, mcap: mcap || null };
}

// Le cron : au plus toutes les 3 minutes, une fois $WICK lancé.
export async function runSocial(env, now) {
  const mint = env.TOKEN_MINT;
  if (!mint) return null;
  const db = env.DB;
  const last = await getSetting(db, 'social.checkAt');
  if (last && now - last < CHECK_EVERY_MS) return null;
  await setSetting(db, 'social.checkAt', now);
  const { paid, mcap } = await dex(mint);
  const done = [];
  if (paid && !(await getSetting(db, 'social.dexpaid'))) {
    const r = await publish(env, 'dexpaid', { image: await cardBytes(env, 'dex-paid.png'), mint, ...postText('dexpaid', { mint, mcap }, env) });
    if (r) done.push('dexpaid');
  }
  if (mcap) {
    const best = (await getSetting(db, 'social.mcap'))?.value || 0;
    const hit = MILESTONES.filter((n) => n <= mcap && n > best).pop();
    if (hit) {
      // Le palier est noté d'abord : une baisse puis une remontée ne le repostent pas.
      await setSetting(db, 'social.mcap', { value: hit, at: now });
      const r = await publish(env, `mcap.${hit}`, { image: await cardBytes(env, milestoneFile(hit)), mint, ...postText('mcap', { mint, mcap: hit }, env) });
      if (r) done.push(`mcap.${hit}`);
    }
  }
  return done.length ? done : null;
}

// ------------------------------------------------------------ chaque nouveau coin, sur X
// Chaque coin lancé sur WICK est posté aussi sur le X de WICK (si ses clés sont réglées) : son
// nom, son agent, son CA, son image. Une seule fois, dans les 3 heures qui suivent son lancement.
// Sans clés X, la page d'admin a un bouton « Post on X » par coin, le texte déjà écrit.
export function coinXText(m, env) {
  const agent = agentLine(m);
  return [
    `new coin on WICK: $${m.symbol}`,
    '',
    m.name,
    ...(agent ? [`its agent: ${agent}`] : []),
    '',
    `CA: ${m.mint}`,
    '',
    `${site(env)}/#coin/${m.mint}`,
  ].join('\n');
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
async function coinImage(url) {
  if (!/^https:\/\//.test(url || '')) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!res.ok || !IMAGE_TYPES.includes(type)) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.length && bytes.length <= 5_000_000 ? { bytes, type } : null;
  } catch {
    return null;
  }
}

export async function runCoinX(env, now) {
  if (!xReady(env)) return 0;
  const db = env.DB;
  const { results } = await db.prepare(
    'SELECT * FROM matches WHERE seq IS NOT NULL AND x_state IS NULL AND lit_at > ? ORDER BY seq LIMIT 2',
  ).bind(now - 3 * 3600_000).all();
  let done = 0;
  for (const m of results) {
    const claimed = await db.prepare("UPDATE matches SET x_state = 'posting' WHERE mint = ? AND x_state IS NULL").bind(m.mint).run();
    if (claimed.meta?.changes !== 1) continue;
    const img = await coinImage(m.image);
    try {
      const id = await xPost(env, { text: coinXText(m, env), image: img?.bytes, type: img?.type });
      await db.prepare('UPDATE matches SET x_state = ? WHERE mint = ?').bind(String(id || 'posted'), m.mint).run();
      done++;
    } catch (err) {
      // Pas de nouvel essai automatique (crédits X épuisés, clés refusées…) : le bouton de l'admin.
      console.error('x coin', m.mint, err.message);
      await db.prepare('UPDATE matches SET x_state = ? WHERE mint = ?').bind(`error: ${String(err.message).slice(0, 160)}`, m.mint).run();
    }
  }
  return done;
}

// Pour la page d'admin : ce qui a été posté, et les canaux prêts.
export async function socialStatus(env) {
  const { results } = await env.DB.prepare("SELECT k, v FROM settings WHERE k LIKE 'social.%' AND k != 'social.checkAt'").all();
  const posts = results.map((r) => {
    let v = null;
    try { v = JSON.parse(r.v); } catch { /* */ }
    return { key: r.k.slice(7), ...v };
  }).sort((a, b) => (b.at || 0) - (a.at || 0));
  return { telegram: telegramReady(env), x: xReady(env), posts, milestones: MILESTONES.map((n) => ({ value: n, label: usdShort(n), file: milestoneFile(n) })) };
}
