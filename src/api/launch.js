// Frapper une allumette = lancer un coin sur pump.fun. Trois étapes :
//   POST /api/launch/prepare  (formulaire + image)  → la transaction à signer
//   POST /api/launch/submit   (transaction signée)  → envoyée sur Solana
//   GET  /api/launch/status?mint=…                  → allumée ou pas encore
import { CONFIG } from '../../lib/config.js';
import { ipHash, json } from '../../lib/http.js';
import { isPubkey, validateImage, validateLaunch } from '../../lib/launch.js';
import { getMatch, publicMatch, settle } from '../../lib/matches.js';
import { buildCreateTx, uploadMetadata } from '../../lib/pump.js';
import { ensureSchema } from '../../lib/schema.js';
import {
  base64FromBytes, bytesFromBase64, checkSignedLaunch, sendTransaction, signatureOf,
} from '../../lib/solana.js';

export async function prepare({ request, env }) {
  await ensureSchema(env.DB);
  const now = Date.now();
  let form;
  try { form = await request.formData(); } catch { return json({ error: 'bad_form' }, 400); }
  const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'));
  const { value: launch, error } = validateLaunch(fields);
  if (error) return json({ error }, 400);

  const ip = await ipHash(request, env);
  const existing = await getMatch(env.DB, launch.mint);
  if (existing && (existing.seq != null || existing.creator !== launch.creator)) {
    return json({ error: 'mint_taken' }, 409);
  }

  // Un nouvel essai avec le même mint (transaction expirée, wallet fermé…) :
  // les métadonnées sont déjà sur l'IPFS, on reconstruit juste la transaction.
  let meta = existing ? { uri: existing.uri, image: existing.image } : null;
  if (!meta) {
    if (!env.DEV_NO_IP_LIMIT) {
      const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM matches WHERE ip = ? AND created_at > ?')
        .bind(ip, now - 3600_000).first();
      if (n >= CONFIG.preparesPerIpPerHour) return json({ error: 'too_many' }, 429);
    }
    const image = form.get('image');
    const imageError = validateImage(image);
    if (imageError) return json({ error: imageError }, 400);
    try {
      meta = await uploadMetadata(launch, image);
    } catch (err) {
      console.error('ipfs', err.detail || err.message);
      return json({ error: 'ipfs_failed' }, 502);
    }
    await env.DB.prepare(
      `INSERT INTO matches (mint, creator, name, symbol, image, uri, dev_buy, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(launch.mint, launch.creator, launch.name, launch.symbol, meta.image, meta.uri, launch.devBuy, ip, now).run();
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
  return json({ tx: base64FromBytes(tx), image: meta.image });
}

export async function submit({ request, env }) {
  await ensureSchema(env.DB);
  const body = await request.json().catch(() => null);
  if (!isPubkey(body?.mint) || typeof body.tx !== 'string' || body.tx.length > 4000) {
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
