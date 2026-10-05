// Frapper une allumette = lancer un coin sur pump.fun. Trois étapes :
//   POST /api/launch/prepare  (formulaire + image)  → la transaction à signer
//   POST /api/launch/submit   (transaction signée)  → envoyée sur Solana
//   GET  /api/launch/status?mint=…                  → allumée ou pas encore
import { expectedFee, feeTransfers, launchFee, selfBpsOf } from '../../lib/buyback.js';
import { CONFIG } from '../../lib/config.js';
import { launchNeedSol, shortOfFunds } from '../../lib/funds.js';
import { ipHash, json } from '../../lib/http.js';
import { isPubkey, validateImage, validateLaunch } from '../../lib/launch.js';
import { getMatch, publicMatch, settle } from '../../lib/matches.js';
import { buildCreateTx, uploadMetadata } from '../../lib/pump.js';
import { ensureSchema } from '../../lib/schema.js';
import { buildShareTx, checkSignedShareTx } from '../../lib/sharing.js';
import { keeperGoal, keeperModel, keeperPrompt, keeperStyle } from '../../lib/keepers.js';
import { isPremium, premiumReady } from '../../lib/minds.js';
import {
  base64FromBytes, buildFeeTx, bytesFromBase64, checkFeeTx, checkSignedLaunch, getLatestBlockhash,
  sendTransaction, signatureOf,
} from '../../lib/solana.js';

// L'esprit choisi : un esprit premium seulement s'il est réglé (sa clé), sinon Llama.
function mindOf(env, id) {
  const mind = keeperModel(id);
  return mind && (!isPremium(mind) || premiumReady(env, mind)) ? mind.id : 'llama';
}

export async function prepare({ request, env }) {
  await ensureSchema(env.DB);
  const now = Date.now();
  let form;
  try { form = await request.formData(); } catch { return json({ error: 'bad_form' }, 400); }
  const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'));
  const { value: launch, error } = validateLaunch(fields);
  if (error) return json({ error }, 400);
  // Son caractère (« Custom » : écrit par le créateur, filtré), vérifié avant tout envoi.
  const style = keeperStyle(fields.keeper_style) || 'stoic';
  const character = style === 'custom' ? keeperPrompt(fields.keeper_prompt) : null;
  if (style === 'custom' && !character) return json({ error: 'bad_prompt' }, 400);

  const ip = await ipHash(request, env);
  const existing = await getMatch(env.DB, launch.mint);
  if (existing && (existing.seq != null || existing.creator !== launch.creator)) {
    return json({ error: 'mint_taken' }, 409);
  }

  // L'Ignition Fee (quand le buyback tourne) : une seconde transaction à signer, avec deux
  // virements (la part brûlée vers le wallet burn, la part de l'équipe vers son wallet). Avec le
  // partage des creator fees (au choix du créateur), elle est réduite et part dans la même
  // transaction que le partage (lib/sharing.js).
  // « Make it burn » (burn = la part en %, 10 à 50) : le partage avec, en plus, la part qui
  // rachète et brûle le coin lui-même.
  const selfBps = selfBpsOf(Math.round(Number(fields.burn) * 100));
  const shared = fields.share === '1' || selfBps > 0;
  const fee = (shared && (await launchFee(env, { shared: true, selfBps }))) || (await launchFee(env));

  // Le wallet doit pouvoir tout payer AVANT qu'on lui propose de signer (et avant d'envoyer
  // l'image sur l'IPFS) : l'achat du créateur, l'Ignition Fee, la création du coin.
  const short = await shortOfFunds(env, launch.creator, launchNeedSol(launch.devBuy, fee?.lamports ?? 0));
  if (short) return json({ error: 'no_funds', ...short }, 409);

  // Un nouvel essai avec le même mint (transaction expirée, wallet fermé…) :
  // les métadonnées sont déjà sur l'IPFS, on reconstruit juste la transaction.
  let meta = existing ? { uri: existing.uri, image: existing.image } : null;
  if (!meta) {
    if (!env.DEV_NO_IP_LIMIT) {
      const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM matches WHERE ip = ? AND created_at > ?')
        .bind(ip, now - 3600_000).first();
      if (n >= CONFIG.preparesPerIpPerHour) return json({ error: 'too_many' }, 429);
    }
    // Une limite pour tout le site : chaque préparation envoie l'image sur Pinata.
    const { n: all } = await env.DB.prepare('SELECT COUNT(*) AS n FROM matches WHERE created_at > ?').bind(now - 3600_000).first();
    if (all >= Number(env.UPLOADS_PER_HOUR || CONFIG.uploadsPerHour)) return json({ error: 'busy' }, 429);
    const image = form.get('image');
    const imageError = validateImage(image);
    if (imageError) return json({ error: imageError }, 400);
    try {
      meta = await uploadMetadata(env, launch, image);
    } catch (err) {
      console.error('ipfs', err.detail || err.message);
      return json({ error: err.message === 'ipfs_not_configured' ? 'ipfs_not_configured' : 'ipfs_failed' }, 502);
    }
    await env.DB.prepare(
      `INSERT INTO matches (mint, creator, name, symbol, image, uri, dev_buy, ip, created_at, twitter, telegram, website)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(launch.mint, launch.creator, launch.name, launch.symbol, meta.image, meta.uri, launch.devBuy, ip, now,
      launch.twitter || null, launch.telegram || null, launch.website || null).run();
  } else {
    await env.DB.prepare('UPDATE matches SET dev_buy = ? WHERE mint = ?').bind(launch.devBuy, launch.mint).run();
  }


  // Le nom et le ticker de la transaction sont ceux enregistrés avec les métadonnées.
  const row = existing || launch;
  let tx;
  try {
    tx = await buildCreateTx({ ...launch, name: row.name, symbol: row.symbol }, meta.uri);
  } catch (err) {
    console.error('pumpportal', err.detail || err.message);
    return json({ error: 'build_failed' }, 502);
  }
  let feeTx = null;
  const holders = fee?.holders || [];
  const shareBps = holders.reduce((n, h) => n + h.bps, 0);
  const shareTeamBps = holders.find((h) => h.address === fee?.teamWallet)?.bps ?? 0;
  if (fee) {
    try {
      const blockhash = await getLatestBlockhash(env);
      const transfers = feeTransfers(fee);
      const bytes = holders.length
        ? await buildShareTx({ creator: launch.creator, mint: launch.mint, transfers, holders, blockhash })
        : buildFeeTx({ from: launch.creator, transfers, blockhash });
      feeTx = base64FromBytes(bytes);
    } catch (err) {
      console.error('fee tx', err.message);
      return json({ error: 'build_failed' }, 502);
    }
  }
  // Un nouvel essai repart de zéro : une ancienne transaction de fee gardée ne partira jamais.
  await env.DB.prepare(`UPDATE matches SET fee_lamports = ?, fee_to = ?, team_to = ?, team_lamports = ?, share_bps = ?,
      share_team_bps = ?, share_crew_bps = ?, self_bps = ?, share_msg = NULL, share_tx = NULL, fee_sig = NULL, fee_state = NULL, share_state = NULL
      WHERE mint = ? AND seq IS NULL`)
    .bind(fee?.lamports ?? 0, fee?.to ?? null, fee?.teamWallet ?? null, fee?.team?.lamports ?? 0, shareBps, shareTeamBps, holders.length ? fee.crewBps || 0 : 0,
      holders.length ? fee.selfBps || 0 : 0, launch.mint).run();
  // Chaque coin a son Keeper : sa personnalité et son esprit (Stoic sur Llama si rien n'est choisi).
  // Avec « Make it burn », c'est lui qui choisit les moments de brûler.
  // Son caractère et son objectif (Deflation avec « Make it burn », sinon Survive, par défaut).
  const goal = keeperGoal(fields.keeper_goal) || (fee?.selfBps > 0 ? 'deflation' : 'survive');
  await env.DB.prepare('UPDATE matches SET keeper_style = ?, keeper_model = ?, keeper_goal = ?, keeper_prompt = ?, description = ? WHERE mint = ? AND seq IS NULL')
    .bind(style, mindOf(env, fields.keeper_model), goal, character, launch.description || null, launch.mint).run();
  return json({
    tx: base64FromBytes(tx),
    feeTx,
    feeSol: fee ? fee.lamports / 1e9 : 0,
    burnSol: fee ? fee.burn / 1e9 : 0,
    teamSol: fee?.team ? fee.team.lamports / 1e9 : 0,
    shareBps,
    selfBps: holders.length ? fee.selfBps || 0 : 0,
    image: meta.image,
  });
}

export async function submit({ request, env }) {
  await ensureSchema(env.DB);
  const body = await request.json().catch(() => null);
  if (!isPubkey(body?.mint) || typeof body.tx !== 'string' || body.tx.length > 4000
    || (body.feeTx != null && (typeof body.feeTx !== 'string' || body.feeTx.length > 2400))) {
    return json({ error: 'bad_request' }, 400);
  }
  const row = await getMatch(env.DB, body.mint);
  if (!row) return json({ error: 'unknown_mint' }, 404);
  if (row.seq != null) return json({ status: 'lit', match: publicMatch(row) });

  let bytes;
  try { bytes = bytesFromBase64(body.tx); } catch { return json({ error: 'bad_tx' }, 400); }
  // On ne relaie que la création de CE coin, payée et signée par SON créateur.
  const problem = checkSignedLaunch(bytes, row);
  if (problem) return json({ error: problem }, 400);

  // L'Ignition Fee, s'il y en a une : un virement signé du créateur vers le wallet de buyback, ou,
  // avec le partage, exactement la transaction préparée (fee + partage), signée par le créateur.
  let feeBytes = null;
  if (row.fee_lamports > 0 || row.share_bps > 0) {
    try { feeBytes = body.feeTx ? bytesFromBase64(body.feeTx) : null; } catch { feeBytes = null; }
    let feeProblem = 'no_fee_tx';
    const { transfers, holders } = expectedFee(row);
    if (feeBytes && row.share_bps > 0) feeProblem = checkSignedShareTx(feeBytes, { creator: row.creator, mint: row.mint, transfers, holders });
    else if (feeBytes) feeProblem = checkFeeTx(feeBytes, { from: row.creator, transfers });
    if (feeProblem) return json({ error: feeProblem }, 400);
  }

  const signature = signatureOf(bytes);
  try {
    await sendTransaction(env, bytes);
  } catch (err) {
    const msg = `${err.message} ${JSON.stringify(err.rpc?.data?.logs || '')}`;
    console.error('send', row.mint, msg);
    if (/blockhash/i.test(msg)) return json({ error: 'expired' }, 409);
    if (/insufficient|lamports|0x1\b/i.test(msg)) return json({ error: 'no_funds' }, 409);
    return json({ error: 'send_failed' }, 502);
  }
  await env.DB.prepare('UPDATE matches SET signature = ?, sent_at = ? WHERE mint = ? AND seq IS NULL')
    .bind(signature, Date.now(), row.mint).run();

  // L'Ignition Fee (et le partage) attend que le lancement soit confirmé : elle part à la
  // confirmation (releaseHeld dans lib/matches.js). Un lancement raté ne coûte donc pas de fee.
  // (Le partage a besoin, en plus, que le coin existe.)
  if (feeBytes) {
    await env.DB.prepare(`UPDATE matches SET share_tx = ?, fee_sig = ?, fee_state = 'held',
        share_state = CASE WHEN share_bps > 0 THEN 'held' ELSE share_state END WHERE mint = ?`)
      .bind(body.feeTx, signatureOf(feeBytes), row.mint).run();
  }
  return json({ status: 'pending', signature });
}

export async function status({ request, env }) {
  await ensureSchema(env.DB);
  const mint = new URL(request.url).searchParams.get('mint');
  if (!isPubkey(mint)) return json({ error: 'bad_request' }, 400);
  const row = await getMatch(env.DB, mint);
  if (!row) return json({ error: 'unknown_mint' }, 404);
  const result = await settle(env, row, Date.now()).catch((err) => {
    console.error('status', mint, err.message);
    return { row, status: 'pending' };
  });
  return json({
    status: result.status,
    signature: row.signature,
    match: result.status === 'lit' ? publicMatch(result.row) : null,
  });
}
