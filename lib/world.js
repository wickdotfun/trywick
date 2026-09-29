// Toutes les bougies en base : les faire vieillir, les lire, les compter.
import { advance, candleView, growthRate, newCandle } from './candles.js';
import { CONFIG, DAY, HOUR } from './config.js';
import { lastDeadline, nextDeadline, shortAddress } from './rewards.js';
import { addEvents, getKv, setKv } from './store.js';
import { randomSeed, traitsFor } from './traits.js';

// Ligne SQL → bougie (mêmes champs que lib/candles.js).
export function fromRow(r) {
  if (!r) return null;
  return {
    id: r.id, playerId: r.player_id, name: r.name, color: r.color, gen: r.gen, seed: r.seed,
    bornAt: r.born_at, diedAt: r.died_at, wax: r.wax, growth: r.growth, updatedAt: r.updated_at,
    lastFed: r.last_fed, feeds: r.feeds, stage: r.stage, legacy: Boolean(r.legacy), torchAt: r.torch_at,
    feedDay: r.feed_day ?? 0, feedStreak: r.feed_streak ?? 0,
  };
}

// Le temps passe pour toutes les bougies vivantes, en quelques requêtes seulement :
// la cire baisse, elles grandissent (plus vite si le chart monte), celles à zéro
// s'éteignent, celles qui ont assez grandi évoluent.
// Appelé au plus une fois par minute par les visites, et toutes les 10 min par le cron.
export async function tickWorld(env, now, mood, force = false) {
  const db = env.DB;
  if (!force) {
    const last = await getKv(db, 'tick');
    if (last && now - last.at < CONFIG.tickEveryMs) return;
  }
  await setKv(db, 'tick', { at: now });

  const base = CONFIG.waxDecayPerHour / HOUR;
  await db.prepare(`UPDATE candles
    SET wax = MAX(0, wax - (?1 - updated_at) * ?2),
        growth = growth + (?1 - updated_at) * ?3,
        updated_at = ?1
    WHERE died_at IS NULL AND updated_at < ?1`).bind(now, base, growthRate(mood)).run();

  // RETURNING : chaque mort ou évolution n'est annoncée qu'une fois, même si deux ticks se croisent.
  const { results: dead } = await db.prepare(
    'UPDATE candles SET died_at = ?1 WHERE died_at IS NULL AND wax <= 0 RETURNING id, name, born_at',
  ).bind(now).all();
  const events = dead.map((c) => ({ kind: 'died', who: c.name, candle: c.id, detail: now - c.born_at }));

  const last = CONFIG.stages.length - 1;
  for (let i = 1; i <= last; i++) {
    const { results } = await db.prepare(`UPDATE candles SET stage = ?1, torch_at = CASE WHEN ?1 = ?3 THEN ?4 ELSE torch_at END
      WHERE died_at IS NULL AND stage < ?1 AND growth >= ?2 RETURNING id, name, player_id`,
    ).bind(i, CONFIG.stages[i].age, last, now).all();
    events.push(...results.map((c) => ({ kind: 'evolved', who: c.name, candle: c.id, detail: CONFIG.stages[i].key })));
    // Une torche : son joueur débloque la flamme éternelle pour ses prochaines bougies.
    if (i === last && results.length) {
      await db.batch(results.map((c) => db.prepare('UPDATE players SET torches = torches + 1 WHERE id = ?').bind(c.player_id)));
    }
  }
  await addEvents(db, now, events);
  await rewardTick(env, now);
}

// Le tirage de la semaine, une seule fois par semaine (seulement si REWARD_SHARE est réglé).
// Les gagnants : les 3 plus vieilles bougies vivantes dont le joueur a donné une adresse.
async function rewardTick(env, now) {
  if (!env.REWARD_SHARE) return;
  const db = env.DB;
  const deadline = lastDeadline(now);
  const done = await getKv(db, 'reward_week');
  // Première activation : pas de tirage rétroactif, on attend le prochain dimanche.
  if (done == null || done >= deadline) {
    if (done == null) await setKv(db, 'reward_week', deadline);
    return;
  }
  await setKv(db, 'reward_week', deadline);
  const { results: candidates } = await db.prepare(`SELECT c.id, c.name, c.seed, c.legacy, c.born_at, c.ip, p.payout FROM candles c
    JOIN players p ON p.id = c.player_id
    WHERE c.died_at IS NULL AND p.payout IS NOT NULL AND c.born_at <= ?1
    ORDER BY c.born_at ASC LIMIT 50`).bind(deadline).all();
  const results = pickWinners(candidates, CONFIG.reward.winners);
  if (!results.length) return;
  const inserted = await db.batch(results.map((c, i) => db.prepare(`INSERT OR IGNORE INTO rewards
    (week, rank, candle, name, seed, legacy, age, address, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING rank`)
    .bind(deadline, i + 1, c.id, c.name, c.seed, c.legacy, deadline - c.born_at, c.payout, now)));
  const events = results.map((c, i) => ({ kind: 'reward', who: c.name, candle: c.id, detail: i + 1 }))
    .filter((_, i) => inserted[i].results.length);
  await addEvents(db, now, events);
  cache = null;
}

export async function candleById(db, id) {
  return fromRow(await db.prepare('SELECT * FROM candles WHERE id = ?').bind(id).first());
}

// La dernière bougie du joueur (vivante, ou la dernière morte).
export async function latestCandle(db, playerId) {
  return fromRow(await db.prepare('SELECT * FROM candles WHERE player_id = ? ORDER BY id DESC LIMIT 1').bind(playerId).first());
}

// Lit une bougie et la fait vieillir jusqu'à maintenant (sans écrire, sauf si elle vient de mourir).
export async function freshCandle(env, candle, now, mood) {
  if (!candle) return null;
  const { candle: c, events } = advance(candle, now, mood);
  const died = events.find((e) => e.kind === 'died');
  if (died) {
    const res = await env.DB.prepare('UPDATE candles SET died_at = ?, wax = 0, growth = ?, updated_at = ? WHERE id = ? AND died_at IS NULL')
      .bind(c.diedAt, c.growth, now, c.id).run();
    if (res.meta.changes === 1) {
      await addEvents(env.DB, c.diedAt, [{ kind: 'died', who: c.name, candle: c.id, detail: c.diedAt - c.bornAt }]);
    }
  }
  return c;
}

export async function saveCandle(db, c) {
  // La forme (stage) n'est pas écrite ici : c'est le tick qui l'annonce dans le fil,
  // inscrit les torches au Hall of Fame et débloque la flamme éternelle.
  await db.prepare(`UPDATE candles SET wax = ?, growth = ?, updated_at = ?, last_fed = ?, feeds = ?,
    feed_day = ?, feed_streak = ? WHERE id = ? AND died_at IS NULL`)
    .bind(c.wax, c.growth, c.updatedAt, c.lastFed, c.feeds, c.feedDay ?? 0, c.feedStreak ?? 0, c.id).run();
}

export async function birthsFromIp(db, ip, now) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM candles WHERE ip = ? AND born_at > ?').bind(ip, now - DAY).first();
  return row?.n ?? 0;
}

// Chaque joueur n'a qu'UNE bougie : quand elle s'est éteinte, on la ranime avec le
// même nom et le même look (même graine). Seuls son âge et sa croissance repartent
// de zéro ; « gen » compte ses vies (II, III…).
export async function insertCandle(db, player, ip, now) {
  const prev = await db.prepare('SELECT seed, (SELECT COUNT(*) FROM candles WHERE player_id = ?1) AS n FROM candles WHERE player_id = ?1 ORDER BY id ASC LIMIT 1')
    .bind(player.id).first();
  const c = newCandle({
    playerId: player.id, name: player.name, color: player.color, gen: (prev?.n ?? 0) + 1, seed: prev?.seed ?? randomSeed(),
    legacy: (player.torches ?? 0) > 0,
  }, now);
  const row = await db.prepare(`INSERT INTO candles (player_id, name, color, gen, seed, legacy, born_at, wax, updated_at, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(c.playerId, c.name, c.color, c.gen, c.seed, c.legacy ? 1 : 0, now, c.wax, now, ip).first();
  return { ...c, id: row.id };
}

// Petite fiche publique d'une bougie pour les listes (classement, cimetière).
function listItem(r, now) {
  const alive = r.died_at == null;
  const look = traitsFor(r.seed, Boolean(r.legacy));
  return {
    id: r.id, name: r.name, color: look.flame.color, gen: r.gen, alive,
    legacy: look.legacy, torchAt: r.torch_at ?? null,
    stage: CONFIG.stages[r.stage]?.key ?? 'bougie',
    ageMs: (alive ? now : r.died_at) - r.born_at,
    growthMs: Math.round(r.growth),
    wax: Math.round(r.wax),
    diedAt: r.died_at,
  };
}

// Tout ce que la page montre de la communauté. Gardé 10 s en mémoire :
// avec beaucoup de visiteurs, la base n'est pas interrogée à chaque fois.
let cache = null;
export async function community(env, now) {
  const db = env.DB;
  if (cache && now - cache.at < 10_000) return cache.data;
  const [counts, oldest, graveyard, record, around, hall, contenders, winners, tallest] = await db.batch([
    db.prepare(`SELECT
        SUM(CASE WHEN died_at IS NULL THEN 1 ELSE 0 END) AS alive,
        COUNT(*) AS total,
        SUM(CASE WHEN died_at > ?1 THEN 1 ELSE 0 END) AS died24h,
        SUM(CASE WHEN born_at > ?1 THEN 1 ELSE 0 END) AS born24h,
        SUM(CASE WHEN died_at IS NULL AND wax < ?2 THEN 1 ELSE 0 END) AS hungry
      FROM candles`).bind(now - DAY, CONFIG.hungryBelow),
    db.prepare('SELECT * FROM candles WHERE died_at IS NULL ORDER BY born_at ASC LIMIT 20'),
    db.prepare('SELECT * FROM candles WHERE died_at IS NOT NULL ORDER BY died_at DESC LIMIT 12'),
    db.prepare('SELECT * FROM candles ORDER BY (COALESCE(died_at, ?1) - born_at) DESC LIMIT 1').bind(now),
    db.prepare('SELECT id, seed, legacy, stage FROM candles WHERE died_at IS NULL ORDER BY born_at DESC LIMIT 60'),
    db.prepare('SELECT * FROM candles WHERE torch_at IS NOT NULL ORDER BY torch_at ASC LIMIT 30'),
    db.prepare(`SELECT c.* FROM candles c JOIN players p ON p.id = c.player_id
      WHERE c.died_at IS NULL AND p.payout IS NOT NULL ORDER BY c.born_at ASC LIMIT ?`).bind(CONFIG.reward.winners),
    db.prepare('SELECT * FROM rewards WHERE week = (SELECT MAX(week) FROM rewards) ORDER BY rank'),
    // Les plus grandes flammes : la croissance (l'âge, boosté par le chart et les quêtes).
    db.prepare('SELECT * FROM candles WHERE died_at IS NULL ORDER BY growth DESC LIMIT 20'),
  ]);
  const c = counts.results[0] || {};
  const data = {
    stats: {
      alive: c.alive ?? 0, total: c.total ?? 0, died24h: c.died24h ?? 0,
      born24h: c.born24h ?? 0, hungry: c.hungry ?? 0,
    },
    oldest: oldest.results.map((r) => listItem(r, now)),
    tallest: tallest.results.map((r) => listItem(r, now)),
    graveyard: graveyard.results.map((r) => listItem(r, now)),
    record: record.results[0] ? listItem(record.results[0], now) : null,
    // Les flammèches autour de ta bougie ont la couleur de flamme de chaque bougie.
    around: around.results.map((r) => ({ id: String(r.id), color: traitsFor(r.seed, Boolean(r.legacy)).flame.color, level: r.stage + 1 })),
    hallOfFame: hall.results.map((r) => listItem(r, now)),
    // La récompense de la semaine : visible seulement si le dev l'a activée (REWARD_SHARE).
    reward: env.REWARD_SHARE ? {
      share: env.REWARD_SHARE,
      pool: env.REWARD_POOL || null,
      nextAt: nextDeadline(now),
      contenders: contenders.results.map((r) => listItem(r, now)),
      last: winners.results.length ? {
        week: winners.results[0].week,
        winners: winners.results.map((w) => {
          const look = traitsFor(w.seed, Boolean(w.legacy));
          return {
            rank: w.rank, id: w.candle, name: w.name, color: look.flame.color, ageMs: w.age,
            address: shortAddress(w.address), tx: w.tx,
          };
        }),
      } : null,
    } : null,
  };
  cache = { at: now, data };
  return data;
}

// Les gagnants : les plus vieilles bougies, mais jamais deux de la même IP (empreinte)
// ni deux avec la même adresse : quelqu'un qui a 6 comptes chez lui ne peut gagner qu'une fois.
export function pickWinners(candidates, n) {
  const ips = new Set();
  const addresses = new Set();
  const out = [];
  for (const c of candidates) {
    if (ips.has(c.ip) || addresses.has(c.payout)) continue;
    ips.add(c.ip);
    addresses.add(c.payout);
    out.push(c);
    if (out.length === n) break;
  }
  return out;
}

// Mon rang parmi les bougies qui peuvent gagner cette semaine (vivantes, avec une adresse).
export async function rewardRank(db, candle, playerRow) {
  if (!candle || candle.diedAt || !playerRow?.payout) return null;
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM candles c JOIN players p ON p.id = c.player_id
    WHERE c.died_at IS NULL AND p.payout IS NOT NULL AND c.born_at < ?`).bind(candle.bornAt).first();
  return (row?.n ?? 0) + 1;
}

export function forgetCommunityCache() {
  cache = null;
}

export { candleView };
