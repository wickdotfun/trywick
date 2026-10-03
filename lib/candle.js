// La bougie, en fonctions pures (partagées par le serveur, la démo et les tests).
//
// Une bougie fond avec le temps (30 minutes au plus) et avec les allumettes
// (chacune lui enlève 1 minute). Quand elle a fini de fondre : buyback, puis une nouvelle.

// cycle : { startedAt, matches } ; timing : { durationMs, matchMs }.
export function cycleProgress(cycle, now, { durationMs, matchMs }) {
  const burned = Math.max(0, now - cycle.startedAt) + cycle.matches * matchMs;
  const remainingMs = Math.max(0, durationMs - burned);
  return {
    melted: Math.min(1, burned / durationMs),
    remainingMs,
    endsAt: now + remainingMs,
    done: remainingMs === 0,
  };
}

// La bougie de $WICK : elle ne se reconstruit jamais. Chaque bougie représente une part de la
// supply (0,5 % par défaut) ; elle fond à mesure que $WICK est brûlé, et quand elle a fini de
// fondre, ce palier de supply est brûlé pour de bon. pct = la part de la supply déjà brûlée.
export function supplyCandle(pct, stepPct) {
  const p = Math.max(0, Number(pct) || 0);
  const consumed = Math.floor(p / stepPct + 1e-9);
  return {
    number: consumed + 1,
    melted: Math.min(1, (p - consumed * stepPct) / stepPct),
    burnedPct: p,
    stepPct,
    consumed,
  };
}
