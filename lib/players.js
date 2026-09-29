// Les joueurs : chacun a un nom (celui de sa bougie), une couleur et une
// « phrase de flamme » de 12 mots pour la retrouver sur n'importe quel appareil.
//
// La phrase utilise NOS mots (anglais) et AUCUN des 2048 mots des seeds de wallet
// (BIP39) : une phrase WICK ne peut jamais être une vraie seed, et une vraie seed
// collée par erreur est refusée avant même d'être envoyée.
// On ne stocke que des empreintes (SHA-256), jamais la phrase ni le jeton en clair.

export const PHRASE_WORDS = 12;

export const WORDS = `
acorn alpaca amber anchovy anvil apricot archer armadillo axolotl badger bagel banjo barley basil
beacon beagle beaver bedrock beetle bellows biscuit bison blizzard blueberry bluebird bobcat
bonfire bonsai boulder bramble brownie buckle bumblebee bungalow burrito butterfly buttercup button
camel caramel cardinal carrot cashew catfish cavern cedar cello chameleon cheddar cheetah chestnut
chipmunk citrus clover cobalt comet compass condor cookie cornet cottage cougar cranberry crayon
croissant crocus crumpet cupcake cyclone daffodil dahlia daisy dandelion dewdrop dingo doodle
dragonfly driftwood drizzle dumpling eclipse eggplant elm ember emerald falcon fennel ferret fiddle
firefly flamingo flannel flute fudge gazelle gecko geyser glacier glimmer goblin goldfish gondola
gopher granite grapefruit gravy griffin guava gumdrop hammock hazel heron hibiscus hickory honeybee
hopscotch hummingbird husky iceberg iguana jackal jasmine jellybean jellyfish juniper kayak kettle
koala kumquat lagoon lantern lavender lemonade lettuce lighthouse lilac lily lime llama locket
lollipop lotus lynx macaron magpie mallard mantis marmot marshmallow meerkat melon meteor mimosa
minnow mistletoe mitten mocha mongoose moose narwhal nectar nutmeg oatmeal octopus okapi orchid
osprey otter pancake papaya parakeet parsley peach peacock pebble penguin periwinkle petal pickle
pinecone pistachio pixie plum polka pomelo poodle popcorn poppy porcupine pretzel primrose puffin
quail quartz quokka radish rainbow raisin raspberry reindeer rhubarb robin rooster rosemary ruby
saffron salamander sapphire sardine scone seahorse seashell sequoia sesame shamrock sherbet sparrow
spinach starfish stingray strawberry sunflower sycamore taco tadpole tangerine teapot thimble
thistle toffee toucan tulip turnip turquoise tuxedo twig violet waffle walrus wasabi willow wombat
woodpecker yak yodel zucchini zeppelin pinwheel snowflake raincoat sailboat treehouse moonbeam
sunbeam starlight campfire
`.trim().split(/\s+/);

const NOUNS = ['Ember', 'Wick', 'Glow', 'Spark', 'Flicker', 'Cinder', 'Candle', 'Taper', 'Firefly', 'Torch',
  'Match', 'Flame', 'Comet', 'Aurora', 'Lantern', 'Beacon'];
const ADJECTIVES = ['Shy', 'Rebel', 'Hasty', 'Cheeky', 'Loyal', 'Stubborn', 'Wild', 'Golden', 'Giggly', 'Sly',
  'Chilly', 'Brave', 'Crafty', 'Serene', 'Nocturnal', 'Fierce', 'Jolly', 'Quiet', 'Proud', 'Hungry', 'Curious',
  'Tenacious', 'Dreamy', 'Playful', 'Sparkly', 'Sleepless', 'Zen', 'Lunar', 'Cosmic', 'Electric', 'Fearless',
  'Lazy', 'Chatty', 'Based', 'Diamond', 'Bullish', 'Comfy', 'Sneaky'];
export const COLORS = ['#ff9a2e', '#ff5fa2', '#5fd0ff', '#b58cff', '#7dff8a', '#ffd23f', '#ff6b5f',
  '#4dffd8', '#ff8cf0', '#a8ff3f'];

function randomInt(max) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function newPhrase() {
  return Array.from({ length: PHRASE_WORDS }, () => WORDS[randomInt(WORDS.length)]).join(' ');
}

export function newName() {
  const n = String(randomInt(10000)).padStart(4, '0');
  return `${NOUNS[randomInt(NOUNS.length)]} ${ADJECTIVES[randomInt(ADJECTIVES.length)]} #${n}`;
}

// Accepte majuscules, accents, virgules, retours à la ligne, numéros (« 1. chat 2. lune »…).
export function normalizePhrase(input) {
  if (typeof input !== 'string') return null;
  const words = input.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z]+/).filter(Boolean);
  if (words.length !== PHRASE_WORDS || !words.every((w) => WORDS.includes(w))) return null;
  return words.join(' ');
}

export async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const tokenHash = (token) => sha256(`wick-token:${token}`);
const phraseHash = (phrase) => sha256(`wick-phrase:${phrase}`);

// Ce que le joueur voit de lui-même : son adresse de récompense (publique) et ses torches.
function publicPlayer(row) {
  return { id: row.id, name: row.name, color: row.color, payout: row.payout ?? null, torches: row.torches ?? 0 };
}

export function bearer(request) {
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Bearer ([0-9a-f]{64})$/);
  return m ? m[1] : null;
}

export async function playerFromRequest(db, request, now) {
  const token = bearer(request);
  if (!token) return null;
  const row = await db.prepare('SELECT * FROM players WHERE token_hash = ?').bind(await tokenHash(token)).first();
  if (!row) return null;
  if (now - row.last_seen > 3600_000) {
    await db.prepare('UPDATE players SET last_seen = ? WHERE id = ?').bind(now, row.id).run();
  }
  return { row, view: publicPlayer(row) };
}

// L'adresse Solana PUBLIQUE où recevoir une récompense (déjà validée par l'appelant).
export async function setPayout(db, row, address) {
  await db.prepare('UPDATE players SET payout = ? WHERE id = ?').bind(address, row.id).run();
  return publicPlayer({ ...row, payout: address });
}

export async function createPlayer(db, now) {
  const token = randomHex(32);
  const phrase = newPhrase();
  const row = {
    id: randomHex(8),
    name: newName(),
    color: COLORS[randomInt(COLORS.length)],
    payout: null,
    torches: 0,
  };
  await db.prepare(`INSERT INTO players (id, name, color, token_hash, phrase_hash, created_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(row.id, row.name, row.color, await tokenHash(token), await phraseHash(phrase), now, now).run();
  return { row, view: publicPlayer(row), token, phrase };
}

// Retrouver sa flamme avec sa phrase : on donne un nouveau jeton à cet appareil.
// (Les autres appareils déjà connectés gardent le leur jusqu'à la prochaine récupération.)
export async function recoverPlayer(db, phrase, now) {
  const normalized = normalizePhrase(phrase);
  if (!normalized) return { error: 'bad_phrase' };
  const row = await db.prepare('SELECT * FROM players WHERE phrase_hash = ?').bind(await phraseHash(normalized)).first();
  if (!row) return { error: 'unknown_phrase' };
  const token = randomHex(32);
  await db.prepare('UPDATE players SET token_hash = ?, last_seen = ? WHERE id = ?').bind(await tokenHash(token), now, row.id).run();
  return { token, player: publicPlayer(row) };
}
