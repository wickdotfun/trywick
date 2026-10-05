// Dessiner une carte de $WICK dans le navigateur (la page d'admin : les tokens lockés), avec le
// même modèle que les cartes dessinées d'avance (lib/cards.js) et le même moteur (resvg).
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { FONTS, W, cardSvg } from '../../lib/cards.js';

let ready = null;
const dataUri = async (path) => {
  const blob = await (await fetch(path)).blob();
  return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
};
function boot() {
  ready ??= (async () => {
    await initWasm(fetch('/build/resvg.wasm'));
    const fonts = await Promise.all(FONTS.map(async (f) => new Uint8Array(await (await fetch(`/fonts/${f}`)).arrayBuffer())));
    return { fonts, assets: { logo: await dataUri('/brand/logo.png'), wordmark: await dataUri('/brand/wordmark.png') } };
  })();
  return ready;
}

// → un Blob PNG (1600 × 900).
export async function renderCard(kind, data) {
  const { fonts, assets } = await boot();
  const png = new Resvg(cardSvg(kind, data, assets), {
    font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: 'Geist' }, fitTo: { mode: 'width', value: W },
  }).render().asPng();
  return new Blob([png], { type: 'image/png' });
}
