// Tous les réglages au même endroit.
//
// Le principe : une seule bougie géante, qui fond en 30 minutes au plus. Chaque coin
// lancé depuis le site est une allumette qui tourne autour d'elle et la fait fondre plus
// vite (1 minute de moins). Quand la bougie s'éteint, le site rachète du $WICK avec la
// cagnotte (les creator fees) et brûle ce qu'il vient de racheter. Puis une nouvelle
// bougie s'allume.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export const CONFIG = {
  // Une bougie fond en 30 minutes au plus (CYCLE_MINUTES), et chaque allumette lui
  // enlève 1 minute (MATCH_MINUTES).
  cycleMinutes: 30,
  matchMinutes: 1,

  // Le buyback, à chaque bougie éteinte (voir lib/buyback.js).
  buyback: {
    reserveSol: 0.02,          // toujours laissé dans le wallet, pour payer les frais
    minBuySol: 0.005,          // en dessous, pas de rachat cette fois : la cagnotte attend
    slippage: 15,
    priorityFeeSol: 0.0005,
    confirmWaitMs: 40_000,     // on attend la confirmation au plus 40 s par étape
    stuckAfterMs: 3 * 60_000,  // une étape sans nouvelles depuis 3 min est ratée
    maxBurnTries: 5,
  },

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

function minutes(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// La durée d'une bougie et ce que lui enlève chaque allumette, en millisecondes.
export function cycleTiming(env) {
  return {
    durationMs: minutes(env?.CYCLE_MINUTES, CONFIG.cycleMinutes) * MINUTE,
    matchMs: minutes(env?.MATCH_MINUTES, CONFIG.matchMinutes) * MINUTE,
  };
}
