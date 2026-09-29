// La récompense de la semaine : les dates du tirage, et la validation des adresses.
import { CONFIG, DAY } from './config.js';

export const WEEK = 7 * DAY;

// Le dernier tirage passé (dimanche 20 h UTC par défaut), en millisecondes.
export function lastDeadline(now) {
  const d = new Date(now);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), CONFIG.reward.hourUtc);
  let t = today - ((d.getUTCDay() - CONFIG.reward.weekday + 7) % 7) * DAY;
  if (t > now) t -= WEEK;
  return t;
}

export const nextDeadline = (now) => lastDeadline(now) + WEEK;

// Une adresse Solana publique : 32 à 44 caractères base58. Une clé privée (bien plus
// longue) ou une phrase de seed (avec des espaces) est refusée.
export function isSolanaAddress(value) {
  return typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());
}

// Une signature de transaction Solana (preuve de paiement) : 64 à 88 caractères base58.
export function isTxSignature(value) {
  return typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value.trim());
}

export const shortAddress = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : null);
