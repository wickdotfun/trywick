// Le lancement officiel de $WICK, sans rien à faire le jour J.
//
// Le cron surveille, chaque minute, le wallet qui va lancer $WICK (le « dev wallet »,
// DEPLOYER_WALLET, ou CONFIG.launch.deployer). Dès qu'il crée sur pump.fun un coin dont le ticker
// est celui de $WICK (TOKEN_TICKER, « WICK ») :
// - son adresse est enregistrée (réglage launch.detected) et le site passe en live tout seul
//   (withLaunch : elle sert de TOKEN_MINT tant que TOKEN_MINT n'est pas réglé dans Cloudflare) ;
// - le message officiel part dans le canal Telegram avec l'adresse (le CA), et il est épinglé.
// Une seule fois, pour toujours. Un TOKEN_MINT réglé dans Cloudflare passe toujours avant.
import { CONFIG } from './config.js';
import { fromBase58, rpc } from './solana.js';
import { getSetting, setSetting } from './settings.js';
import { telegramReady } from './telegram.js';

const CREATE = [24, 30, 200, 40, 5, 28, 7, 119];
const CREATE_V2 = [214, 144, 76, 236, 95, 139, 49, 180];

// Les instructions create / create_v2 de pump.fun commencent par : nom, ticker, uri (des
// chaînes Borsh : longueur sur 4 octets, puis le texte).
export function readCreate(data) {
  if (!data || data.length < 8 + 12) return null;
  const disc = [...data.subarray(0, 8)];
  if (!disc.every((b, i) => b === CREATE[i]) && !disc.every((b, i) => b === CREATE_V2[i])) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const text = new TextDecoder();
  let at = 8;
  const str = () => {
    if (at + 4 > data.length) throw new Error('truncated');
    const n = view.getUint32(at, true);
    if (n > 400 || at + 4 + n > data.length) throw new Error('bad_string');
    const s = text.decode(data.subarray(at + 4, at + 4 + n));
    at += 4 + n;
    return s;
  };
  try {
    return { name: str(), symbol: str(), uri: str() };
  } catch {
    return null;
  }
}

// Dans une transaction confirmée (getTransaction, encodage json) : le coin créé sur pump.fun par
// `wallet` (payeur et signataire), s'il en a un. Renvoie { mint, name, symbol } ou null.
export function launchIn(res, wallet) {
  const msg = res?.transaction?.message;
  if (!msg || res.meta?.err) return null;
  const keys = (msg.accountKeys || []).map((k) => (typeof k === 'string' ? k : k.pubkey));
  if (keys[0] !== wallet) return null;
  for (const ix of msg.instructions || []) {
    if (keys[ix.programIdIndex] !== CONFIG.pumpProgram) continue;
    let data;
    try { data = fromBase58(ix.data); } catch { continue; }
    const coin = readCreate(data);
    if (coin) return { mint: keys[ix.accounts[0]], name: coin.name, symbol: coin.symbol };
  }
  return null;
}

export function deployer(env) {
  return env.DEPLOYER_WALLET || CONFIG.launch.deployer || null;
}

// Le message officiel (le même que le premier post X).
export function announceText(mint, { ticker = 'WICK', site = 'https://trywick.fun' } = {}) {
  return [
    `$${ticker} is live. the only CA:`,
    '',
    `<code>${mint}</code>`,
    '',
    `every coin launched on ${ticker} lights the same flame.`,
    `launch a coin → generate ignition fees → buy $${ticker} → burn $${ticker}`,
    '',
    `the more ${ticker} is used, the more of its own supply disappears.`,
    '',
    'the launchpad that burns itself.',
    `${site.replace(/\/?$/, '/')}`,
  ].join('\n');
}

async function tg(env, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, ...body }),
  });
  const data = await res.json().catch(() => null);
  if (!data?.ok) throw new Error(`telegram_${method}: ${data?.description || res.status}`);
  return data.result;
}

// Les nouvelles transactions du dev wallet (les plus anciennes d'abord) : y a-t-il le lancement ?
async function detect(env, wallet, ticker) {
  const last = await getSetting(env.DB, 'launch.lastSig');
  const sigs = await rpc(env, 'getSignaturesForAddress', [wallet, { limit: 25, commitment: 'confirmed', ...(last ? { until: last } : {}) }]);
  if (!sigs?.length) return null;
  for (const s of [...sigs].reverse()) {
    if (s.err) continue;
    const res = await rpc(env, 'getTransaction', [s.signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
    const coin = launchIn(res, wallet);
    if (coin && coin.symbol.trim().replace(/^\$/, '').toUpperCase() === ticker.toUpperCase()) {
      return { ...coin, sig: s.signature };
    }
  }
  await setSetting(env.DB, 'launch.lastSig', sigs[0].signature);
  return null;
}

// Le lancement de $WICK par le dev wallet, détecté une fois pour toutes. Renvoie { mint, sig, at } ou null.
export async function detectLaunch(env, now) {
  const db = env.DB;
  const known = await getSetting(db, 'launch.detected');
  if (known) return known;
  const wallet = deployer(env);
  if (!wallet) return null;
  const found = await detect(env, wallet, env.TOKEN_TICKER || 'WICK');
  if (!found) return null;
  const launch = { mint: found.mint, sig: found.sig, at: now };
  await db.prepare("INSERT OR IGNORE INTO settings (k, v) VALUES ('launch.detected', ?)").bind(JSON.stringify(launch)).run();
  launched.delete(db);
  return getSetting(db, 'launch.detected');
}

// L'environnement du Worker, avec l'adresse de $WICK détectée comme TOKEN_MINT si elle n'est pas
// réglée dans Cloudflare. Gardé en mémoire : une fois trouvée, l'adresse ne change plus.
const launched = new WeakMap();   // base → { mint, at }
export async function withLaunch(env) {
  if (env.TOKEN_MINT || !env.DB) return env;
  let known = launched.get(env.DB);
  if (!known || (!known.mint && Date.now() - known.at > 15_000)) {
    try {
      known = { mint: (await getSetting(env.DB, 'launch.detected'))?.mint ?? null, at: Date.now() };
    } catch {
      return env;   // la base n'est pas encore prête
    }
    launched.set(env.DB, known);
  }
  return known.mint ? { ...env, TOKEN_MINT: known.mint } : env;
}

// Une passe du cron. Renvoie le mint annoncé, ou null.
export async function runAnnounce(env, now) {
  const db = env.DB;
  const detected = env.TOKEN_MINT ? null : await detectLaunch(env, now);
  if (!telegramReady(env) || (await getSetting(db, 'launch.announced'))) return null;
  const ticker = env.TOKEN_TICKER || 'WICK';
  const launch = env.TOKEN_MINT ? { mint: env.TOKEN_MINT, sig: null } : detected;
  if (!launch) return null;

  // Réservé avant d'envoyer : jamais deux annonces, même si deux crons se chevauchent.
  const claimed = await db.prepare("INSERT OR IGNORE INTO settings (k, v) VALUES ('launch.announced', ?)")
    .bind(JSON.stringify({ mint: launch.mint, sig: launch.sig, at: now })).run();
  if (claimed.meta?.changes !== 1) return null;
  const site = env.SITE_URL || 'https://trywick.fun';
  try {
    const msg = await tg(env, 'sendMessage', {
      parse_mode: 'HTML',
      text: announceText(launch.mint, { ticker, site }),
      link_preview_options: { url: site, prefer_large_media: true, show_above_text: false },
      reply_markup: {
        inline_keyboard: [
          [{ text: `💊 Buy $${ticker}`, url: `https://pump.fun/coin/${launch.mint}` }, { text: '📊 Chart', url: `https://dexscreener.com/solana/${launch.mint}` }],
          [{ text: '🕯️ trywick.fun', url: site }],
        ],
      },
    });
    // Épinglé, pour que l'adresse officielle reste en haut du canal (si le bot en a le droit).
    await tg(env, 'pinChatMessage', { message_id: msg.message_id, disable_notification: false }).catch((err) => console.log('telegram pin', err.message));
  } catch (err) {
    console.error('telegram announce', err.message);
    await db.prepare("DELETE FROM settings WHERE k = 'launch.announced'").run();   // on retentera à la minute suivante
    return null;
  }
  return launch.mint;
}
