// Le wallet a-t-il assez de SOL ? Vérifié avant de préparer une transaction à signer (Phantom
// demande qu'un site ne propose jamais une transaction que le wallet ne peut pas payer).
import { CONFIG } from './config.js';
import { getBalance } from './solana.js';

const F = CONFIG.funds;
const up = (lamports) => Math.ceil(lamports / 1e5) / 1e4;
const down = (lamports) => Math.floor(lamports / 1e5) / 1e4;

// Un lancement : l'achat du créateur (avec les frais pump.fun), l'Ignition Fee, la création du coin.
export const launchNeedSol = (devBuy, feeLamports = 0) => (devBuy > 0 ? devBuy * (1 + F.buyFees) : 0) + feeLamports / 1e9 + F.launchReserveSol;

// Un achat ou une vente de $WICK depuis le site.
export const tradeNeedSol = (t) => (t.side === 'buy' ? t.amount * (1 + F.buyFees) + F.buyReserveSol : F.sellReserveSol);

// → null si le wallet a assez, sinon { needSol, haveSol }. Un solde illisible (panne du RPC)
// ne bloque personne : le wallet affichera son propre avertissement.
export async function shortOfFunds(env, owner, needSol) {
  const lamports = await getBalance(env, owner).catch(() => null);
  if (typeof lamports !== 'number') return null;
  const need = Math.ceil(needSol * 1e9);
  return lamports >= need ? null : { needSol: up(need), haveSol: down(lamports) };
}
