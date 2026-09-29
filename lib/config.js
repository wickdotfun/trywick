// Tous les réglages du jeu au même endroit. On équilibre WICK ici, pas ailleurs.
//
// Le principe : chaque visiteur adopte SA bougie, avec un look unique. Elle fond
// toute seule : on la nourrit, sinon elle s'éteint pour de bon et rejoint le cimetière.
// Elle grandit avec le temps, et plus vite quand le chart de $WICK monte.
// Quand ça baisse, elle a peur… mais le chart ne la fait jamais fondre.

export const HOUR = 3600_000;
export const MINUTE = 60_000;
export const DAY = 24 * HOUR;

export const CONFIG = {
  // La cire (la vie de la bougie), de 0 à 100. À 0, elle s'éteint.
  waxMax: 100,
  waxAtBirth: 70,
  waxDecayPerHour: 2,          // 50 h de pleine cire à zéro si on l'oublie
  hungryBelow: 25,             // en dessous, elle a faim et le dit

  // Le geste : la nourrir. Au plus toutes les 4 h, et un repas ne suffit pas pour la
  // journée : il faut passer au moins deux fois par jour (ce qui rend pénible le fait
  // d'entretenir plein de bougies avec plein de comptes).
  feedWax: 30,                 // +30 de cire (≈ 15 h de vie)
  cooldown: {
    nourrir: 4 * HOUR,
  },

  // Quand le chart monte, les bougies grandissent plus vite (1 h vécue = 1,5 h ou 2 h de croissance).
  growthBoost: { euphorie: 2, content: 1.5 },

  // Contre les fermes de bougies : 3 naissances par IP et par 24 h.
  maxBirthsPerIpPerDay: 3,

  // Elle évolue avec sa croissance. (L'allumette, c'est avant sa naissance.)
  // Une torche entre au Hall of Fame pour toujours, et débloque la flamme éternelle
  // pour les prochaines bougies de son joueur.
  stages: [
    { key: 'bougie', age: 0 },
    { key: 'chandelle', age: 1 * DAY },
    { key: 'chandelier', age: 3 * DAY },
    { key: 'torche', age: 7 * DAY },
  ],

  // La récompense de la semaine : chaque dimanche à 20 h UTC, les 3 plus vieilles bougies
  // vivantes dont le joueur a donné une adresse Solana publique sont retenues.
  // Anti-triche : une adresse = un seul joueur, et jamais deux gagnants de la même IP.
  // Le dev paie à la main (part des creator fees réglée par REWARD_SHARE dans Cloudflare).
  reward: { weekday: 0, hourUtc: 20, winners: 3 },

  // L'humeur de toutes les bougies suit la variation du prix sur 1 h.
  moods: [
    { key: 'euphorie', min: 8 },
    { key: 'content', min: 2 },
    { key: 'calme', min: -2 },
    { key: 'stress', min: -8 },
    { key: 'panique', min: -Infinity },
  ],

  tickEveryMs: MINUTE,         // le monde avance au plus une fois par minute (et toutes les 10 min par le cron)
  marketCacheMs: MINUTE,
  thoughtCacheMs: 10 * MINUTE,

  // Avant le lancement du coin, les bougies suivent le SOL.
  fallbackMint: 'So11111111111111111111111111111111111111112',
};
