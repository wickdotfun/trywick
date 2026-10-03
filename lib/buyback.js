// Les burns de $WICK. Ils tournent dans le cron, depuis une file (table burns), une étape à
// la fois, le plus ancien d'abord :
//
//   queued  → achat de $WICK → buying
//   buying  → l'achat est confirmé : on note combien de $WICK il a rapporté → bought
//   bought  → on brûle exactement ce qui vient d'être acheté → burning_tx → burned
//
// Deux sortes de burns :
// - 'candle' : une bougie s'est éteinte. On collecte les creator fees, puis on rachète avec
//   la cagnotte : le solde SOL du wallet, moins une réserve pour les frais, moins les frais de
//   lancement pas encore brûlés (ils ont leur propre burn) ;
// - 'match' : quelqu'un a lancé un coin et payé le frais de lancement (0,02 SOL) : on le
//   rachète en $WICK et on le brûle, dans la minute.
// Ce wallet ne sert qu'à ça : sa clé (BUYBACK_SECRET_KEY) est un secret Cloudflare.
// Seuls les jetons rachetés par le cycle sont brûlés, jamais le reste du wallet.
//
// Chaque étape est « réclamée » par une écriture atomique (status = … WHERE status = …) :
// deux crons qui se chevauchent ne rachètent jamais deux fois.
//
// En pause (page d'admin), aucun nouvel achat ne part : la bougie est notée « paused » et la
// cagnotte attend. Un achat déjà parti va quand même jusqu'au burn, pour ne jamais laisser
// des $WICK rachetés sans les brûler.
import { CONFIG } from './config.js';
import { buybackPaused } from './settings.js';
import {
  base58, buildBurnTx, fromBase58, getBalance, getLatestBlockhash, sendTransaction,
  signTransaction, signatureOf, signatureStatus, tokenHolding,
} from './solana.js';

const LAMPORTS = 1e9;

function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// La clé secrète, au format de Phantom (base58) ou de la CLI Solana ([12, 34, …]) : 64 octets,
// la graine puis la clé publique.
export function parseSecretKey(text) {
  const s = String(text || '').trim();
  const bytes = s.startsWith('[') ? Uint8Array.from(JSON.parse(s)) : fromBase58(s);
  if (bytes.length !== 64) throw new Error('bad_secret_key');
  return { seed: bytes.slice(0, 32), publicKey: bytes.slice(32) };
}

let walletCache = null;
export async function buybackWallet(env) {
  if (!env.BUYBACK_SECRET_KEY) return null;
  if (walletCache?.secret === env.BUYBACK_SECRET_KEY) return walletCache.wallet;
  const { seed, publicKey } = parseSecretKey(env.BUYBACK_SECRET_KEY);
  const key = await crypto.subtle.importKey(
    'jwk', { kty: 'OKP', crv: 'Ed25519', d: b64url(seed), x: b64url(publicKey) },
    { name: 'Ed25519' }, false, ['sign'],
  ).catch(() => { throw new Error('bad_secret_key'); });
  const pub = await crypto.subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, ['verify']);
  const sign = async (msg) => new Uint8Array(await crypto.subtle.sign('Ed25519', key, msg));
  // La graine et la clé publique doivent aller ensemble, sinon rien ne serait accepté on-chain.
  const probe = new TextEncoder().encode('wick');
  if (!(await crypto.subtle.verify('Ed25519', pub, await sign(probe), probe))) throw new Error('bad_secret_key');
  const wallet = { publicKey: base58(publicKey), sign };
  walletCache = { secret: env.BUYBACK_SECRET_KEY, wallet };
  return wallet;
}

export async function buybackLive(env) {
  return Boolean(env.TOKEN_MINT && (await buybackWallet(env).catch(() => null)));
}

// Les SOL des frais de lancement pas encore rachetés : ils ne font pas partie de la cagnotte.
async function pendingMatchSol(db) {
  const row = await db.prepare(
    "SELECT COALESCE(SUM(sol), 0) AS sol FROM burns WHERE kind = 'match' AND status IN ('queued', 'buying')",
  ).first();
  return row.sol;
}

// La cagnotte en SOL (ce qui sera racheté à la prochaine bougie), gardée 30 s en mémoire.
let potCache = null;
export async function potSol(env, now) {
  const wallet = await buybackWallet(env).catch(() => null);
  if (!wallet) return null;
  if (potCache && potCache.key === wallet.publicKey && now - potCache.at < 30_000) return potCache.sol;
  const lamports = await getBalance(env, wallet.publicKey).catch(() => null);
  if (lamports == null) return potCache?.sol ?? null;
  const pending = await pendingMatchSol(env.DB);
  const sol = Math.max(0, lamports / LAMPORTS - CONFIG.buyback.reserveSol - pending);
  potCache = { key: wallet.publicKey, at: now, sol };
  return sol;
}

// Le frais de lancement en lamports, et le wallet qui le reçoit (null : pas de frais).
// Il n'existe que quand le buyback tourne : avant le lancement de $WICK, ou en pause,
// lancer un coin ne coûte rien de plus.
export async function launchFee(env) {
  const sol = Number(env.LAUNCH_FEE_SOL ?? CONFIG.launchFeeSol);
  if (!Number.isFinite(sol) || sol <= 0 || !env.TOKEN_MINT) return null;
  const wallet = await buybackWallet(env).catch(() => null);
  if (!wallet || (await buybackPaused(env.DB))) return null;
  return { lamports: Math.round(sol * LAMPORTS), to: wallet.publicKey };
}

// Une transaction préparée par PumpPortal pour le wallet de buyback.
async function portalTx(body, priorityFee = CONFIG.buyback.priorityFeeSol) {
  const res = await fetch(CONFIG.pumpPortalUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ priorityFee, ...body }),
  });
  if (!res.ok) throw new Error(`pumpportal_${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function signAndSend(env, wallet, bytes) {
  const signed = await signTransaction(bytes, wallet);
  await sendTransaction(env, signed);
  return signatureOf(signed);
}

async function waitFor(env, signature, ms = CONFIG.buyback.confirmWaitMs) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const st = await signatureStatus(env, signature).catch(() => null);
    if (st) return st;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return null;
}

// Passe un burn d'un état à l'autre, seulement s'il est encore dans l'état attendu.
async function claim(db, id, from, to, fields = {}) {
  const sets = Object.keys(fields).map((k) => `${k} = ?`);
  const res = await db.prepare(
    `UPDATE burns SET status = ?${sets.map((s) => `, ${s}`).join('')} WHERE id = ? AND status = ?`,
  ).bind(to, ...Object.values(fields), id, from).run();
  return res.meta?.changes === 1;
}

const rawToUi = (raw, decimals) => Number(raw) / 10 ** (decimals ?? 6);

// Fait avancer le plus ancien burn en attente. Renvoie ce qui a été fait.
export async function runBuyback(env, now = Date.now()) {
  const db = env.DB;
  const row = await db.prepare(
    "SELECT * FROM burns WHERE status IN ('queued', 'buying', 'bought', 'burning_tx') ORDER BY id LIMIT 1",
  ).first();
  if (!row) return null;

  const wallet = await buybackWallet(env).catch((err) => { console.error('buyback key', err.message); return null; });
  const mint = env.TOKEN_MINT;
  if (row.status === 'queued' && (!wallet || !mint)) {
    await claim(db, row.id, 'queued', 'skipped', { note: 'not_live', step_at: now });
    return 'skipped:not_live';
  }
  if (!wallet || !mint) return null;
  const { buyback } = CONFIG;
  // En pause, rien n'est racheté. Les SOL restent dans le wallet : la prochaine bougie après
  // la reprise les rachètera avec la cagnotte.
  if (row.status === 'queued' && (await buybackPaused(db))) {
    await claim(db, row.id, 'queued', 'skipped', { note: 'paused', step_at: now });
    return 'skipped:paused';
  }

  if (row.status === 'queued') {
    let sol;
    let priority = buyback.priorityFeeSol;
    if (row.kind === 'candle') {
      // 1. Les creator fees de $WICK arrivent dans la cagnotte (s'il y en a).
      if (env.BUYBACK_COLLECT_FEES !== 'off') {
        try {
          const sig = await signAndSend(env, wallet, await portalTx({ publicKey: wallet.publicKey, action: 'collectCreatorFee', pool: 'pump' }));
          await waitFor(env, sig, 25_000);
        } catch (err) {
          console.log('collect fees', err.message);
        }
      }
      // 2. On rachète avec tout ce qui dépasse la réserve (sans les frais de lancement en attente).
      const lamports = await getBalance(env, wallet.publicKey);
      const pending = await pendingMatchSol(db);
      sol = Math.floor((lamports / LAMPORTS - buyback.reserveSol - pending) * 1e4) / 1e4;
    } else {
      // Un frais de lancement : on le rachète en entier, avec des frais réseau plus petits.
      sol = row.sol;
      priority = buyback.matchPriorityFeeSol;
    }
    if (!(sol >= buyback.minBuySol)) {
      await claim(db, row.id, 'queued', 'skipped', { note: 'empty_pot', step_at: now });
      return 'skipped:empty_pot';
    }
    if (!(await claim(db, row.id, 'queued', 'buying', { step_at: now, sol }))) return null;
    try {
      const before = await tokenHolding(env, wallet.publicKey, mint);
      const sig = await signAndSend(env, wallet, await portalTx({
        publicKey: wallet.publicKey, action: 'buy', mint, amount: sol,
        denominatedInSol: 'true', slippage: buyback.slippage, pool: 'auto',
      }, priority));
      await db.prepare('UPDATE burns SET buy_sig = ?, pre_raw = ? WHERE id = ?').bind(sig, String(before.raw), row.id).run();
      await waitFor(env, sig);
    } catch (err) {
      console.error('buy', err.message);
      await claim(db, row.id, 'buying', 'failed', { note: `buy: ${err.message}`.slice(0, 200), step_at: now });
      return 'failed:buy';
    }
    return runBuyback(env, Date.now());
  }

  if (row.status === 'buying') {
    const stuck = now - (row.step_at || 0) > buyback.stuckAfterMs;
    const st = row.buy_sig ? await signatureStatus(env, row.buy_sig) : null;
    if (st?.ok === false || (!st && stuck)) {
      await claim(db, row.id, 'buying', 'failed', { note: st ? 'buy_failed' : 'buy_dropped', step_at: now });
      return 'failed:buy';
    }
    if (!st) return 'waiting:buy';
    const after = await tokenHolding(env, wallet.publicKey, mint);
    const bought = after.raw - BigInt(row.pre_raw || '0');
    await claim(db, row.id, 'buying', 'bought', {
      step_at: now, bought_raw: String(bought > 0n ? bought : 0n), decimals: after.decimals,
      token_account: after.account, token_program: after.program,
    });
    return runBuyback(env, Date.now());
  }

  if (row.status === 'bought') {
    const amount = BigInt(row.bought_raw || '0');
    if (amount <= 0n || !row.token_account) {
      await claim(db, row.id, 'bought', 'burned', { step_at: now, burned_ui: 0, burned_at: now, note: 'nothing_bought' });
      return 'burned:0';
    }
    if (row.burn_tries >= buyback.maxBurnTries) {
      await claim(db, row.id, 'bought', 'failed', { note: 'burn_failed', step_at: now });
      return 'failed:burn';
    }
    if (!(await claim(db, row.id, 'bought', 'burning_tx', { step_at: now, burn_tries: row.burn_tries + 1 }))) return null;
    try {
      const tx = buildBurnTx({
        owner: wallet.publicKey, tokenAccount: row.token_account, mint, tokenProgram: row.token_program,
        amount, blockhash: await getLatestBlockhash(env),
      });
      const sig = await signAndSend(env, wallet, tx);
      await db.prepare('UPDATE burns SET burn_sig = ? WHERE id = ?').bind(sig, row.id).run();
      await waitFor(env, sig);
    } catch (err) {
      console.error('burn', err.message);
      await claim(db, row.id, 'burning_tx', 'bought', { note: `burn: ${err.message}`.slice(0, 200), burn_sig: null, step_at: now });
      return 'retry:burn';
    }
    return runBuyback(env, Date.now());
  }

  if (row.status === 'burning_tx') {
    const st = row.burn_sig ? await signatureStatus(env, row.burn_sig) : null;
    if (st?.ok) {
      await claim(db, row.id, 'burning_tx', 'burned', {
        step_at: now, burned_ui: rawToUi(row.bought_raw, row.decimals), burned_at: now, note: null,
      });
      return 'burned';
    }
    if (st?.ok === false || now - (row.step_at || 0) > buyback.stuckAfterMs) {
      // La transaction de burn n'est pas passée : on recommencera (le nombre d'essais est limité).
      await claim(db, row.id, 'burning_tx', 'bought', { burn_sig: null, step_at: now });
      return 'retry:burn';
    }
    return 'waiting:burn';
  }
  return null;
}
