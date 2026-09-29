// Le look de chaque bougie : une couleur de cire, une couleur de flamme et parfois un
// accessoire. Pas de rareté : juste des bougies différentes (8 × 6 × 5 = 240 looks),
// tirées d'un seul nombre au hasard à la naissance (seed). Le serveur, le site et le
// mode démo retrouvent le même look.

// [clé, couleur, poids]
export const TRAITS = {
  wax: [
    ['ivoire', '#f6e6cc', 1], ['creme', '#f1d3a6', 1], ['rose', '#f6b3c6', 1], ['menthe', '#b4e8cf', 1],
    ['lavande', '#cbb6f0', 1], ['ciel', '#b3d8f3', 1], ['peche', '#f7bf95', 1], ['ardoise', '#9a93a6', 1],
  ],
  flame: [
    ['orange', '#ff9a2e', 1], ['ambre', '#ffc23d', 1], ['rose', '#ff5fa2', 1], ['bleue', '#45b4ff', 1],
    ['verte', '#3ddc84', 1], ['violette', '#a46bff', 1],
  ],
  // Une bougie sur trois environ n'a pas d'accessoire.
  accessory: [
    ['aucun', null, 2], ['noeud', null, 1], ['lunettes', null, 1], ['echarpe', null, 1], ['fleur', null, 1],
  ],
};

// La flamme éternelle : débloquée pour les joueurs qui ont déjà mené une bougie jusqu'à
// la torche. Elle est dorée ; le reste du look ne change pas.
export const ETERNAL_FLAME = { key: 'eternelle', color: '#ffd86b' };

// Petit générateur déterministe (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(list, r) {
  const total = list.reduce((s, x) => s + x[2], 0);
  let x = r * total;
  for (const item of list) {
    x -= item[2];
    if (x < 0) return { key: item[0], color: item[1] };
  }
  const last = list[list.length - 1];
  return { key: last[0], color: last[1] };
}

export function traitsFor(seed, legacy = false) {
  const r = rng(seed);
  const wax = pickWeighted(TRAITS.wax, r());
  const flame = pickWeighted(TRAITS.flame, r());
  const accessory = pickWeighted(TRAITS.accessory, r()).key;
  return {
    wax,
    flame: legacy ? { ...ETERNAL_FLAME } : flame,
    accessory,
    legacy,
  };
}

export function randomSeed() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}
