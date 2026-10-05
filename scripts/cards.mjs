// Dessine les cartes de $WICK d'avance (public/cards/*.png), avec le même modèle que la page
// d'admin (lib/cards.js). À relancer quand le modèle change : npm run cards
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { FONTS, W, cardSvg, staticCards } from '../lib/cards.js';

const require = createRequire(import.meta.url);
const root = new URL('../public/', import.meta.url);
await initWasm(await readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
const fontBuffers = await Promise.all(FONTS.map((f) => readFile(new URL(`fonts/${f}`, root))));
const dataUri = async (path) => `data:image/png;base64,${(await readFile(new URL(path, root))).toString('base64')}`;
const assets = { logo: await dataUri('brand/logo.png'), wordmark: await dataUri('brand/wordmark.png') };

const only = process.argv[2];
for (const card of staticCards(process.env.TOKEN_TICKER || 'WICK')) {
  if (only && !card.file.includes(only)) continue;
  const svg = cardSvg(card.kind, card.data, assets);
  const png = new Resvg(svg, { font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: 'Geist' }, fitTo: { mode: 'width', value: W } }).render().asPng();
  await writeFile(new URL(`cards/${card.file}`, root), png);
  console.log(card.file, `${Math.round(png.length / 1024)} KB`);
}
