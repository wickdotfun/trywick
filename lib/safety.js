// Ce qu'on ne fabrique pas, quoi qu'on demande (idées Spark, prompts de caractère, textes de l'IA) :
// contenu sexuel, mineurs, haine.
const BLOCKED = /\b(nsfw|nude|nudes|naked|porn\w*|sex\w*|hentai|loli\w*|child\w*|kids?|minors?|underage|teen\w*|nazi\w*|hitler|kkk|rape\w*|gore|terroris\w*|isis|slur\w*|n[i1]gg\w*|f[a4]gg?\w*|retard\w*)\b/i;
export const blocked = (text) => BLOCKED.test(String(text ?? ''));
