// Le strict minimum de Solana côté serveur, sans bibliothèque : base58, lecture d'une
// transaction signée, vérification d'une transaction confirmée, appel RPC.
import { CONFIG } from './config.js';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  return '1'.repeat(zeros) + digits.reverse().map((d) => ALPHABET[d]).join('');
}

export function fromBase58(text) {
  const bytes = [0];
  for (const ch of text) {
    let carry = ALPHABET.indexOf(ch);
    if (carry < 0) throw new Error('bad_base58');
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  let zeros = 0;
  while (zeros < text.length && text[zeros] === '1') zeros++;
  const body = bytes.reverse();
  while (body.length > 1 && body[0] === 0) body.shift();
  const out = new Uint8Array(zeros + (text.length > zeros ? body.length : 0));
  if (text.length > zeros) out.set(body, zeros);
  return out;
}

export function bytesFromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64FromBytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Les entiers « compact-u16 » du format de transaction Solana.
function compactBytes(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
}

function compactU16(bytes, at) {
  let value = 0;
  for (let i = 0; i < 3; i++) {
    const b = bytes[at + i];
    if (b === undefined) throw new Error('truncated');
    value |= (b & 0x7f) << (7 * i);
    if (!(b & 0x80)) return [value, at + i + 1];
  }
  throw new Error('bad_compact_u16');
}

// Lit une transaction sérialisée (legacy ou v0) : signatures, en-tête, comptes statiques.
export function readTransaction(bytes) {
  let [nsig, at] = compactU16(bytes, 0);
  const signatures = [];
  const sigOffset = at;
  for (let i = 0; i < nsig; i++, at += 64) {
    if (at + 64 > bytes.length) throw new Error('truncated');
    signatures.push(bytes.subarray(at, at + 64));
  }
  const messageOffset = at;
  let version = 'legacy';
  if (bytes[at] & 0x80) { version = bytes[at] & 0x7f; at += 1; }
  const header = { required: bytes[at], readonlySigned: bytes[at + 1], readonlyUnsigned: bytes[at + 2] };
  at += 3;
  let nkeys;
  [nkeys, at] = compactU16(bytes, at);
  if (at + 32 * nkeys > bytes.length) throw new Error('truncated');
  const keys = [];
  for (let i = 0; i < nkeys; i++, at += 32) keys.push(base58(bytes.subarray(at, at + 32)));
  return { signatures, version, header, keys, sigOffset, messageOffset };
}

// Signe une transaction sérialisée avec un wallet { publicKey, sign(bytes) } :
// la signature va dans la case de ce wallet. Renvoie une copie signée.
export async function signTransaction(bytes, wallet) {
  const tx = readTransaction(bytes);
  const slot = tx.keys.slice(0, tx.header.required).indexOf(wallet.publicKey);
  if (slot < 0) throw new Error('not_a_signer');
  const signature = await wallet.sign(bytes.subarray(tx.messageOffset));
  const out = new Uint8Array(bytes);
  out.set(signature, tx.sigOffset + slot * 64);
  return out;
}

// Une transaction (legacy) qui brûle `amount` jetons d'un compte : l'instruction Burn
// (n° 8) du programme de jetons du compte (Token ou Token-2022). Non signée.
export function buildBurnTx({ owner, tokenAccount, mint, tokenProgram, amount, blockhash }) {
  const keys = [owner, tokenAccount, mint, tokenProgram].map(fromBase58);
  if (keys.some((k) => k.length !== 32)) throw new Error('bad_key');
  const data = new Uint8Array(9);
  data[0] = 8;
  new DataView(data.buffer).setBigUint64(1, BigInt(amount), true);
  const message = [
    1, 0, 1,                                   // 1 signature (owner), 1 compte en lecture seule (le programme)
    ...compactBytes(keys.length), ...keys.flatMap((k) => [...k]),
    ...fromBase58(blockhash),
    ...compactBytes(1),                        // une instruction
    3, ...compactBytes(3), 1, 2, 0,            // programme n° 3 ; comptes : jetons, mint, owner
    ...compactBytes(data.length), ...data,
  ];
  return new Uint8Array([...compactBytes(1), ...new Uint8Array(64), ...message]);
}

// Avant de relayer une transaction signée : c'est bien un lancement pump.fun de ce mint,
// payé et signé par ce créateur. Renvoie null si tout va bien, sinon le problème.
export function checkSignedLaunch(bytes, { creator, mint, program = CONFIG.pumpProgram }) {
  let tx;
  try { tx = readTransaction(bytes); } catch { return 'bad_tx'; }
  const signers = tx.keys.slice(0, tx.header.required);
  if (tx.signatures.length !== tx.header.required) return 'bad_tx';
  if (tx.keys[0] !== creator) return 'wrong_payer';
  if (!signers.includes(mint)) return 'wrong_mint';
  if (!tx.keys.includes(program)) return 'not_pump';
  // Toutes les signatures doivent être là (le créateur ET le mint).
  if (tx.signatures.some((s) => s.every((b) => b === 0))) return 'unsigned';
  return null;
}

export function signatureOf(bytes) {
  return base58(readTransaction(bytes).signatures[0]);
}

// Une transaction confirmée (réponse de getTransaction, encodage json) :
// 'ok' si c'est bien la création de ce coin par ce créateur, 'failed' si elle a échoué,
// 'unknown' si elle n'est pas (encore) visible, 'mismatch' si ce n'est pas la bonne.
export function judgeConfirmed(res, { creator, mint, program = CONFIG.pumpProgram }) {
  if (!res?.transaction?.message) return 'unknown';
  if (res.meta?.err) return 'failed';
  const msg = res.transaction.message;
  const keys = (msg.accountKeys || []).map((k) => (typeof k === 'string' ? k : k.pubkey));
  const required = msg.header?.numRequiredSignatures ?? 0;
  if (keys[0] !== creator) return 'mismatch';
  if (!keys.slice(0, required).includes(mint)) return 'mismatch';
  const calls = (msg.instructions || []).some((ix) => keys[ix.programIdIndex] === program);
  if (!calls) return 'mismatch';
  const minted = (res.meta?.postTokenBalances || []).some((b) => b.mint === mint);
  return minted ? 'ok' : 'mismatch';
}

export async function rpc(env, method, params) {
  const res = await fetch(env.SOLANA_RPC || CONFIG.defaultRpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json().catch(() => null);
  if (!data) throw new Error(`rpc_http_${res.status}`);
  if (data.error) {
    const err = new Error(data.error.message || 'rpc_error');
    err.rpc = data.error;
    throw err;
  }
  return data.result;
}

export async function getBalance(env, pubkey) {
  const res = await rpc(env, 'getBalance', [pubkey, { commitment: 'confirmed' }]);
  return res.value;
}

export async function getLatestBlockhash(env) {
  const res = await rpc(env, 'getLatestBlockhash', [{ commitment: 'confirmed' }]);
  return res.value.blockhash;
}

// L'état d'une signature : null (inconnue), { ok: false, err } ou { ok: true }.
export async function signatureStatus(env, signature) {
  const res = await rpc(env, 'getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
  const st = res.value?.[0];
  if (!st) return null;
  if (st.err) return { ok: false, err: st.err };
  if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') return { ok: true };
  return null;
}

// Les jetons `mint` d'un wallet : le compte le plus garni, son solde (en unités entières),
// ses décimales et son programme (Token ou Token-2022).
export async function tokenHolding(env, owner, mint) {
  const res = await rpc(env, 'getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  let best = null;
  for (const acc of res.value || []) {
    const info = acc.account?.data?.parsed?.info?.tokenAmount;
    if (!info) continue;
    const raw = BigInt(info.amount);
    if (!best || raw > best.raw) {
      best = { account: acc.pubkey, raw, decimals: info.decimals, program: acc.account.owner };
    }
  }
  return best || { account: null, raw: 0n, decimals: null, program: null };
}

export function getTransaction(env, signature) {
  return rpc(env, 'getTransaction', [signature, {
    encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0,
  }]);
}

export function sendTransaction(env, bytes) {
  return rpc(env, 'sendTransaction', [base64FromBytes(bytes), {
    encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 5,
  }]);
}
