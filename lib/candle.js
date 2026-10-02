// La bougie, en fonctions pures (partagées par le serveur, la démo et les tests).
//
// Les allumettes sont numérotées dans l'ordre où elles s'allument (seq = 1, 2, 3…).
// Avec 1000 allumettes par bougie : la bougie n° 1 prend les allumettes 1 à 1000,
// la n° 2 les allumettes 1001 à 2000, etc. La 1000e est « la dernière allumette » de la n° 1.

export function candleState(total, perCandle) {
  const burnedOut = Math.floor(total / perCandle);
  const matches = total - burnedOut * perCandle;
  return {
    number: burnedOut + 1,
    matches,
    perCandle,
    melted: matches / perCandle,
    burnedOut,
    // Les allumettes de la bougie en cours ont un seq > firstSeq - 1.
    firstSeq: burnedOut * perCandle + 1,
  };
}

export function candleOfSeq(seq, perCandle) {
  return Math.ceil(seq / perCandle);
}
