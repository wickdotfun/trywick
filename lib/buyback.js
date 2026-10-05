// Les burns de $WICK. Ils tournent dans le cron, depuis une file (table burns), une étape à
// la fois, le plus ancien d'abord :
//
//   queued  → achat de $WICK → buying
//   buying  → l'achat est confirmé : on note combien de $WICK il a rapporté → bought
//   bought  → on brûle exactement ce qui vient d'être acheté → burning_tx → burned
//
// Deux sortes de burns :
// - 'candle' : une bougie (un souffle) s'est éteinte. On rachète avec la cagnotte : le solde SOL
//   du wallet burn (la part burn des fees partagées par les coins WICK), moins une réserve pour
//   les frais, moins les Ignition Fees pas encore brûlées (elles ont leur propre burn) ;
// - 'match' : quelqu'un a lancé un coin et payé l'Ignition Fee : sa part burn (la moitié) est
//   rachetée en $WICK et brûlée, dans la minute. L'autre moitié est allée directement à l'équipe.
// Ce wallet (le « wallet burn ») ne sert qu'à ça : sa clé (BUYBACK_SECRET_KEY) est un secret
// Cloudflare. Les creator fees de $WICK ne passent pas par lui : elles vont au dev wallet.
// Seuls les jetons rachetés par le cycle sont brûlés, jamais le reste du wallet.
//
// Chaque étape est « réclamée » par une écriture atomique (status = … WHERE status = …) :
// deux crons qui se chevauchent ne rachètent jamais deux fois.
//
// En pause (page d'admin), aucun nouvel achat ne part : la bougie est notée « paused » et la
// cagnotte attend. Un achat déjà parti va quand même jusqu'au burn, pour ne jamais laisser
// des $WICK rachetés sans les brûler.
import { onBurned, onFed } from './operator.js';
import { trackBurn } from './track.js';
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
  const wallet = walletCache?.secret === env.BUYBACK_SECRET_KEY ? walletCache.wallet : await loadWallet(env);
  // Garde-fou : jamais la clé du dev wallet (ses SOL et ses creator fees n'appartiennent qu'à
  // lui), et seulement celle du wallet burn prévu.
  const expected = env.BURN_WALLET ?? CONFIG.buyback.wallet;
  if (wallet.publicKey === (env.DEPLOYER_WALLET || CONFIG.launch.deployer)) throw new Error('dev_wallet_key');
  if (expected && wallet.publicKey !== expected) throw new Error('wrong_burn_wallet');
  return wallet;
}

async function loadWallet(env) {
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

// Les SOL qui ne font pas partie de la cagnotte de $WICK : les frais de lancement pas encore
// rachetés, et ceux des coins qui se brûlent eux-mêmes (en file, ou encore mis de côté).
async function pendingMatchSol(db) {
  const [queued, aside] = await Promise.all([
    db.prepare("SELECT COALESCE(SUM(sol), 0) AS sol FROM burns WHERE kind IN ('match', 'coin') AND status IN ('queued', 'buying')").first(),
    db.prepare('SELECT COALESCE(SUM(self_pending), 0) AS l FROM matches WHERE self_pending > 0').first(),
  ]);
  return queued.sol + aside.l / LAMPORTS;
}

// Le coin qu'un burn rachète : $WICK, ou, pour « Make it burn », le coin lui-même.
export const burnTarget = (row, env) => (row.kind === 'coin' ? String(row.ref).split(':')[0] : env.TOKEN_MINT);

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

// L'Ignition Fee d'un lancement (null : pas de frais). Elle n'existe que quand le buyback tourne :
// avant le lancement de $WICK, ou en pause, lancer un coin ne coûte rien de plus.
// Renvoie { lamports (le total), to (le wallet burn), burn, team: { to, lamports } | null,
//           holders (avec partage : les parts de WICK dans les creator fees du coin) }.
//
// shared : le créateur partage ses creator fees (lib/sharing.js). L'Ignition Fee est alors
// réduite, et ses creator fees vont pour toujours à lui, au burn et à l'équipe.
export async function launchFee(env, { shared = false, selfBps = 0 } = {}) {
  if (!env.TOKEN_MINT) return null;
  const sol = Number(shared ? (env.LAUNCH_FEE_SHARED_SOL ?? CONFIG.sharing.launchFeeSol) : (env.LAUNCH_FEE_SOL ?? CONFIG.launchFeeSol));
  if (!Number.isFinite(sol) || sol < 0 || (!shared && sol === 0)) return null;
  const wallet = await buybackWallet(env).catch(() => null);
  if (!wallet || (await buybackPaused(env.DB))) return null;
  const team = teamWallet(env, wallet.publicKey);
  const lamports = Math.round(sol * LAMPORTS);
  const teamLamports = team ? Math.floor((lamports * bpsOf(env.TEAM_FEE_BPS, CONFIG.team.feeBps)) / 10_000) : 0;
  const fee = {
    lamports,
    to: wallet.publicKey,
    burn: lamports - teamLamports,
    team: teamLamports > 0 ? { to: team, lamports: teamLamports } : null,
    teamWallet: team,
  };
  if (!shared) return fee;
  const holders = wickHolders(env, wallet.publicKey, team, selfBpsOf(selfBps));
  return holders.length ? { ...fee, holders, selfBps: selfBpsOf(selfBps) } : null;
}

// Ce que le site affiche des frais : l'Ignition Fee (part burn / part équipe), et, avec le
// partage, l'Ignition Fee réduite et la répartition des creator fees du coin.
export async function feeSummary(env) {
  const [fee, shared] = await Promise.all([launchFee(env), launchFee(env, { shared: true })]);
  const sol = (l) => (l || 0) / LAMPORTS;
  const bpsOfHolder = (address) => shared?.holders.find((h) => h.address === address)?.bps ?? 0;
  return {
    feeSol: sol(fee?.lamports),
    burnSol: sol(fee?.burn),
    teamSol: sol(fee?.team?.lamports),
    sharedFeeSol: shared ? sol(shared.lamports) : null,
    sharedBurnSol: shared ? sol(shared.burn) : null,
    sharedTeamSol: shared ? sol(shared.team?.lamports) : null,
    // La part de WICK dans les creator fees d'un coin qui partage (en points de base).
    shareBps: shared ? shared.holders.reduce((n, h) => n + h.bps, 0) : 0,
    split: shared ? {
      creatorBps: 10_000 - shared.holders.reduce((n, h) => n + h.bps, 0),
      burnBps: bpsOfHolder(shared.to),
      teamBps: shared.teamWallet ? bpsOfHolder(shared.teamWallet) : 0,
    } : null,
    teamWallet: (fee || shared)?.teamWallet ?? null,
    // « Make it burn » : les parts (points de base) que le créateur peut choisir.
    selfOptions: shared ? CONFIG.selfBurn.options : [],
  };
}

// Un pourcentage en points de base (0 à 10 000).
function bpsOf(value, fallback) {
  const n = Number(value ?? fallback);
  return Number.isInteger(n) && n >= 0 && n <= 10_000 ? n : fallback;
}

// Le wallet de l'équipe (TEAM_WALLET, sinon le dev wallet). null s'il n'y en a pas, ou si c'est
// le wallet burn lui-même (tout part alors au burn).
export function teamWallet(env, burnWallet) {
  const w = env.TEAM_WALLET || env.DEPLOYER_WALLET || CONFIG.launch.deployer || null;
  return w && w !== burnWallet ? w : null;
}

// La part « Make it burn » choisie par le créateur (points de base), si elle est permise.
export function selfBpsOf(value) {
  const n = Number(value);
  return CONFIG.selfBurn.options.includes(n) ? n : 0;
}

// Les parts de WICK dans les creator fees d'un coin qui partage : le burn, puis l'équipe.
// Avec « Make it burn », le wallet burn reçoit aussi la part qui rachète le coin lui-même
// (selfBps) : une seule adresse pour les deux, la répartition est faite à la réception.
export function wickHolders(env, burnWallet, team, selfBps = 0) {
  const burn = bpsOf(env.SHARE_BURN_BPS, CONFIG.sharing.burnBps) + selfBps;
  const teamBps = team ? bpsOf(env.SHARE_TEAM_BPS, CONFIG.sharing.teamBps) : 0;
  if (burn + teamBps >= 10_000) return [];
  return [
    ...(burn > 0 ? [{ address: burnWallet, bps: burn }] : []),
    ...(teamBps > 0 ? [{ address: team, bps: teamBps }] : []),
  ];
}

// Les virements de l'Ignition Fee : la part burn, puis la part de l'équipe.
export function feeTransfers(fee) {
  return [
    ...(fee.burn > 0 ? [{ to: fee.to, lamports: fee.burn }] : []),
    ...(fee.team ? [{ to: fee.team.to, lamports: fee.team.lamports }] : []),
  ];
}

// Ce qu'un lancement enregistré doit payer et partager (pour vérifier ce que le wallet a signé).
export function expectedFee(row) {
  const burn = row.fee_lamports - (row.team_lamports || 0);
  const transfers = [
    ...(burn > 0 ? [{ to: row.fee_to, lamports: burn }] : []),
    ...(row.team_lamports > 0 ? [{ to: row.team_to, lamports: row.team_lamports }] : []),
  ];
  const burnBps = (row.share_bps || 0) - (row.share_team_bps || 0);
  const holders = [
    ...(burnBps > 0 ? [{ address: row.fee_to, bps: burnBps }] : []),
    ...(row.share_team_bps > 0 ? [{ address: row.team_to, bps: row.share_team_bps }] : []),
  ];
  return { transfers, holders };
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

// Un rachat raté pour un coin qui se brûle lui-même : ses SOL lui reviennent (ils repartiront
// avec la prochaine distribution), au lieu de rejoindre la cagnotte de $WICK.
async function refundSelf(db, row) {
  if (row.kind !== 'coin') return;
  const lamports = Math.round((row.sol || 0) * LAMPORTS + CONFIG.selfBurn.keepSol * LAMPORTS);
  await db.prepare('UPDATE matches SET self_pending = self_pending + ? WHERE mint = ?').bind(lamports, String(row.ref).split(':')[0]).run();
}

// Fait avancer le plus ancien burn en attente. Renvoie ce qui a été fait.
export async function runBuyback(env, now = Date.now()) {
  const db = env.DB;
  const row = await db.prepare(
    "SELECT * FROM burns WHERE status IN ('queued', 'buying', 'bought', 'burning_tx') ORDER BY id LIMIT 1",
  ).first();
  if (!row) return null;

  const wallet = await buybackWallet(env).catch((err) => { console.error('buyback key', err.message); return null; });
  const mint = burnTarget(row, env);
  if (row.status === 'queued' && (!wallet || !mint)) {
    await claim(db, row.id, 'queued', 'skipped', { note: 'not_live', step_at: now });
    return 'skipped:not_live';
  }
  if (!wallet || !mint) return null;
  const { buyback } = CONFIG;
  // En pause, rien n'est racheté. Les SOL restent dans le wallet : la prochaine bougie après
  // la reprise les rachètera avec la cagnotte.
  if (row.status === 'queued' && (await buybackPaused(db))) {
    if (row.kind === 'coin') return 'waiting:paused';   // les SOL d'un coin restent à lui : on attend la reprise
    await claim(db, row.id, 'queued', 'skipped', { note: 'paused', step_at: now });
    return 'skipped:paused';
  }

  if (row.status === 'queued') {
    let sol;
    let priority = buyback.priorityFeeSol;
    if (row.kind === 'candle') {
      // 1. Les creator fees de $WICK vont au dev wallet, pas au burn. (BUYBACK_COLLECT_FEES=on
      //    seulement si le wallet burn est aussi le créateur de $WICK et qu'on veut les brûler.)
      if (env.BUYBACK_COLLECT_FEES === 'on') {
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
      // Un frais de lancement, ou les fees d'un coin qui se brûle lui-même : on les rachète en
      // entier, avec des frais réseau plus petits.
      sol = row.sol;
      priority = buyback.matchPriorityFeeSol;
    }
    if (!(sol >= (row.kind === 'candle' ? buyback.minBuySol : buyback.matchMinBuySol))) {
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
      if (await claim(db, row.id, 'buying', 'failed', { note: `buy: ${err.message}`.slice(0, 200), step_at: now })) await refundSelf(db, row);
      return 'failed:buy';
    }
    return runBuyback(env, Date.now());
  }

  if (row.status === 'buying') {
    const stuck = now - (row.step_at || 0) > buyback.stuckAfterMs;
    const st = row.buy_sig ? await signatureStatus(env, row.buy_sig) : null;
    if (st?.ok === false || (!st && stuck)) {
      if (await claim(db, row.id, 'buying', 'failed', { note: st ? 'buy_failed' : 'buy_dropped', step_at: now })) await refundSelf(db, row);
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
      const burned = rawToUi(row.bought_raw, row.decimals);
      const done = await claim(db, row.id, 'burning_tx', 'burned', { step_at: now, burned_ui: burned, burned_at: now, note: null });
      // La bougie du coin fond : ce qu'il a brûlé de lui-même, et les SOL que ça a coûté.
      if (done && row.kind === 'coin') {
        await db.prepare('UPDATE matches SET self_burned = self_burned + ?, self_sol = self_sol + ?, self_burns = self_burns + 1 WHERE mint = ?')
          .bind(burned, row.sol || 0, mint).run();
      }
      // Le journal de l'Operator du coin : son burn, ou le $WICK que son lancement a brûlé.
      if (done && (row.kind === 'coin' || row.kind === 'match')) {
        const coinMint = row.kind === 'coin' ? mint : row.ref;
        const m = await db.prepare('SELECT symbol FROM matches WHERE mint = ?').bind(coinMint).first();
        if (m) {
          await (row.kind === 'coin'
            ? onBurned(db, coinMint, m.symbol, { burned, sol: row.sol, sig: row.burn_sig, voice: row.voice }, now)
            : onFed(db, coinMint, { burned, sig: row.burn_sig, ticker: env.TOKEN_TICKER || 'WICK' }, now)).catch((err) => console.error('operator log', err.message));
        }
        // Un palier de la supply brûlée ? (noté après le burn lui-même)
        if (m && row.kind === 'coin') await trackBurn(db, coinMint, now).catch((err) => console.error('track', err.message));
      }
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
