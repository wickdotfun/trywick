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
