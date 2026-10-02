// Tous les réglages au même endroit.
//
// Le principe : une seule bougie géante. Chaque coin lancé depuis le site est une
// allumette qui se met à tourner autour d'elle, et chaque allumette la fait fondre un peu.
// Quand la dernière allumette tombe, la bougie a fondu : on en allume une nouvelle.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export const CONFIG = {
  // Combien d'allumettes pour faire fondre une bougie entière (MATCHES_PER_CANDLE pour changer).
  matchesPerCandle: 1000,

  // Le « dev buy » : ce que le créateur achète de son propre coin au lancement, en SOL.
  maxDevBuySol: 5,

  // Contre le spam : au plus 12 lancements préparés par IP et par heure.
  preparesPerIpPerHour: 12,

  // Une allumette préparée mais jamais signée est oubliée au bout de 2 h.
  pendingTtlMs: 2 * HOUR,

  // La chaleur : les allumettes des 10 dernières minutes font grossir la flamme.
  heatWindowMs: 10 * MINUTE,

  // Le fil du site renvoie au plus 1000 allumettes d'un coup.
  maxMatchesPerResponse: 1000,

  image: {
    maxBytes: 1_500_000,
    types: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
  },

  // Les textes d'un coin, comme sur pump.fun.
  limits: { name: 32, symbol: 10, description: 500, url: 200 },

  // Le lancement passe par pump.fun : métadonnées sur leur IPFS, transaction construite
  // par PumpPortal (« local transaction » : c'est le wallet du créateur qui signe).
  pumpProgram: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  ipfsUrl: 'https://pump.fun/api/ipfs',
  pumpPortalUrl: 'https://pumpportal.fun/api/trade-local',
  slippage: 10,
  priorityFeeSol: 0.0005,
  defaultRpc: 'https://api.mainnet-beta.solana.com',
};

export function matchesPerCandle(env) {
  const n = Number(env?.MATCHES_PER_CANDLE);
  return Number.isInteger(n) && n >= 1 ? n : CONFIG.matchesPerCandle;
}
