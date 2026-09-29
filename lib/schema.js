// Les tables de WICK. Elles sont créées automatiquement au premier passage :
// il suffit de brancher une base D1 vide, sans rien y coller à la main.
//
// Quand SCHEMA_VERSION monte, toutes les tables sont effacées au premier passage
// et le site repart de zéro (avant le lancement seulement !).
// v2 : chacun sa bougie. v3 : look unique et croissance.
// v4 : récompense de la semaine, Hall of Fame, flamme éternelle.
export const SCHEMA_VERSION = 4;

const DROP_OLD = ['state', 'acts', 'events', 'players', 'candles', 'rewards'].map((t) => `DROP TABLE IF EXISTS ${t}`);

const CREATE = [
  // Petits caches et réglages : marché, pensée du moment, version du schéma.
  'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  // Les joueurs. Jeton et phrase de 12 mots : empreintes (SHA-256) seulement.
  `CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    phrase_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    payout TEXT,
    torches INTEGER NOT NULL DEFAULT 0
  )`,
  // Les bougies, vivantes et mortes. Une seule vivante par joueur.
  // seed = le nombre d'où vient son look unique (lib/traits.js).
  // ip = empreinte salée de l'IP (jamais l'IP en clair), pour limiter les naissances.
  `CREATE TABLE IF NOT EXISTS candles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    gen INTEGER NOT NULL,
    born_at INTEGER NOT NULL,
    died_at INTEGER,
    seed INTEGER NOT NULL,
    wax REAL NOT NULL,
    growth REAL NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    last_fed INTEGER NOT NULL DEFAULT 0,
    feeds INTEGER NOT NULL DEFAULT 0,
    stage INTEGER NOT NULL DEFAULT 0,
    legacy INTEGER NOT NULL DEFAULT 0,
    torch_at INTEGER,
    ip TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS candles_player ON candles (player_id, id)',
  'CREATE INDEX IF NOT EXISTS candles_alive ON candles (died_at, born_at)',
  'CREATE INDEX IF NOT EXISTS candles_ip ON candles (ip, born_at)',
  'CREATE INDEX IF NOT EXISTS candles_torch ON candles (torch_at)',
  'CREATE INDEX IF NOT EXISTS events_candle ON events (candle, id)',
  // Une adresse de récompense ne peut appartenir qu'à un seul joueur.
  'CREATE UNIQUE INDEX IF NOT EXISTS players_payout ON players (payout) WHERE payout IS NOT NULL',
  // Les gagnants de chaque semaine (adresse publique figée au moment du tirage, et la
  // preuve du paiement quand le dev l'ajoute).
  `CREATE TABLE IF NOT EXISTS rewards (
    week INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    candle INTEGER NOT NULL,
    name TEXT NOT NULL,
    seed INTEGER NOT NULL,
    legacy INTEGER NOT NULL,
    age INTEGER NOT NULL,
    address TEXT NOT NULL,
    tx TEXT,
    at INTEGER NOT NULL,
    PRIMARY KEY (week, rank)
  )`,
  // Le fil public : naissances, repas, évolutions, extinctions.
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    who TEXT,
    candle INTEGER,
    detail TEXT
  )`,
];

async function migrate(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)').run();
  const row = await db.prepare("SELECT v FROM kv WHERE k = 'schema'").first();
  const version = row ? Number(JSON.parse(row.v)) : 1;
  const steps = version < SCHEMA_VERSION
    ? [...DROP_OLD, 'DELETE FROM kv', ...CREATE,
      `INSERT INTO kv (k, v) VALUES ('schema', '${SCHEMA_VERSION}') ON CONFLICT(k) DO UPDATE SET v = excluded.v`]
    : CREATE;
  await db.batch(steps.map((sql) => db.prepare(sql)));
}

let ready = null;

export function ensureSchema(db) {
  // Une seule fois par instance du serveur ; en cas d'échec, on réessaiera.
  ready ??= migrate(db).catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}
