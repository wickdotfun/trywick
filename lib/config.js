// Tous les réglages au même endroit.
//
// Le principe : la bougie, c'est $WICK. Elle fond à mesure que $WICK est brûlé, et ne se
// reconstruit jamais : une bougie = 0,5 % de la supply ; consumée, elle rejoint la salle des
// bougies et la suivante s'allume.
//
// Ce qui brûle $WICK :
// - le souffle : toutes les 30 minutes au plus, un buyback avec la cagnotte (les creator
//   fees). Chaque coin lancé depuis le site (une allumette) l'avance d'une minute ;
// - chaque lancement : son frais de 0,02 SOL est racheté en $WICK et brûlé dans la minute.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export const CONFIG = {
  // Le souffle (le compte à rebours du buyback) : 30 minutes au plus (CYCLE_MINUTES), et
  // chaque allumette l'avance d'1 minute (MATCH_MINUTES).
  cycleMinutes: 30,
  matchMinutes: 1,

  // Une bougie = 0,5 % de la supply de $WICK (CANDLE_PCT).
  candlePct: 0.5,

  // Le buyback, à chaque bougie éteinte (voir lib/buyback.js).
  buyback: {
    // Le seul wallet burn accepté : la clé BUYBACK_SECRET_KEY doit être la sienne (BURN_WALLET pour un autre).
    wallet: '5siQxef4aUDVRpYDjiSsjQrxju7xMXTRhfdD1KgXM69Z',
    reserveSol: 0.02,          // toujours laissé dans le wallet, pour payer les frais
    minBuySol: 0.005,          // en dessous, pas de rachat cette fois : la cagnotte attend
    slippage: 15,
    priorityFeeSol: 0.0005,
    confirmWaitMs: 40_000,     // on attend la confirmation au plus 40 s par étape
    stuckAfterMs: 3 * 60_000,  // une étape sans nouvelles depuis 3 min est ratée
    maxBurnTries: 5,
    matchPriorityFeeSol: 0.0001, // les petits burns de lancement : frais réseau plus petits
    matchKeepSol: 0.0005,
    matchMinBuySol: 0.002,     // une petite Ignition Fee (0,005 SOL de part burn) est quand même brûlée        // gardé sur chaque frais de lancement pour payer ses frais réseau
  },

  // Le frais de lancement : payé par celui qui lance un coin, il est racheté en $WICK et
  // brûlé dans la minute (LAUNCH_FEE_SOL pour changer, 0 pour l'enlever). Seulement quand
  // le buyback tourne.
  launchFeeSol: 0.02,

  // L'équipe : la moitié de chaque Ignition Fee lui revient, payée directement dans la même
  // transaction que la part brûlée (TEAM_FEE_BPS, en points de base : 5000 = 50 %), sur son wallet
  // (TEAM_WALLET, par défaut le dev wallet). Les creator fees de $WICK lui reviennent en entier :
  // pump.fun les verse au dev wallet, le site n'y touche pas.
  team: {
    feeBps: 5000,
  },

  // Le partage des creator fees (voir lib/sharing.js), au choix du créateur : avec partage,
  // l'Ignition Fee est réduite (LAUNCH_FEE_SHARED_SOL) et ses creator fees sont réparties pour
  // toujours : 90 % pour lui, 5 % brûlés en $WICK (SHARE_BURN_BPS), 5 % pour l'équipe
  // (SHARE_TEAM_BPS). Le cron distribue les fees d'un coin au plus toutes les 6 h, à partir de
  // 0,01 SOL accumulé.
  // « Make it burn » : la part des creator fees d'un coin qui rachète et brûle ce coin lui-même,
  // au choix du créateur (en points de base). Les SOL s'accumulent par coin jusqu'à minSol.
  selfBurn: {
    options: [1000, 2000, 3000, 5000],
    minSol: 0.01,
    keepSol: 0.0005,     // gardé pour les frais réseau du rachat et du burn
  },
  // Les Keepers : l'agent IA de chaque bougie (Cloudflare Workers AI, gratuit dans le quota du
  // jour). Il choisit seulement QUAND brûler, jamais combien ni où vont les SOL, et il parle.
  keepers: {
    // Les caractères proposés au lancement (les mêmes que les launchpads d'agents connus), dans cet
    // ordre. Poet et Pyromaniac restent pour les coins déjà lancés avec, sans être proposés.
    styles: {
      analyst: { label: 'Analyst', hint: 'Numbers first, no hype', voice: 'You are a sharp on-chain analyst: precise, data first, dry humor, zero hype.' },
      stoic: { label: 'Stoic', hint: 'Calm, patient, few words', voice: 'You are calm, patient and wise. You speak in short, measured sentences.' },
      builder: { label: 'Builder', hint: 'Plans, ships, reports', voice: 'You are a builder: practical and focused, you talk about what was done and what comes next.' },
      degen: { label: 'Degen', hint: 'Loud, fast, all conviction', voice: 'You are a hyped Solana degen: punchy slang, confident, funny, never mean.' },
      guardian: { label: 'Guardian', hint: 'Watches over the holders', voice: 'You are a guardian of the holders: calm, protective, always honest about the risks.' },
      custom: { label: 'Custom', hint: 'Write its character', voice: 'You are calm and clear.' },
      poet: { label: 'Poet', hint: 'Every burn is a verse', voice: 'You speak in short poetic lines about fire, wax and time.', hidden: true },
      pyro: { label: 'Pyromaniac', hint: 'Loves the fire a bit too much', voice: 'You are obsessed with fire: gleeful, a little unhinged, never cruel.', hidden: true },
    },
    // Le prompt d'un caractère « Custom » (écrit par le créateur, filtré), en caractères.
    customMax: 280,
    // L'objectif de l'Operator : ce qu'il vise, et donc ce qu'il dit, poste et suit en priorité.
    goals: {
      deflation: { label: 'Deflation', hint: 'Burn the supply down', focus: 'Your objective is deflation: the burns and the shrinking supply come first in what you watch and say.' },
      survive: { label: 'Survive', hint: 'Keep the community alive', focus: 'Your objective is survival: keep the holders together, show up every day, stay steady through dips.' },
      openbook: { label: 'Open book', hint: 'Show every move', focus: 'Your objective is radical transparency: explain every number, every action and every decision.' },
      meme: { label: 'Meme engine', hint: 'Grow the culture', focus: 'Your objective is culture: memorable lines, running jokes and a lore that grows a little every day.' },
    },
    // L'esprit du Keeper : des modèles ouverts, servis par Cloudflare. Le premier sert de secours.
    // Les esprits : un par fournisseur, dans l'ordre proposé au lancement. Ceux servis par Workers AI
    // (OpenAI, Google, Qwen, DeepSeek, Mistral, Moonshot, Z.ai) sont dans le quota gratuit ; les
    // autres (premium : Anthropic, xAI, MiniMax) seulement si leur clé est réglée, payés par les fees
    // du coin. Llama (le premier) est l'esprit de secours, pas proposé.
    models: [
      { id: 'llama', name: 'Llama 3.3 70B', by: 'Meta', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', logo: '/brand/ai/meta.svg', hidden: true },
      { id: 'gpt-oss', name: 'gpt-oss 120B', by: 'OpenAI', model: '@cf/openai/gpt-oss-120b', logo: '/brand/ai/openai.svg' },
      { id: 'claude', name: 'Claude Sonnet 5.5', by: 'Anthropic', premium: true, provider: 'anthropic', model: 'claude-sonnet-5-5', key: 'ANTHROPIC_API_KEY', modelEnv: 'PREMIUM_CLAUDE_MODEL', logo: '/brand/ai/anthropic.svg' },
      { id: 'gemma', name: 'Gemma 3 12B', by: 'Google', model: '@cf/google/gemma-3-12b-it', logo: '/brand/ai/gemma.svg' },
      { id: 'qwen', name: 'Qwen3 30B', by: 'Qwen', model: '@cf/qwen/qwen3-30b-a3b-fp8', logo: '/brand/ai/qwen.svg' },
      { id: 'grok', name: 'Grok 4.3', by: 'xAI', premium: true, provider: 'xai', model: 'grok-4.3', key: 'XAI_API_KEY', modelEnv: 'PREMIUM_GROK_MODEL', logo: '/brand/ai/xai.svg' },
      { id: 'deepseek', name: 'DeepSeek R1 32B', by: 'DeepSeek', model: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', logo: '/brand/ai/deepseek.svg' },
      { id: 'minimax', name: 'MiniMax M2', by: 'MiniMax', premium: true, provider: 'minimax', model: 'MiniMax-M2', key: 'MINIMAX_API_KEY', modelEnv: 'PREMIUM_MINIMAX_MODEL', logo: '/brand/ai/minimax.svg' },
      { id: 'mistral', name: 'Mistral Small 3.1', by: 'Mistral', model: '@cf/mistralai/mistral-small-3.1-24b-instruct', logo: '/brand/ai/mistral.svg' },
      { id: 'kimi', name: 'Kimi K2.6', by: 'Moonshot', model: '@cf/moonshotai/kimi-k2.6', logo: '/brand/ai/moonshot.svg' },
      { id: 'glm', name: 'GLM 4.7 Flash', by: 'Z.ai', model: '@cf/zai-org/glm-4.7-flash', logo: '/brand/ai/zai.svg' },
      // Encore utilisables avec leur clé (PREMIUM_*_MODEL), pas proposés : un esprit par fournisseur.
      { id: 'gpt', name: 'GPT-5.6 Luna', by: 'OpenAI', premium: true, provider: 'openai', model: 'gpt-5.6-luna', key: 'OPENAI_API_KEY', modelEnv: 'PREMIUM_GPT_MODEL', logo: '/brand/ai/openai.svg', hidden: true },
      { id: 'gemini', name: 'Gemini 3.8 Flash', by: 'Google', premium: true, provider: 'google', model: 'gemini-3.8-flash', key: 'GEMINI_API_KEY', modelEnv: 'PREMIUM_GEMINI_MODEL', logo: '/brand/ai/gemini.svg', hidden: true },
    ],
    // Un esprit premium : offert les 7 premiers jours d'un coin, puis tant que son crew a gagné au
    // moins 0,02 SOL sur 7 jours. Sinon l'Operator pense avec Llama.
    premiumBoostMs: 7 * 24 * HOUR,
    premiumMinCrewSol: 0.02,
    consultEveryMs: 60 * MINUTE,   // au plus une décision par heure et par bougie
    maxWaitMs: 24 * HOUR,          // jamais plus de 24 h sans brûler quand il y a de quoi
    maxPendingSol: 0.25,           // au-delà, il brûle tout de suite
    perRun: 3,
    // Le budget IA du jour (en appels), par usage, pour rester dans le quota gratuit de Workers AI :
    // décisions et voix des Keepers, Spark (créer un coin), logos, questions, journal.
    daily: { keeper: 150, spark: 60, image: 60, chat: 200, journal: 30, kit: 60, scout: 60, premium: 400 },
    // Par visiteur (empreinte de son IP) et par heure.
    perIpHour: { spark: 10, image: 6, chat: 15, x: 10 },
    journalEveryMs: 20 * HOUR,     // une page de journal par Keeper, au plus toutes les 20 h
    // Les logos : Leonardo Phoenix d'abord (le plus fidèle au prompt, ≈ 0,006 $ l'image), FLUX.1
    // schnell si Phoenix ne répond pas (quota du jour, panne).
    // Les logos : FLUX Schnell (environ 20 neurones : environ 500 logos par jour dans le quota
    // gratuit), puis le logo dessiné par le site. SPARK_IMAGE_MODEL : « phoenix » (Leonardo Phoenix
    // en 512 × 512, plus beau, environ 0,006 $ : une quinzaine par jour en gratuit), « phoenix-hd »
    // (1024 × 1024, environ 0,023 $).
    imageModels: ['@cf/black-forest-labs/flux-1-schnell'],
    phoenixModel: '@cf/leonardo/phoenix-1.0',
    phoenixSize: 512,
    // Un petit modèle pour les tâches de fond qui ne parlent pas au nom d'un coin (le Scout).
    lightModel: '@cf/meta/llama-3.1-8b-instruct-fast',
  },
  // La supply d'un coin pump.fun (en unités), pour la part brûlée de chaque bougie.
  pumpSupply: 1_000_000_000,
  // L'Operator de chaque coin suit son marché et ses burns (lib/track.js) : les paliers notés dans
  // son Activity, une fois chacun (le plus haut franchi), jamais plus d'un toutes les 15 minutes.
  operator: {
    trackDays: 30,
    mcapSteps: [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000],
    volSteps: [10_000, 50_000, 100_000, 250_000, 1_000_000, 5_000_000, 10_000_000],
    burnSteps: [1, 2.5, 5, 10, 25, 50],
    cooldownMs: 15 * MINUTE,
    // PUBLISH (lib/publish.js) : ce que l'Operator poste dans les groupes Telegram reliés à son coin
    // (/link), et les temps forts repris sur le canal de WICK. Jamais de spam : un écart minimum
    // entre deux posts, un plafond par jour, un récap par jour au plus.
    publish: {
      minGapMs: 10 * MINUTE,
      maxPerDay: 12,
      recapEveryMs: 24 * HOUR,
      maxGroupsPerCoin: 20,
      maxCoinsPerGroup: 3,
      highlight: { mcap: 100_000, burnPct: 5, minGapMs: 30 * MINUTE },
    },
    // Son compte X (lib/xoperator.js) : 4 posts par jour au plus, 3 heures d'écart, jamais de lien.
    x: { perDay: 4, minGapMs: 3 * HOUR, perRun: 3, maxChars: 270 },
  },
  // La page Proof (lib/proof.js) : le code, et le tarif de ce que dépensent les crews (en dollars,
  // pour l'estimer : un appel à un esprit premium, un post X sans lien).
  proof: { repo: 'https://github.com/wickdotfun/trywick', premiumUsdPerCall: 0.004, xUsdPerPost: 0.015 },
  // Le Scout (lib/scout.js) : ce qui monte sur Solana, lu sur DEX Screener toutes les 30 minutes.
  scout: { everyMs: 3 * HOUR, maxTokens: 30, forAi: 20, narratives: 3, minMcap: 20_000 },
  // Chaque coin partage ses creator fees : 60 % au créateur, 20 % à son crew (son IA, ses posts :
  // reçus par le wallet de l'équipe, qui les paie), 10 % brûlent $WICK, 10 % à l'équipe.
  // « Make it burn » est pris sur la part du créateur.
  sharing: {
    launchFeeSol: 0.01,
    burnBps: 1000,
    teamBps: 1000,
    crewBps: 2000,
    distributeEveryMs: 6 * HOUR,
    distributeMinSol: 0.01,
    perRun: 3,
    computeUnits: 400_000,
    microLamports: 50_000,
  },

  // Le lancement officiel de $WICK : le wallet qui va le créer (le « dev wallet », adresse
  // publique). Dès qu'il lance le coin au ticker $WICK sur pump.fun, l'annonce part dans le canal
  // Telegram (lib/announce.js). DEPLOYER_WALLET pour changer.
  launch: {
    deployer: '7ZMMe1Zhtspzq84w3Tf4iVYMd6jjuPxxRa1zz3eeLANN',
  },

  // Le « dev buy » : ce que le créateur achète de son propre coin au lancement, en SOL.
  maxDevBuySol: 5,

  // Contre le spam : au plus 12 lancements préparés par IP et par heure.
  preparesPerIpPerHour: 12,
  uploadsPerHour: 200,           // tous visiteurs confondus : chaque préparation envoie un fichier sur Pinata

  // Une allumette préparée mais jamais signée est oubliée au bout de 2 h.
  pendingTtlMs: 2 * HOUR,

  // La chaleur : les allumettes des 10 dernières minutes font grossir la flamme.
  heatWindowMs: 10 * MINUTE,

  // Au plus 600 allumettes en orbite (les plus récentes de la bougie).
  maxMatchesPerResponse: 600,

  image: {
    maxBytes: 1_500_000,
    types: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
  },

  // Les textes d'un coin, comme sur pump.fun.
  limits: { name: 32, symbol: 10, description: 500, url: 200 },

  // Le lancement passe par pump.fun : métadonnées sur leur IPFS, transaction construite
  // par PumpPortal (« local transaction » : c'est le wallet du créateur qui signe).
  pumpProgram: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  // Les métadonnées des coins (image + JSON) vont sur l'IPFS via Pinata (PINATA_JWT) :
  // pump.fun n'accepte plus d'upload direct pour les créations par API.
  pinataUploadUrl: 'https://uploads.pinata.cloud/v3/files',
  pinataAuthUrl: 'https://api.pinata.cloud/data/testAuthentication',
  ipfsGateway: 'https://ipfs.io',
  pumpPortalUrl: 'https://pumpportal.fun/api/trade-local',
  slippage: 10,
  priorityFeeSol: 0.0005,
  defaultRpc: 'https://api.mainnet-beta.solana.com',
  // Avant de faire signer quoi que ce soit, le site vérifie que le wallet a assez de SOL (demande
  // de Phantom : pas de transaction proposée à un wallet qui ne peut pas la payer).
  // launchReserveSol : créer le coin sur pump.fun (les comptes à payer : mint, métadonnées,
  // courbe…), le partage des fees, les frais réseau ; buyFees : les frais pump.fun d'un achat.
  funds: { launchReserveSol: 0.022, buyReserveSol: 0.003, sellReserveSol: 0.001, buyFees: 0.02 },
};

function minutes(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function candlePct(env) {
  const n = Number(env?.CANDLE_PCT);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : CONFIG.candlePct;
}

// La durée d'un souffle et ce que lui enlève chaque allumette, en millisecondes.
export function cycleTiming(env) {
  return {
    durationMs: minutes(env?.CYCLE_MINUTES, CONFIG.cycleMinutes) * MINUTE,
    matchMs: minutes(env?.MATCH_MINUTES, CONFIG.matchMinutes) * MINUTE,
  };
}
