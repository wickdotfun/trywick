// Les tables, créées automatiquement au premier passage.
// (Les tables de l'ancienne version du site ne sont pas touchées.)
//
// Une allumette = un coin lancé depuis le site.
// - préparée : on a ses métadonnées (seq vide) ;
// - envoyée : la transaction signée est partie (signature remplie) ;
// - allumée : la transaction est confirmée on-chain, elle reçoit son numéro (seq)
//   et la bougie (cycle) qui brûlait à ce moment-là.
//
// Une bougie = un cycle, de son allumage à son buyback :
//   burning → ended (et son buyback part dans la file des burns).
//
// Un burn = un rachat de $WICK puis le burn de ce qui a été racheté (lib/buyback.js) :
// - kind 'candle' : le buyback d'une bougie éteinte, avec la cagnotte des creator fees ;
// - kind 'match'  : le frais payé par celui qui a lancé un coin, brûlé dans la minute.
//   queued → buying → bought → burning_tx → burned
//   (ou skipped : rien à racheter ; failed : le rachat a échoué, les SOL restent là).
const CREATE = [
  `CREATE TABLE IF NOT EXISTS matches (
    mint TEXT PRIMARY KEY,
    creator TEXT NOT NULL,
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    image TEXT,
    uri TEXT NOT NULL,
    dev_buy REAL NOT NULL DEFAULT 0,
    ip TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    signature TEXT,
    sent_at INTEGER,
    seq INTEGER UNIQUE,
    lit_at INTEGER
  )`,
  'CREATE INDEX IF NOT EXISTS matches_ip ON matches (ip, created_at)',
  'CREATE INDEX IF NOT EXISTS matches_lit ON matches (lit_at)',
  `CREATE TABLE IF NOT EXISTS cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    matches INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'burning',
    note TEXT,
    step_at INTEGER,
    buy_sol REAL,
    buy_sig TEXT,
    pre_raw TEXT,
    bought_raw TEXT,
    decimals INTEGER,
    token_account TEXT,
    token_program TEXT,
    burn_sig TEXT,
    burn_tries INTEGER NOT NULL DEFAULT 0,
    burned_ui REAL
  )`,
  // Une seule bougie allumée à la fois, même si deux requêtes en allument une en même temps.
  'CREATE UNIQUE INDEX IF NOT EXISTS cycles_one_open ON cycles ((ended_at IS NULL)) WHERE ended_at IS NULL',
  'CREATE INDEX IF NOT EXISTS cycles_status ON cycles (status, id)',
  `CREATE TABLE IF NOT EXISTS burns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    sol REAL,
    status TEXT NOT NULL DEFAULT 'queued',
    note TEXT,
    step_at INTEGER,
    buy_sig TEXT,
    pre_raw TEXT,
    bought_raw TEXT,
    decimals INTEGER,
    token_account TEXT,
    token_program TEXT,
    burn_sig TEXT,
    burn_tries INTEGER NOT NULL DEFAULT 0,
    burned_ui REAL,
    burned_at INTEGER,
    tg_done INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS burns_ref ON burns (kind, ref)',
  'CREATE INDEX IF NOT EXISTS burns_status ON burns (status, id)',
  // La salle des bougies : chaque bougie consumée (un palier de supply de $WICK brûlé).
  `CREATE TABLE IF NOT EXISTS hall (
    number INTEGER PRIMARY KEY,
    started_at INTEGER NOT NULL,
    completed_at INTEGER NOT NULL,
    launches INTEGER NOT NULL,
    burned REAL NOT NULL,
    pct REAL NOT NULL,
    top_mint TEXT,
    top_symbol TEXT,
    top_mcap REAL,
    tg_done INTEGER NOT NULL DEFAULT 0
  )`,
  // Chaque distribution des creator fees partagées d'un coin, lancée par le cron : la part de
  // WICK (lue dans la transaction confirmée) rejoint la cagnotte du prochain buyback.
  `CREATE TABLE IF NOT EXISTS shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mint TEXT NOT NULL,
    at INTEGER NOT NULL,
    sig TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',
    total_lamports INTEGER,
    wick_lamports INTEGER
  )`,
  'CREATE INDEX IF NOT EXISTS shares_status ON shares (status, id)',
  // Les réglages de la page d'admin (pause du buyback, dernière erreur du cron).
  'CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
];

// Les colonnes ajoutées après coup aux tables déjà en ligne.
const UPGRADES = [
  'ALTER TABLE matches ADD COLUMN cycle INTEGER',
  // Le frais de lancement (brûlé en $WICK) : combien, vers qui, sa transaction, son état.
  'ALTER TABLE matches ADD COLUMN fee_lamports INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE matches ADD COLUMN fee_to TEXT',
  'ALTER TABLE matches ADD COLUMN fee_sig TEXT',
  'ALTER TABLE matches ADD COLUMN fee_state TEXT',
  // Lancé par un holder de $WICK : flamme dorée.
  'ALTER TABLE matches ADD COLUMN holder INTEGER NOT NULL DEFAULT 0',
  // Le marché du coin (DexScreener), pour les allumettes vivantes.
  'ALTER TABLE matches ADD COLUMN mcap REAL',
  'ALTER TABLE matches ADD COLUMN change24h REAL',
  'ALTER TABLE matches ADD COLUMN mcap_at INTEGER NOT NULL DEFAULT 0',
  // Le post Telegram de l'allumette.
  'ALTER TABLE matches ADD COLUMN tg_msg_id INTEGER',
  'ALTER TABLE matches ADD COLUMN tg_state TEXT',
  // Le volume des dernières 24 h (DexScreener), et les records du coin (pour les succès).
  'ALTER TABLE matches ADD COLUMN vol24h REAL',
  'ALTER TABLE matches ADD COLUMN mcap_peak REAL',
  'ALTER TABLE matches ADD COLUMN vol_peak REAL',
  // La salle des bougies : les SOL dépensés pendant la bougie, ses burns, et le dernier.
  'ALTER TABLE hall ADD COLUMN sol REAL',
  'ALTER TABLE hall ADD COLUMN burns INTEGER',
  'ALTER TABLE hall ADD COLUMN last_sig TEXT',
  // Le partage des creator fees (lib/sharing.js) : la part de WICK (points de base), la
  // transaction préparée (message), puis signée, son état, et la dernière distribution.
  'ALTER TABLE matches ADD COLUMN share_bps INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE matches ADD COLUMN share_msg TEXT',
  'ALTER TABLE matches ADD COLUMN share_tx TEXT',
  'ALTER TABLE matches ADD COLUMN share_state TEXT',
  'ALTER TABLE matches ADD COLUMN share_dist_at INTEGER NOT NULL DEFAULT 0',
  // Les liens du coin (pour le post Telegram).
  'ALTER TABLE matches ADD COLUMN twitter TEXT',
  'ALTER TABLE matches ADD COLUMN telegram TEXT',
  'ALTER TABLE matches ADD COLUMN website TEXT',
  // L'Ignition Fee partagée : la part de l'équipe (son wallet, son montant) ; et, avec le partage
  // des creator fees, la part de l'équipe dans share_bps (qui compte toutes les parts de WICK).
  'ALTER TABLE matches ADD COLUMN team_to TEXT',
  'ALTER TABLE matches ADD COLUMN team_lamports INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE matches ADD COLUMN share_team_bps INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shares ADD COLUMN team_lamports INTEGER',
  // « Make it burn » : la part que le coin brûle de lui-même, ce qui attend d'être racheté,
  // et ce qui a déjà brûlé (en unités du coin, en SOL, en nombre de burns).
  'ALTER TABLE matches ADD COLUMN self_bps INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE matches ADD COLUMN self_pending INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE matches ADD COLUMN self_burned REAL NOT NULL DEFAULT 0',
  'ALTER TABLE matches ADD COLUMN self_sol REAL NOT NULL DEFAULT 0',
  'ALTER TABLE matches ADD COLUMN self_burns INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shares ADD COLUMN self_lamports INTEGER',
  // Les Keepers : la personnalité et l'esprit (le modèle) choisis au lancement, ses premiers mots,
  // sa dernière pensée, sa dernière consultation, le dernier burn de la bougie, et la voix de
  // chaque burn.
  'ALTER TABLE matches ADD COLUMN keeper_style TEXT',
  'ALTER TABLE matches ADD COLUMN keeper_model TEXT',
  'ALTER TABLE matches ADD COLUMN keeper_intro TEXT',
  'ALTER TABLE matches ADD COLUMN keeper_thought TEXT',
  'ALTER TABLE matches ADD COLUMN keeper_thought_at INTEGER',
  'ALTER TABLE matches ADD COLUMN keeper_at INTEGER',
  'ALTER TABLE matches ADD COLUMN self_last_burn INTEGER',
  'ALTER TABLE burns ADD COLUMN voice TEXT',
];

const ready = new WeakSet();

export async function ensureSchema(db) {
  if (ready.has(db)) return;
  await db.batch(CREATE.map((sql) => db.prepare(sql)));
  for (const sql of UPGRADES) {
    try {
      await db.prepare(sql).run();
    } catch (err) {
      if (!/duplicate column/i.test(String(err?.message ?? err))) throw err;
    }
  }
  await db.prepare('CREATE INDEX IF NOT EXISTS matches_cycle ON matches (cycle, seq)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS matches_creator ON matches (creator, seq)').run();
  ready.add(db);
}
