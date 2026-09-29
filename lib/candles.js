// La vie d'une bougie, en fonctions pures (sans base de données).
// Le serveur et le mode démo du site utilisent exactement les mêmes règles.
import { CONFIG, HOUR } from './config.js';
import { traitsFor } from './traits.js';

export const ACTIONS = ['nourrir'];

export function moodFor(change1h) {
  if (change1h == null || Number.isNaN(change1h)) return 'calme';
  return CONFIG.moods.find((m) => change1h >= m.min).key;
}

// Vitesse de croissance selon l'humeur du chart : ×1, ×1,5 ou ×2. Jamais moins.
export const growthRate = (mood) => CONFIG.growthBoost[mood] ?? 1;

export function stageIndexFor(growthMs) {
  let idx = 0;
  CONFIG.stages.forEach((s, i) => { if (growthMs >= s.age) idx = i; });
  return idx;
}

// La cire fond toujours à la même vitesse, quel que soit le chart.
export const waxLost = (from, to) => Math.max(0, to - from) * (CONFIG.waxDecayPerHour / HOUR);

export function newCandle({ id, playerId, name, color, gen = 1, seed = 0, legacy = false }, now) {
  return {
    id, playerId, name, color, gen, seed, legacy, torchAt: null,
    bornAt: now, diedAt: null,
    wax: CONFIG.waxAtBirth, growth: 0, updatedAt: now,
    lastFed: 0, feeds: 0, stage: 0,
  };
}

// Fait passer le temps. Renvoie la bougie à jour et ce qui s'est passé (mort, évolution).
export function advance(candle, now, mood) {
  if (candle.diedAt || now <= candle.updatedAt) return { candle, events: [] };
  const events = [];
  const c = { ...candle };
  const dt = now - c.updatedAt;
  const lost = waxLost(c.updatedAt, now);
  if (lost >= c.wax) {
    // Elle s'est éteinte au moment précis où sa cire est tombée à zéro.
    const lived = (c.wax / CONFIG.waxDecayPerHour) * HOUR;
    c.growth += lived * growthRate(mood);
    c.diedAt = Math.round(c.updatedAt + lived);
    c.wax = 0;
    c.updatedAt = now;
    events.push({ kind: 'died', candle: c });
    return { candle: c, events };
  }
  c.wax -= lost;
  c.growth += dt * growthRate(mood);
  c.updatedAt = now;
  const stage = stageIndexFor(c.growth);
  if (stage > c.stage) {
    c.stage = stage;
    if (stage === CONFIG.stages.length - 1) c.torchAt = now;
    events.push({ kind: 'evolved', candle: c, detail: CONFIG.stages[stage].key });
  }
  return { candle: c, events };
}

export function cooldownsFor(candle, now) {
  if (!candle || candle.diedAt) return { nourrir: 0 };
  return { nourrir: Math.max(0, candle.lastFed + CONFIG.cooldown.nourrir - now) };
}

// Un geste sur SA bougie (déjà avancée jusqu'à `now`).
export function applyAction(candle, action, now) {
  if (!ACTIONS.includes(action)) return { error: 'unknown_action' };
  if (!candle || candle.diedAt) return { error: 'no_candle' };
  if (cooldownsFor(candle, now)[action] > 0) return { error: 'cooldown' };
  return {
    candle: {
      ...candle,
      wax: Math.min(CONFIG.waxMax, candle.wax + CONFIG.feedWax),
      lastFed: now,
      feeds: candle.feeds + 1,
    },
  };
}

// Ce que le navigateur reçoit.
export function candleView(candle, now, mood) {
  if (!candle) return null;
  const alive = !candle.diedAt;
  const ageMs = (alive ? now : candle.diedAt) - candle.bornAt;
  const stageIdx = alive ? stageIndexFor(candle.growth) : candle.stage;
  const next = alive ? CONFIG.stages[stageIdx + 1] : null;
  const boost = alive ? growthRate(mood) : 1;
  return {
    id: candle.id,
    name: candle.name,
    color: candle.color,
    gen: candle.gen,
    look: traitsFor(candle.seed, candle.legacy),
    // Devenue torche un jour : elle est au Hall of Fame pour toujours.
    torchAt: candle.torchAt ?? null,
    alive,
    stage: CONFIG.stages[stageIdx].key,
    stageIndex: stageIdx,
    wax: Math.round(candle.wax * 10) / 10,
    waxMax: CONFIG.waxMax,
    bornAt: candle.bornAt,
    diedAt: candle.diedAt,
    ageMs,
    growthMs: Math.round(candle.growth),
    boost,
    decayPerHour: CONFIG.waxDecayPerHour,
    // Sans soins, dans combien de temps elle s'éteindrait.
    burnoutMs: alive ? Math.round((candle.wax / CONFIG.waxDecayPerHour) * HOUR) : 0,
    // Prochaine forme, au rythme de croissance actuel.
    nextStage: next ? { key: next.key, inMs: Math.round((next.age - candle.growth) / boost) } : null,
    feeds: candle.feeds,
    hungry: alive && candle.wax < CONFIG.hungryBelow,
  };
}
