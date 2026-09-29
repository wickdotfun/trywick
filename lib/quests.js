// Les quêtes : une suite de petites missions, à faire dans l'ordre, qui font gagner
// de la CROISSANCE à ta bougie (elle évolue plus vite vers la torche). Elles ne
// touchent jamais à l'âge : le classement des plus vieilles flammes et la
// récompense de la semaine restent impossibles à acheter avec des quêtes.
//
// Quatre sortes de quêtes :
// - x_claim : poster son code sur X. Le compte X qui l'a posté est lié à la bougie
//             (un compte X = une seule bougie) ;
// - x_post  : poster ou répondre sur X avec son code, depuis le compte lié ;
// - honor   : suivre un compte, liker un post… invérifiable gratuitement : on ouvre
//             le lien et on valide après quelques secondes (petite récompense) ;
// - game    : vérifiées dans le jeu (nourrie 3 jours de suite, forme atteinte…).
//
// Les posts X sont vérifiés gratuitement, sans clé, par oEmbed (le service public
// qu'X propose pour afficher un post sur un site) : il renvoie l'auteur et le texte.
import { HOUR } from './config.js';
import { sha256 } from './players.js';

export const OFFICIAL_X = 'trywickdotfun';
// Pour une quête sur l'honneur : délai minimum entre « ouvrir le lien » et « c'est fait ».
export const HONOR_DELAY = 8_000;

// needsPost : la quête parle du post d'annonce (ANNOUNCEMENT_URL) ; sans lui, elle est retirée.
export const BASE_QUESTS = [
  // Jour 1. Pour une nouvelle bougie, « claim » est fait à la naissance (réponse au post d'annonce).
  {
    id: 'claim', kind: 'x_claim', chapter: 1, rewardMs: 6 * HOUR,
    title: 'Claim your candle',
    text: 'Reply to our announcement post on X with your code. Your @ gets linked to your candle: one X account, one candle.',
  },
  {
    id: 'follow', kind: 'honor', chapter: 1, rewardMs: 2 * HOUR,
    title: `Follow @${OFFICIAL_X}`, url: `https://x.com/${OFFICIAL_X}`,
    text: 'New quests, the weekly winners and everything built in public.',
  },
  {
    id: 'meal1', kind: 'game', chapter: 1, rewardMs: 2 * HOUR, stat: 'feeds', goal: 1,
    title: 'First meal', text: 'Feed your candle once. It melts a little every hour.',
  },
  {
    id: 'boost', kind: 'honor', chapter: 1, rewardMs: 2 * HOUR, needsPost: true,
    title: 'Like & repost the announcement', text: 'Help the first candles find their way here.',
  },
  // La dernière du premier jour, pour le lore : montrer sa bougie. Peu de croissance.
  {
    id: 'photo', kind: 'x_photo', chapter: 1, rewardMs: 1 * HOUR,
    title: 'Show your candle', text: 'Post the photo of your candle on X, with your code.',
  },
  // Ensuite : la garder en vie.
  {
    id: 'feed3', kind: 'game', chapter: 2, rewardMs: 6 * HOUR, stat: 'feedStreak', goal: 3,
    title: 'Three days of care', text: 'Feed your candle 3 days in a row.',
  },
  {
    id: 'taper', kind: 'game', chapter: 2, rewardMs: 6 * HOUR, stat: 'stageIndex', goal: 1,
    title: 'First growth', text: 'Help your candle reach the Taper form.',
  },
  {
    id: 'visit5', kind: 'game', chapter: 2, rewardMs: 12 * HOUR, stat: 'visitStreak', goal: 5,
    title: 'A regular', text: 'Come back 5 days in a row.',
  },
  {
    id: 'feed10', kind: 'game', chapter: 2, rewardMs: 6 * HOUR, stat: 'feeds', goal: 10,
    title: 'Well fed', text: 'Feed your candle 10 times in this life.',
  },
];

const KINDS = ['x_claim', 'x_post', 'x_photo', 'honor', 'game'];

// Les quêtes ajoutées par le dev (POST /api/admin/quest), rangées après les quêtes de base.
// announcement : le lien du post d'annonce (ANNOUNCEMENT_URL), s'il existe.
export function allQuests(extra = [], announcement = null) {
  const post = parseStatusUrl(announcement) ? announcement : null;
  const base = BASE_QUESTS.filter((q) => !q.needsPost || post).map((q) => {
    const out = { ...q };
    if (q.needsPost || q.id === 'claim') out.url = post || undefined;
    // Sans post d'annonce, « claim » se fait avec un post libre qui contient le code.
    if (q.id === 'claim' && !post) out.text = 'Post your candle code on X. Your @ gets linked to your candle: one X account, one candle.';
    delete out.needsPost;
    return out;
  });
  const ids = new Set(base.map((q) => q.id));
  const added = (Array.isArray(extra) ? extra : [])
    .filter((q) => q && typeof q.id === 'string' && !ids.has(q.id) && KINDS.includes(q.kind) && q.kind !== 'x_claim')
    .map((q) => ({
      id: q.id, kind: q.kind, chapter: Number(q.chapter) || 3,
      rewardMs: Math.max(0, Math.min(48, Number(q.rewardHours) || 2)) * HOUR,
      title: String(q.title || q.id).slice(0, 80), text: String(q.text || '').slice(0, 240),
      url: typeof q.url === 'string' && /^https:\/\//.test(q.url) ? q.url : undefined,
      stat: q.stat, goal: q.goal,
    }));
  return [...base, ...added];
}

// Le code de chaque joueur (ex. WICK-7F3KQ) : toujours le même, calculé, jamais stocké.
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
async function makeCode(seed) {
  const hex = await sha256(seed);
  let out = '';
  for (let i = 0; i < 5; i++) out += B32[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % B32.length];
  return `WICK-${out}`;
}
export const questCode = (playerId, salt = '') => makeCode(`quest:${salt}:${playerId}`);
// Avant la naissance, le joueur n'existe pas encore : le code vient du pseudo choisi,
// et il le garde ensuite. Les codes d'avant (calculés depuis l'identifiant) restent acceptés.
export const birthCode = (name, salt = '') => makeCode(`birth:${salt}:${String(name).toLowerCase()}`);
export async function codesFor(player, salt = '') {
  return [await birthCode(player.name, salt), await questCode(player.id, salt)];
}

// https://x.com/pseudo/status/123… (ou twitter.com, mobile.twitter.com) → { user, id }
export function parseStatusUrl(input) {
  const m = String(input || '').trim().match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/i);
  return m ? { user: m[1], id: m[2] } : null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—' };
function decode(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, e) => {
      if (e[0] === '#') {
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : all;
      }
      return ENTITIES[e.toLowerCase()] ?? all;
    });
}

// Lit la réponse oEmbed d'un post : son auteur (@pseudo) et son texte.
export function readOembed(data) {
  const author = String(data?.author_url || '').match(/(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})/i)?.[1] || null;
  const html = String(data?.html || '');
  const p = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  return { author, text: decode(p ? p[1] : html) };
}

// Le post contient-il le code du joueur ? Insensible à la casse, aux espaces autour du
// tiret, aux tirets « typographiques » et aux caractères invisibles.
export function hasCode(text, code) {
  const norm = (s) => String(s || '').normalize('NFKC').toUpperCase()
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[\u2010-\u2015\u2212\uFE63\uFF0D]/g, '-')
    .replace(/\s*-\s*/g, '-');
  return norm(text).includes(norm(code));
}

// Le jeton demandé par le service « syndication » d'X (celui des posts intégrés aux sites).
export function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

// Lit la réponse « syndication » : auteur, texte, post auquel il répond, nombre de photos.
export function readSyndication(data) {
  if (!data || data.__typename === 'TweetTombstone' || !data.user?.screen_name) return null;
  const media = Array.isArray(data.mediaDetails) ? data.mediaDetails : [];
  const photos = (Array.isArray(data.photos) ? data.photos.length : 0) || media.filter((m) => m?.type === 'photo').length;
  return {
    author: data.user.screen_name,
    text: String(data.text || ''),
    replyTo: data.in_reply_to_status_id_str || null,
    photos,
  };
}

// Va chercher un post sur X, gratuitement et sans clé. D'abord le service « syndication »
// (auteur, texte, post parent, photos), sinon oEmbed (auteur et texte seulement : dans
// ce cas replyTo et photos valent null, « inconnu »).
// Renvoie { id, author, text, replyTo, photos, source } ou { error, why }.
export async function fetchPost(url, fetcher = fetch) {
  const p = parseStatusUrl(url);
  if (!p) return { error: 'bad_url' };
  const why = [];
  try {
    const res = await fetcher(`https://cdn.syndication.twimg.com/tweet-result?id=${p.id}&lang=en&token=${syndicationToken(p.id)}`, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; WICK/1.0; +https://trywick.fun)' },
    });
    why.push(`syndication ${res.status}`);
    if (res.ok) {
      const post = readSyndication(await res.json().catch(() => null));
      if (post) return { id: p.id, ...post, source: 'syndication' };
      why.push('syndication empty');
    }
  } catch (err) {
    why.push(`syndication ${String(err?.message || err).slice(0, 60)}`);
  }
  try {
    const target = `https://twitter.com/${p.user}/status/${p.id}`;
    const res = await fetcher(`https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(target)}`, {
      headers: { accept: 'application/json' },
    });
    why.push(`oembed ${res.status}`);
    if (res.status === 404 || res.status === 403) return { error: 'post_not_found', why: why.join(', ') };
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const post = readOembed(data);
      if (post.author) return { id: p.id, ...post, replyTo: null, photos: null, source: 'oembed' };
      why.push('oembed empty');
    }
  } catch (err) {
    why.push(`oembed ${String(err?.message || err).slice(0, 60)}`);
  }
  return { error: 'x_unreachable', why: why.join(', ') };
}

// Vérifie un post pour une quête (ou pour la naissance). expected :
// { codes (un seul suffit), handle? (compte déjà lié), replyTo? (id du post d'annonce), photo? }
// Renvoie null si tout va bien, sinon le nom de l'erreur.
export function checkPost(post, { codes, handle = null, replyTo = null, photo = false }) {
  if (!codes.some((c) => hasCode(post.text, c))) return 'code_missing';
  if (handle && handle.toLowerCase() !== post.author.toLowerCase()) return 'wrong_account';
  // replyTo / photos inconnus (oEmbed) : on ne peut pas vérifier, on laisse passer.
  if (replyTo && post.replyTo !== null && post.replyTo !== undefined && post.replyTo !== replyTo) return 'not_a_reply';
  if (photo && post.photos !== null && post.photos !== undefined && post.photos < 1) return 'no_photo';
  return null;
}

// La liste vue par un joueur : faites, celle en cours, et les suivantes (verrouillées).
// stats : { feedStreak, stageIndex, visitStreak, feeds } ; rows : Map id → { started_at, done_at }
export function questStates(quests, rows, stats, now = Date.now()) {
  let current = null;
  return quests.map((q) => {
    const row = rows.get(q.id);
    let status = 'locked';
    if (row?.done_at) status = 'done';
    else if (!current) { current = q.id; status = 'current'; }
    const out = { id: q.id, kind: q.kind, chapter: q.chapter, title: q.title, text: q.text, url: q.url, rewardMs: q.rewardMs, status };
    if (q.kind === 'game') {
      const have = Math.min(q.goal, Math.max(0, Number(stats?.[q.stat]) || 0));
      out.progress = { have, goal: q.goal };
      out.ready = status === 'current' && have >= q.goal;
    }
    if (q.kind === 'honor' && row?.started_at && !row?.done_at) {
      out.startedAt = row.started_at;
      out.ready = now - row.started_at >= HONOR_DELAY;
    }
    return out;
  });
}
