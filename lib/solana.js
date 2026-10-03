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
  at += 32; // le blockhash
  let nix;
  [nix, at] = compactU16(bytes, at);
  const instructions = [];
  for (let i = 0; i < nix; i++) {
    const program = bytes[at++];
    let n;
    [n, at] = compactU16(bytes, at);
    const accounts = [...bytes.subarray(at, at + n)];
    at += n;
    [n, at] = compactU16(bytes, at);
    if (at + n > bytes.length) throw new Error('truncated');
    instructions.push({ program, accounts, data: bytes.subarray(at, at + n) });
    at += n;
  }
  return { signatures, version, header, keys, sigOffset, messageOffset, instructions };
}

const SYSTEM_PROGRAM = '11111111111111111111111111111111';

// ------------------------------------------------------------ adresses dérivées (PDA)
// Une PDA est le hachage SHA-256 de (graines, bump, programme, « ProgramDerivedAddress »), choisi
// pour ne PAS être un point de la courbe ed25519 (personne n'a sa clé privée).
const P = 2n ** 255n - 19n;
const D = (-121665n * inv(121666n)) % P;
const SQRT_M1 = pow(2n, (P - 1n) / 4n);

function mod(a) { const r = a % P; return r < 0n ? r + P : r; }
function pow(b, e) {
  let r = 1n;
  b = mod(b);
  while (e > 0n) { if (e & 1n) r = (r * b) % P; b = (b * b) % P; e >>= 1n; }
  return r;
}
function inv(a) { return pow(a, P - 2n); }

// Ces 32 octets sont-ils un point valide de la courbe ed25519 ? (comme isOnCurve de web3.js)
export function isOnCurve(bytes) {
  const last = bytes[31];
  const b = Uint8Array.from(bytes);
  b[31] = last & 0x7f;
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(b[i]);
  if (y >= P) return false;
  const y2 = mod(y * y);
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  // x = u·v³·(u·v⁷)^((p−5)/8), puis on vérifie v·x² = ±u.
  const v3 = mod(v * v * v);
  let x = mod(u * v3 * pow(u * v3 * v3 * v, (P - 5n) / 8n));
  const vx2 = mod(v * x * x);
  if (vx2 === u) { /* ok */ } else if (vx2 === mod(-u)) x = mod(x * SQRT_M1);
  else return false;
  if (x === 0n && (last & 0x80)) return false;
  return true;
}

async function sha256(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { buf.set(p, at); at += p.length; }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');
const seedBytes = (s) => (typeof s === 'string' ? new TextEncoder().encode(s) : s);

// findProgramAddress : graines = des textes (« bonding-curve ») ou des octets (une adresse :
// fromBase58(adresse)).
export async function findPda(seeds, programId) {
  const parts = seeds.map(seedBytes);
  const program = fromBase58(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const hash = await sha256([...parts, Uint8Array.of(bump), program, PDA_MARKER]);
    if (!isOnCurve(hash)) return base58(hash);
  }
  throw new Error('no_pda');
}

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const WSOL = 'So11111111111111111111111111111111111111112';

// Le compte de jetons associé (ATA) d'un propriétaire pour un mint.
export function ataAddress(owner, mint, tokenProgram = TOKEN_PROGRAM) {
  return findPda([fromBase58(owner), fromBase58(tokenProgram), fromBase58(mint)], ATA_PROGRAM);
}

// ------------------------------------------------------------ transaction (legacy) générique
// instructions : [{ programId, keys: [{ pubkey, isSigner, isWritable }], data: Uint8Array }].
// Comptes rangés comme le veut Solana : payeur, signataires (écriture puis lecture), puis les
// autres (écriture puis lecture). Renvoie la transaction non signée (signatures à zéro).
export function buildLegacyTx({ payer, instructions, blockhash }) {
  const metas = new Map([[payer, { signer: true, writable: true }]]);
  const add = (key, signer, writable) => {
    const m = metas.get(key) || { signer: false, writable: false };
    m.signer ||= signer;
    m.writable ||= writable;
    metas.set(key, m);
  };
  for (const ix of instructions) {
    for (const k of ix.keys) add(k.pubkey, Boolean(k.isSigner), Boolean(k.isWritable));
    add(ix.programId, false, false);
  }
  const all = [...metas.entries()];
  const rank = ([key, m]) => (key === payer ? -1 : (m.signer ? 0 : 2) + (m.writable ? 0 : 1));
  const ordered = all.map((e, i) => [e, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([e]) => e);
  const keys = ordered.map(([k]) => k);
  const index = new Map(keys.map((k, i) => [k, i]));
  const signers = ordered.filter(([, m]) => m.signer);
  const header = [
    signers.length,
    signers.filter(([, m]) => !m.writable).length,
    ordered.filter(([, m]) => !m.signer && !m.writable).length,
  ];
  const keyBytes = keys.map(fromBase58);
  if (keyBytes.some((k) => k.length !== 32)) throw new Error('bad_key');
  const message = [
    ...header,
    ...compactBytes(keys.length), ...keyBytes.flatMap((k) => [...k]),
    ...fromBase58(blockhash),
    ...compactBytes(instructions.length),
    ...instructions.flatMap((ix) => [
      index.get(ix.programId),
      ...compactBytes(ix.keys.length), ...ix.keys.map((k) => index.get(k.pubkey)),
      ...compactBytes(ix.data.length), ...ix.data,
    ]),
  ];
  return new Uint8Array([...compactBytes(signers.length), ...new Uint8Array(64 * signers.length), ...message]);
}


// Un virement de SOL (legacy, non signé) de `from` vers `to`, payé par `from`.
export function buildTransferTx({ from, to, lamports, blockhash }) {
  const keys = [from, to, SYSTEM_PROGRAM].map(fromBase58);
  if (keys.some((k) => k.length !== 32)) throw new Error('bad_key');
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);                       // SystemInstruction::Transfer
  view.setBigUint64(4, BigInt(lamports), true);
  const message = [
    1, 0, 1,
    ...compactBytes(3), ...keys.flatMap((k) => [...k]),
    ...fromBase58(blockhash),
    ...compactBytes(1), 2, ...compactBytes(2), 0, 1, ...compactBytes(data.length), ...data,
  ];
  return new Uint8Array([...compactBytes(1), ...new Uint8Array(64), ...message]);
}

// Le frais de lancement signé : un virement d'au moins `lamports` de `from` vers `to`,
// payé et signé par `from`. Renvoie null si tout va bien, sinon le problème.
export function checkFeeTx(bytes, { from, to, lamports }) {
  let tx;
  try { tx = readTransaction(bytes); } catch { return 'bad_fee_tx'; }
  if (tx.keys[0] !== from) return 'bad_fee_tx';
  if (tx.signatures.length !== tx.header.required || tx.signatures.some((s) => s.every((b) => b === 0))) return 'unsigned';
  const paid = tx.instructions.some((ix) => {
    if (tx.keys[ix.program] !== SYSTEM_PROGRAM || ix.data.length < 12) return false;
    const view = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength);
    return view.getUint32(0, true) === 2
      && view.getBigUint64(4, true) >= BigInt(lamports)
      && tx.keys[ix.accounts[0]] === from
      && tx.keys[ix.accounts[1]] === to;
  });
  return paid ? null : 'bad_fee_tx';
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
