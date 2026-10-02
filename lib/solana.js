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
  for (let i = 0; i < nsig; i++, at += 64) {
    if (at + 64 > bytes.length) throw new Error('truncated');
    signatures.push(bytes.subarray(at, at + 64));
  }
  let version = 'legacy';
  if (bytes[at] & 0x80) { version = bytes[at] & 0x7f; at += 1; }
  const header = { required: bytes[at], readonlySigned: bytes[at + 1], readonlyUnsigned: bytes[at + 2] };
  at += 3;
  let nkeys;
  [nkeys, at] = compactU16(bytes, at);
  if (at + 32 * nkeys > bytes.length) throw new Error('truncated');
  const keys = [];
  for (let i = 0; i < nkeys; i++, at += 32) keys.push(base58(bytes.subarray(at, at + 32)));
  return { signatures, version, header, keys };
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
