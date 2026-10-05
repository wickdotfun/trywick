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

// Une image (le logo d'un coin, sur l'IPFS) en PNG data: URI, recadrée au carré. null si illisible.
export async function imageData(url) {
  try {
    const bmp = await createImageBitmap(await (await fetch(url, { mode: 'cors' })).blob());
    const side = Math.min(bmp.width, bmp.height);
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 512, 512);
    return c.toDataURL('image/png');
  } catch {
    return null;
  }
}

// → un Blob PNG (1600 × 900). extra : d'autres images (le logo du coin : { coin }).
export async function renderCard(kind, data, extra = {}) {
  const { fonts, assets: base } = await boot();
  const assets = { ...base, ...extra };
  const png = new Resvg(cardSvg(kind, data, assets), {
    font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: 'Geist' }, fitTo: { mode: 'width', value: W },
  }).render().asPng();
  return new Blob([png], { type: 'image/png' });
}
