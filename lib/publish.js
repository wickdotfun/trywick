// PUBLISH : l'Operator d'un coin poste dans les groupes Telegram reliés à son coin.
//
// - Relier : on ajoute le bot de WICK à son groupe, et un admin envoie /link <CA> (ou /link $TICKER
//   si un seul coin WICK le porte). /unlink pour arrêter, /status pour voir. Le bot reçoit les
//   commandes par un webhook (POST /api/telegram), réglé tout seul par le cron.
// - Ce qu'il y poste : à la liaison, son kit de lancement (avec son logo) ; ensuite ses paliers et
//   ses burns (le reçu, avec la transaction) dès qu'ils arrivent dans son Activity ; et un récap par
//   jour (market cap, volume, burns, sa dernière ligne de journal).
// - Les temps forts (gros paliers de market cap, grosses parts de supply brûlées) repartent aussi
//   sur le canal de WICK.
// - Jamais de spam : 10 minutes au moins entre deux posts dans un groupe, 12 par jour au plus, un
//   récap par jour ; un groupe dont le bot a été retiré est oublié.
import { siteImage } from './ipfs.js';
import { tgToken } from './tgtoken.js';
import { CONFIG } from './config.js';
import { readKit } from './kit.js';
import { usd } from './missions.js';
import { logAction } from './operator.js';
import { getSetting, setSetting } from './settings.js';
import { telegramReady, tg } from './telegram.js';

const P = CONFIG.operator.publish;
const DAY = 86_400_000;
const POSTABLE = ['milestone', 'burned'];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const site = (env) => (env.SITE_URL || 'https://trywick.fun').replace(/\/$/, '');
const page = (env, mint) => `${site(env)}/#coin/${mint}`;
const isMint = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s || '');
export const botReady = (env) => Boolean(env.TELEGRAM_BOT_TOKEN);

// Le secret du webhook : dérivé du token du bot (rien de plus à régler).
export async function webhookSecret(env) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`wick-webhook:${tgToken(env)}`));
  return [...new Uint8Array(d)].slice(0, 24).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Le webhook pointe vers le site (revérifié toutes les 12 heures), et le nom du bot est retenu.
export async function ensureWebhook(env, now) {
  if (!botReady(env)) return null;
  const url = `${site(env)}/api/telegram`;
  const known = await getSetting(env.DB, 'tg.webhook');
  if (known?.url === url && now - known.at < 12 * 3_600_000) return known;
  await tg(env, 'setWebhook', { url, secret_token: await webhookSecret(env), allowed_updates: ['message', 'channel_post'] });
  const me = await tg(env, 'getMe', {});
  const v = { url, at: now, username: me?.username || null };
  await setSetting(env.DB, 'tg.webhook', v);
  return v;
}

const gone = (err) => /kicked|chat not found|bot was blocked|deactivated|not enough rights|have no rights|CHAT_WRITE_FORBIDDEN|need administrator/i.test(String(err?.message));

// Envoie une photo (l'image du coin, que Telegram va chercher lui-même), ou le texte seul.
async function send(env, chatId, { text, image, mint }) {
  const reply_markup = mint ? { inline_keyboard: [[{ text: 'Its agent on WICK', url: page(env, mint) }, { text: 'Chart', url: `https://dexscreener.com/solana/${mint}` }]] } : undefined;
  if (image && /^https:\/\//.test(image) && text.length <= 1000) {
    try { return await tg(env, 'sendPhoto', { chat_id: chatId, photo: siteImage(env, image), caption: text, reply_markup }); } catch (err) { if (gone(err)) throw err; }
  }
  return tg(env, 'sendMessage', { chat_id: chatId, text, reply_markup, link_preview_options: { is_disabled: true } });
}

// ------------------------------------------------------------ les messages
const sign = (env, m) => `\n\n<i>Agent of $${esc(m.symbol)}</i> · <a href="${esc(page(env, m.mint))}">its Activity</a>`;

export function welcomeText(env, m, kit) {
  const body = kit?.telegram ? esc(kit.telegram) : `$${esc(m.symbol)} is live on WICK.\n\nCA: ${esc(m.mint)}`;
  return `${body}\n\nI will post here: my milestones, my burns, and a recap every day.${sign(env, m)}`;
}

export function updateText(env, m, entries) {
  const lines = entries.map((e) => {
    const tx = e.sig ? ` · <a href="https://solscan.io/tx/${esc(e.sig)}">tx</a>` : '';
    return `<b>${esc(e.title)}</b>${tx}${e.detail ? `\n${esc(e.detail)}` : ''}`;
  });
  return `<b>$${esc(m.symbol)}</b> · agent update\n\n${lines.join('\n\n')}${sign(env, m)}`;
}

export function recapText(env, m, day) {
  const rows = [
    m.mcap ? `Market cap: <b>${usd(m.mcap)}</b>${m.change24h != null ? ` (${m.change24h >= 0 ? '+' : ''}${Math.round(m.change24h)}% 24h)` : ''}` : null,
    m.vol24h ? `Volume 24h: <b>${usd(m.vol24h)}</b>` : null,
    m.self_bps ? `Burns today: <b>${day.burns}</b>${day.burns ? ` (${Math.round(day.burned).toLocaleString('en-US')} $${esc(m.symbol)})` : ''}` : null,
    m.keeper_thought ? `\n“${esc(m.keeper_thought)}”` : null,
  ].filter(Boolean);
  return `<b>$${esc(m.symbol)}</b> · daily recap\n\n${rows.join('\n')}\n\nCA: <code>${esc(m.mint)}</code>${sign(env, m)}`;
}

// ------------------------------------------------------------ les commandes (webhook)
const HELP = 'I am the WICK bot. Every coin launched on WICK has an AI agent.\n\n'
  + 'To have it post in your group: add me to the group, then an admin sends\n/link <its CA>\n\n'
  + 'It will post its launch kit, its milestones, its burns and a daily recap. /unlink to stop, /status to see.';

export async function handleUpdate(env, update, now = Date.now()) {
  const msg = update?.message || update?.channel_post;
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  const cmd = text.match(/^\/(link|unlink|status|start|help)(?:@\w+)?(?:\s+(\S+))?/i);
  if (!cmd) return null;
  const chat = msg.chat;
  const name = cmd[1].toLowerCase();
  const reply = (t) => tg(env, 'sendMessage', { chat_id: chat.id, text: t, link_preview_options: { is_disabled: true } }).catch(() => null);
  if (chat.type === 'private') { await reply(HELP); return 'help'; }
  if (!['group', 'supergroup', 'channel'].includes(chat.type)) return null;
  if (name === 'start' || name === 'help') { await reply(HELP); return 'help'; }
  // Seuls les admins du groupe relient ou délient (dans un canal, seuls ses admins publient).
  if (chat.type !== 'channel') {
    const member = await tg(env, 'getChatMember', { chat_id: chat.id, user_id: msg.from?.id }).catch(() => null);
    if (!['creator', 'administrator'].includes(member?.status)) { await reply('Only an admin of this group can do that.'); return 'not_admin'; }
  }
  const db = env.DB;
  const chatId = String(chat.id);
  if (name === 'status') {
    const { results } = await db.prepare('SELECT m.symbol FROM op_channels c JOIN matches m ON m.mint = c.mint WHERE c.chat_id = ?').bind(chatId).all();
    await reply(results.length ? `Linked: ${results.map((r) => `$${r.symbol}`).join(', ')}. Their agents post here.` : 'No coin linked here yet. Send /link <its CA>.');
    return 'status';
  }
  if (name === 'unlink') {
    await db.prepare('DELETE FROM op_channels WHERE chat_id = ?').bind(chatId).run();
    await reply('Unlinked. The agents will not post here anymore.');
    return 'unlinked';
  }
  // /link <CA | $TICKER>
  const arg = (cmd[2] || '').replace(/^\$/, '');
  let coin = null;
  if (isMint(arg)) {
    coin = await db.prepare('SELECT * FROM matches WHERE mint = ? AND seq IS NOT NULL').bind(arg).first();
  } else if (arg) {
    const { results } = await db.prepare('SELECT * FROM matches WHERE UPPER(symbol) = ? AND seq IS NOT NULL LIMIT 2').bind(arg.toUpperCase()).all();
    coin = results.length === 1 ? results[0] : null;
    if (results.length > 1) { await reply(`Several coins on WICK use $${arg.toUpperCase()}. Send its CA: /link <CA>`); return 'ambiguous'; }
  }
  if (!coin) { await reply('That coin is not on WICK. Send /link followed by its CA.'); return 'unknown'; }
  if (!coin.keeper_style) { await reply(`$${coin.symbol} was launched before agents: it has none.`); return 'no_operator'; }
  const [{ n: inGroup }, { n: groups }] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM op_channels WHERE chat_id = ?').bind(chatId).first(),
    db.prepare('SELECT COUNT(*) AS n FROM op_channels WHERE mint = ?').bind(coin.mint).first(),
  ]);
  if (inGroup >= P.maxCoinsPerGroup) { await reply(`This group already follows ${P.maxCoinsPerGroup} coins. /unlink first.`); return 'full'; }
  if (groups >= P.maxGroupsPerCoin) { await reply(`$${coin.symbol}'s agent already posts in ${P.maxGroupsPerCoin} groups.`); return 'full'; }
  const { last } = await db.prepare('SELECT COALESCE(MAX(id), 0) AS last FROM operator_log WHERE mint = ?').bind(coin.mint).first();
  const added = await db.prepare(`INSERT OR IGNORE INTO op_channels (chat_id, mint, title, linked_at, last_log_id, last_post_at, day, day_posts, recap_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`).bind(chatId, coin.mint, String(chat.title || '').slice(0, 80), now, last, now, Math.floor(now / DAY), now).run();
  if (added.meta?.changes !== 1) { await reply(`$${coin.symbol} is already linked here.`); return 'already'; }
  await send(env, chat.id, { text: welcomeText(env, coin, readKit(coin.op_kit)), image: coin.image, mint: coin.mint }).catch(() => null);
  await logAction(db, coin.mint, { kind: 'posted', at: now, ref: `link:${chatId}`, title: 'Started posting in a Telegram group', detail: 'Its launch kit first, then its milestones, its burns and a daily recap.' });
  return 'linked';
}

// ------------------------------------------------------------ le cron
export async function runPublish(env, now) {
  if (!botReady(env)) return 0;
  const db = env.DB;
  await ensureWebhook(env, now).catch((err) => console.error('telegram webhook', err.message));
  const today = Math.floor(now / DAY);
  const { results } = await db.prepare(
    `SELECT c.*, m.symbol, m.name, m.image, m.mcap, m.change24h, m.vol24h, m.keeper_thought, m.self_bps
     FROM op_channels c JOIN matches m ON m.mint = c.mint WHERE c.last_post_at < ? ORDER BY c.last_post_at LIMIT 5`,
  ).bind(now - P.minGapMs).all();
  let posted = 0;
  for (const c of results) {
    const dayPosts = c.day === today ? c.day_posts : 0;
    if (dayPosts >= P.maxPerDay) continue;
    const { results: fresh } = await db.prepare('SELECT id, kind, title, detail, sig FROM operator_log WHERE mint = ? AND id > ? ORDER BY id LIMIT 20')
      .bind(c.mint, c.last_log_id).all();
    const lastId = fresh.length ? fresh.at(-1).id : c.last_log_id;
    const news = fresh.filter((e) => POSTABLE.includes(e.kind)).slice(-4);
    let text = null, image = null, recap = false;
    if (news.length) {
      text = updateText(env, c, news);
    } else if (now - c.recap_at >= P.recapEveryMs) {
      const day = await db.prepare(
        `SELECT COUNT(*) AS burns, COALESCE(SUM(b.burned_ui), 0) AS burned FROM burns b
         WHERE b.kind = 'coin' AND b.status = 'burned' AND b.ref LIKE ? AND b.burned_at > ?`,
      ).bind(`${c.mint}:%`, now - DAY).first();
      text = recapText(env, c, day);
      image = c.image;
      recap = true;
    }
    if (!text) {
      if (lastId !== c.last_log_id) await db.prepare('UPDATE op_channels SET last_log_id = ? WHERE chat_id = ? AND mint = ?').bind(lastId, c.chat_id, c.mint).run();
      continue;
    }
    try {
      await send(env, c.chat_id, { text, image, mint: c.mint });
    } catch (err) {
      console.error('operator post', c.chat_id, err.message);
      if (gone(err)) await db.prepare('DELETE FROM op_channels WHERE chat_id = ? AND mint = ?').bind(c.chat_id, c.mint).run();
      continue;
    }
    posted++;
    await db.prepare(`UPDATE op_channels SET last_log_id = ?, last_post_at = ?, day = ?, day_posts = ?, recap_at = CASE WHEN ? THEN ? ELSE recap_at END
      WHERE chat_id = ? AND mint = ?`).bind(lastId, now, today, dayPosts + 1, recap ? 1 : 0, now, c.chat_id, c.mint).run();
    if (recap) {
      await logAction(db, c.mint, { kind: 'posted', at: now, ref: `recap:${today}`, title: 'Posted its daily recap on Telegram', detail: 'Market cap, volume, burns and its latest journal line.' });
    }
  }
  posted += await runHighlights(env, now).catch((err) => { console.error('highlights', err.message); return 0; });
  return posted;
}

// Les temps forts des coins, repris sur le canal de WICK (un toutes les 30 minutes au plus).
export function isHighlight(ref) {
  const [kind, v] = String(ref || '').split(':');
  return (kind === 'mcap' && Number(v) >= P.highlight.mcap) || (kind === 'burn' && Number(v) >= P.highlight.burnPct);
}
export async function runHighlights(env, now) {
  if (!telegramReady(env)) return 0;
  const db = env.DB;
  const state = (await getSetting(db, 'op.highlights')) || { lastId: null, at: 0 };
  if (state.lastId == null) {
    // Au premier passage, on part d'ici : pas de rattrapage du passé.
    const { last } = await db.prepare("SELECT COALESCE(MAX(id), 0) AS last FROM operator_log WHERE kind = 'milestone'").first();
    await setSetting(db, 'op.highlights', { lastId: last, at: 0 });
    return 0;
  }
  const { results } = await db.prepare(
    `SELECT l.id, l.ref, l.title, l.detail, l.mint, m.symbol, m.image FROM operator_log l JOIN matches m ON m.mint = l.mint
     WHERE l.kind = 'milestone' AND l.id > ? ORDER BY l.id LIMIT 30`,
  ).bind(state.lastId).all();
  let lastId = state.lastId;
  for (const e of results) {
    if (!isHighlight(e.ref)) { lastId = e.id; continue; }
    if (now - state.at < P.highlight.minGapMs) break;
    const text = `<b>$${esc(e.symbol)}</b> · ${esc(e.title)}\n${esc(e.detail || '')}\n\nIts agent logged it on WICK.`;
    await send(env, env.TELEGRAM_CHAT_ID, { text, image: e.image, mint: e.mint });
    await setSetting(db, 'op.highlights', { lastId: e.id, at: now });
    return 1;
  }
  if (lastId !== state.lastId) await setSetting(db, 'op.highlights', { lastId, at: state.at });
  return 0;
}

// Pour la page d'un coin : le bot à ajouter, et combien de groupes suivent son Operator.
export async function telegramInfo(env, mint) {
  const [hook, row] = await Promise.all([
    getSetting(env.DB, 'tg.webhook'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM op_channels WHERE mint = ?').bind(mint).first(),
  ]);
  return { bot: hook?.username || null, groups: row?.n || 0 };
}
