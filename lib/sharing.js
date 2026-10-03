// Le partage des creator fees (pump.fun « fee sharing »), au choix du créateur au lancement.
//
// Sur pump.fun, chaque achat ou vente d'un coin verse une petite commission à son créateur (les
// creator fees). Un créateur peut, une seule fois et pour toujours, les répartir entre plusieurs
// wallets. Avec WICK, s'il le choisit au lancement :
// - son Ignition Fee est réduite (0,01 SOL au lieu de 0,02) ;
// - ses creator fees sont réparties 90 % pour lui, 10 % pour WICK, verrouillé on-chain ;
// - WICK rachète du $WICK avec sa part et le brûle (au prochain buyback).
//
// Au lancement, le créateur signe d'un coup trois choses : la création du coin, et une seconde
// transaction qui contient l'Ignition Fee + l'activation du partage (create_fee_sharing_config)
// + la répartition finale (update_fee_shares_v2, qui verrouille). Cette seconde transaction ne
// peut passer qu'une fois le coin créé : le serveur la garde et l'envoie dès la confirmation.
// Elle est atomique : sans partage, pas d'Ignition Fee prélevée non plus.
//
// Ensuite, la distribution est publique (n'importe qui peut la déclencher) : le cron la lance
// de temps en temps pour chaque coin qui a accumulé assez de fees (distribute_creator_fees_v2,
// après avoir ramené les fees PumpSwap des coins gradués avec transfer_creator_fees_to_pump_v2).
// La part de WICK arrive dans le wallet de buyback, et brûle au buyback suivant.
//
// Le pourcentage de WICK se règle avec SHARE_BPS (voir lib/buyback.js, shareBps).
//
// Les comptes et les instructions suivent l'IDL et le SDK officiels (@pump-fun/pump-sdk) ;
// test/sharing.test.js vérifie qu'on produit exactement les mêmes instructions.
import { buybackWallet } from './buyback.js';
import { CONFIG } from './config.js';
import {
  ATA_PROGRAM, TOKEN_PROGRAM, WSOL, ataAddress, base58, buildLegacyTx, bytesFromBase64, findPda, fromBase58,
  getLatestBlockhash, getTransaction, readTransaction, rpc, sendTransaction, signTransaction, signatureOf, signatureStatus,
} from './solana.js';

export const PUMP = CONFIG.pumpProgram;
export const PUMP_AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const PUMP_FEES = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
const SYSTEM = '11111111111111111111111111111111';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';

const DISC = {
  createFeeSharingConfig: [195, 78, 86, 76, 111, 52, 251, 213],
  updateFeeSharesV2: [111, 251, 49, 6, 78, 78, 106, 18],
  distributeCreatorFeesV2: [255, 203, 19, 79, 244, 68, 8, 159],
  transferCreatorFeesToPumpV2: [1, 33, 78, 185, 33, 67, 44, 92],
};
const SHARING_CONFIG_DISC = [216, 74, 9, 0, 56, 140, 93, 75];

const k = fromBase58;
const w = (pubkey) => ({ pubkey, isSigner: false, isWritable: true });
const r = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });

// Toutes les adresses dérivées d'un coin, utiles au partage.
export async function sharingAccounts(mint) {
  const sharingConfig = await findPda(['sharing-config', k(mint)], PUMP_FEES);
  const [feesEvent, global, bondingCurve, pumpEvent, ammEvent, pumpCreatorVault, coinCreatorVaultAuthority] = await Promise.all([
    findPda(['__event_authority'], PUMP_FEES),
    findPda(['global'], PUMP),
    findPda(['bonding-curve', k(mint)], PUMP),
    findPda(['__event_authority'], PUMP),
    findPda(['__event_authority'], PUMP_AMM),
    findPda(['creator-vault', k(sharingConfig)], PUMP),
    findPda(['creator_vault', k(sharingConfig)], PUMP_AMM),
  ]);
  const [pumpCreatorVaultAta, coinCreatorVaultAta] = await Promise.all([
    ataAddress(pumpCreatorVault, WSOL),
    ataAddress(coinCreatorVaultAuthority, WSOL),
  ]);
  return {
    mint, sharingConfig, feesEvent, global, bondingCurve, pumpEvent, ammEvent,
    pumpCreatorVault, pumpCreatorVaultAta, coinCreatorVaultAuthority, coinCreatorVaultAta,
  };
}

// create_fee_sharing_config : le créateur active le partage (pas encore gradué : sans pool ; le
// compte absent est remplacé par l'adresse du programme, convention Anchor, comme le fait le SDK).
export function createConfigIx(a, creator) {
  return {
    programId: PUMP_FEES,
    keys: [
      r(a.feesEvent), r(PUMP_FEES), { pubkey: creator, isSigner: true, isWritable: true }, r(a.global), r(a.mint),
      w(a.sharingConfig), r(SYSTEM), w(a.bondingCurve), r(PUMP), r(a.pumpEvent),
      r(PUMP_FEES), r(PUMP_AMM), r(a.ammEvent),
    ],
    data: Uint8Array.from(DISC.createFeeSharingConfig),
  };
}

// update_fee_shares_v2 : la répartition finale, verrouillée pour toujours.
export function updateSharesIx(a, creator, shareholders, current = [creator]) {
  const data = new Uint8Array(8 + 4 + shareholders.length * 34);
  data.set(DISC.updateFeeSharesV2, 0);
  const view = new DataView(data.buffer);
  view.setUint32(8, shareholders.length, true);
  shareholders.forEach((s, i) => {
    data.set(k(s.address), 12 + i * 34);
    view.setUint16(12 + i * 34 + 32, s.bps, true);
  });
  return {
    programId: PUMP_FEES,
    keys: [
      r(a.feesEvent), r(PUMP_FEES), { pubkey: creator, isSigner: true, isWritable: true }, r(a.global), r(a.mint),
      w(a.sharingConfig), r(a.bondingCurve), w(a.pumpCreatorVault), w(a.pumpCreatorVaultAta), r(SYSTEM),
      r(PUMP), r(a.pumpEvent), r(PUMP_AMM), r(a.ammEvent), r(WSOL), r(TOKEN_PROGRAM), r(ATA_PROGRAM),
      w(a.coinCreatorVaultAuthority), w(a.coinCreatorVaultAta),
      ...current.map(w),
    ],
    data,
  };
}

// distribute_creator_fees_v2 : verse les fees accumulées à chaque bénéficiaire. Public.
export function distributeIx(a, payer, shareholders) {
  return {
    programId: PUMP,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true }, r(a.mint), r(a.bondingCurve), r(a.sharingConfig),
      w(a.pumpCreatorVault), r(SYSTEM), r(a.pumpEvent), r(PUMP), w(a.pumpCreatorVaultAta), r(WSOL),
      r(TOKEN_PROGRAM), r(ATA_PROGRAM),
      ...shareholders.map(w),
    ],
    data: Uint8Array.from([...DISC.distributeCreatorFeesV2, 1]),   // initialize_ata (sans effet pour les coins en SOL)
  };
}

// transfer_creator_fees_to_pump_v2 : pour un coin gradué, ramène ses fees PumpSwap. Public.
export function sweepAmmIx(a, payer) {
  return {
    programId: PUMP_AMM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true }, r(WSOL), r(TOKEN_PROGRAM), r(SYSTEM), r(ATA_PROGRAM),
      r(a.sharingConfig), w(a.coinCreatorVaultAuthority), w(a.coinCreatorVaultAta), w(a.pumpCreatorVault),
      w(a.pumpCreatorVaultAta), r(a.ammEvent), r(PUMP_AMM),
    ],
    data: Uint8Array.from(DISC.transferCreatorFeesToPumpV2),
  };
}

function computeIxs(units, microLamports) {
  const limit = new Uint8Array(5);
  limit[0] = 2;
  new DataView(limit.buffer).setUint32(1, units, true);
  const price = new Uint8Array(9);
  price[0] = 3;
  new DataView(price.buffer).setBigUint64(1, BigInt(microLamports), true);
  return [{ programId: COMPUTE_BUDGET, keys: [], data: limit }, { programId: COMPUTE_BUDGET, keys: [], data: price }];
}

function transferIx(from, to, lamports) {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, BigInt(lamports), true);
  return { programId: SYSTEM, keys: [{ pubkey: from, isSigner: true, isWritable: true }, w(to)], data };
}

// Les bénéficiaires : le créateur et WICK (créateur d'abord), en points de base (10 000 = 100 %).
export function shareholdersFor(creator, wick, wickBps) {
  return [{ address: creator, bps: 10_000 - wickBps }, { address: wick, bps: wickBps }];
}

// La transaction du lancement avec partage : l'Ignition Fee, puis le partage, verrouillé.
// Payée et signée par le créateur. Non signée.
export async function buildShareTx({ creator, mint, wick, wickBps, feeLamports, blockhash }) {
  const a = await sharingAccounts(mint);
  return buildLegacyTx({
    payer: creator,
    blockhash,
    instructions: [
      ...computeIxs(CONFIG.sharing.computeUnits, CONFIG.sharing.microLamports),
      transferIx(creator, wick, feeLamports),
      createConfigIx(a, creator),
      updateSharesIx(a, creator, shareholdersFor(creator, wick, wickBps)),
    ],
  });
}

// La transaction signée renvoyée par le navigateur doit être exactement celle préparée (même
// message), signée par le créateur. Renvoie null si tout va bien, sinon le problème.
export function checkSignedShareTx(bytes, preparedMessage) {
  let tx;
  try { tx = readTransaction(bytes); } catch { return 'bad_share_tx'; }
  const message = bytes.subarray(tx.messageOffset);
  if (message.length !== preparedMessage.length || message.some((b, i) => b !== preparedMessage[i])) return 'bad_share_tx';
  if (tx.signatures.length !== 1 || tx.signatures[0].every((b) => b === 0)) return 'unsigned';
  return null;
}

// Le compte sharing_config : l'état du partage (actif, verrouillé) et ses bénéficiaires.
export function readSharingConfig(bytes) {
  if (!bytes || bytes.length < 8 + 3 + 64 + 1 + 4 || SHARING_CONFIG_DISC.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8 + 2;
  const status = bytes[at] === 1 ? 'active' : 'paused';
  at += 1;
  const mint = base58(bytes.subarray(at, at + 32)); at += 32;
  const admin = base58(bytes.subarray(at, at + 32)); at += 32;
  const locked = bytes[at] === 1; at += 1;
  const n = view.getUint32(at, true); at += 4;
  const shareholders = [];
  for (let i = 0; i < n && at + 34 <= bytes.length; i++, at += 34) {
    shareholders.push({ address: base58(bytes.subarray(at, at + 32)), bps: view.getUint16(at + 32, true) });
  }
  return { status, mint, admin, locked, shareholders };
}

// La transaction (du cron, payée par le wallet de buyback) qui distribue les fees d'un coin.
export async function buildDistributeTx({ mint, payer, shareholders, graduated, blockhash }) {
  const a = await sharingAccounts(mint);
  return buildLegacyTx({
    payer,
    blockhash,
    instructions: [
      ...computeIxs(CONFIG.sharing.computeUnits, CONFIG.sharing.microLamports),
      ...(graduated ? [sweepAmmIx(a, payer)] : []),
      distributeIx(a, payer, shareholders),
    ],
  });
}

// ------------------------------------------------------------ le cron : distribuer
const RENT_EXEMPT_EMPTY = 890_880;   // ce qui reste dans le coffre (compte vide exempté de loyer)

async function accountBytes(env, address) {
  const res = await rpc(env, 'getAccountInfo', [address, { encoding: 'base64', commitment: 'confirmed' }]);
  return res?.value ? bytesFromBase64(res.value.data[0]) : null;
}

// À chaque cron : on note les distributions confirmées (la part reçue par WICK, lue dans la
// transaction), puis on distribue les fees de quelques coins qui en ont accumulé assez.
// Renvoie le nombre de distributions envoyées.
export async function runShares(env, now) {
  const wallet = await buybackWallet(env).catch(() => null);
  if (!wallet || !env.TOKEN_MINT) return 0;
  const db = env.DB;
  const { results: sent } = await db.prepare("SELECT * FROM shares WHERE status = 'sent' ORDER BY id LIMIT 10").all();
  for (const row of sent) {
    const st = await signatureStatus(env, row.sig).catch(() => null);
    if (!st) {
      if (now - row.at > 5 * 60_000) await db.prepare("UPDATE shares SET status = 'failed' WHERE id = ?").bind(row.id).run();
      continue;
    }
    let wick = null;
    if (st.ok) {
      const tx = await getTransaction(env, row.sig).catch(() => null);
      const keys = (tx?.transaction?.message?.accountKeys || []).map((x) => (typeof x === 'string' ? x : x.pubkey));
      const i = keys.indexOf(wallet.publicKey);
      // WICK paie la transaction : sa part = ce qu'il a reçu + les frais qu'il a payés.
      if (i >= 0 && tx.meta) wick = tx.meta.postBalances[i] - tx.meta.preBalances[i] + (i === 0 ? tx.meta.fee : 0);
    }
    await db.prepare('UPDATE shares SET status = ?, wick_lamports = ? WHERE id = ?').bind(st.ok ? 'ok' : 'failed', wick, row.id).run();
  }

  const { sharing } = CONFIG;
  const { results } = await db.prepare(
    `SELECT mint FROM matches WHERE share_state = 'shared' AND share_dist_at < ?
     ORDER BY share_dist_at ASC LIMIT ?`,
  ).bind(now - sharing.distributeEveryMs, sharing.perRun).all();
  let count = 0;
  for (const { mint } of results) {
    await db.prepare('UPDATE matches SET share_dist_at = ? WHERE mint = ?').bind(now, mint).run();
    try {
      const a = await sharingAccounts(mint);
      const [cfgBytes, curve, vault] = await Promise.all([
        accountBytes(env, a.sharingConfig),
        accountBytes(env, a.bondingCurve),
        rpc(env, 'getBalance', [a.pumpCreatorVault, { commitment: 'confirmed' }]).then((x) => x.value),
      ]);
      const cfg = readSharingConfig(cfgBytes);
      if (!cfg || cfg.status !== 'active' || !cfg.shareholders.some((h) => h.address === wallet.publicKey)) continue;
      const graduated = Boolean(curve && curve[8 + 40] === 1);
      let amm = 0;
      if (graduated) {
        const bal = await rpc(env, 'getTokenAccountBalance', [a.coinCreatorVaultAta, { commitment: 'confirmed' }]).catch(() => null);
        amm = Number(bal?.value?.amount ?? 0);
      }
      const pending = Math.max(0, vault - RENT_EXEMPT_EMPTY) + amm;
      if (pending < sharing.distributeMinSol * 1e9) continue;
      const bytes = await buildDistributeTx({
        mint, payer: wallet.publicKey, shareholders: cfg.shareholders.map((h) => h.address),
        graduated: amm > 0, blockhash: await getLatestBlockhash(env),
      });
      const signed = await signTransaction(bytes, wallet);
      await sendTransaction(env, signed);
      await db.prepare('INSERT INTO shares (mint, at, sig, total_lamports) VALUES (?, ?, ?, ?)')
        .bind(mint, now, signatureOf(signed), pending).run();
      count++;
    } catch (err) {
      console.error('share distribute', mint, err.message);
    }
  }
  return count;
}

// Les creator fees partagées reçues par WICK (distributions confirmées), et les coins qui partagent.
export async function shareTotals(db) {
  const [row, coins] = await Promise.all([
    db.prepare("SELECT COALESCE(SUM(wick_lamports), 0) AS l FROM shares WHERE status = 'ok'").first(),
    db.prepare("SELECT COUNT(*) AS n FROM matches WHERE share_state = 'shared'").first(),
  ]);
  return { sharedSol: row.l / 1e9, sharingCoins: coins.n };
}
