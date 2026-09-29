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

export const BASE_QUESTS = [
  {
    id: 'claim', kind: 'x_claim', chapter: 1, rewardMs: 12 * HOUR,
    title: 'Claim your candle',
    text: 'Post your candle code on X. Your @ gets linked to your candle: one X account, one candle.',
  },
  {
    id: 'follow', kind: 'honor', chapter: 1, rewardMs: 2 * HOUR,
    title: `Follow @${OFFICIAL_X}`, url: `https://x.com/${OFFICIAL_X}`,
    text: 'New quests, the weekly winners and everything built in public.',
  },
  {
    id: 'feed3', kind: 'game', chapter: 1, rewardMs: 6 * HOUR, stat: 'feedStreak', goal: 3,
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

const KINDS = ['x_claim', 'x_post', 'honor', 'game'];

// Les quêtes ajoutées par le dev (POST /api/admin/quest), rangées après les quêtes de base.
export function allQuests(extra = []) {
  const base = BASE_QUESTS.map((q) => ({ ...q }));
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
export async function questCode(playerId, salt = '') {
  const hex = await sha256(`quest:${salt}:${playerId}`);
  let out = '';
  for (let i = 0; i < 5; i++) out += B32[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % B32.length];
  return `WICK-${out}`;
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

// Le post contient-il le code du joueur ? (insensible à la casse et aux espaces autour du tiret)
export function hasCode(text, code) {
  const norm = (s) => s.toUpperCase().replace(/\s*-\s*/g, '-');
  return norm(text).includes(norm(code));
}

// Va chercher un post sur X. Renvoie { author, text } ou { error }.
export async function fetchPost(url, fetcher = fetch) {
  const p = parseStatusUrl(url);
  if (!p) return { error: 'bad_url' };
  const target = `https://twitter.com/${p.user}/status/${p.id}`;
  let res;
  try {
    res = await fetcher(`https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(target)}`, {
      headers: { accept: 'application/json' },
    });
  } catch {
    return { error: 'x_unreachable' };
  }
  if (res.status === 404 || res.status === 403) return { error: 'post_not_found' };
  if (!res.ok) return { error: 'x_unreachable' };
  let data;
  try { data = await res.json(); } catch { return { error: 'x_unreachable' }; }
  return { id: p.id, ...readOembed(data) };
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
