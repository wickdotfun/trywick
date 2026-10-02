// Ce qu'on vérifie avant de lancer un coin : le formulaire du créateur.
import { CONFIG } from './config.js';

const PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isPubkey(s) {
  return typeof s === 'string' && PUBKEY.test(s);
}

function text(v) {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
}

function link(v) {
  const s = text(v);
  if (!s) return { ok: true, value: '' };
  if (s.length > CONFIG.limits.url) return { ok: false };
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? { ok: true, value: u.href } : { ok: false };
  } catch {
    return { ok: false };
  }
}

// fields : les champs texte du formulaire. Renvoie { value } ou { error }.
export function validateLaunch(fields, { maxDevBuy = CONFIG.maxDevBuySol } = {}) {
  const { limits } = CONFIG;
  const name = text(fields.name);
  const symbol = text(fields.symbol).replace(/^\$/, '').toUpperCase();
  const description = text(fields.description);

  if (!name || [...name].length > limits.name) return { error: 'bad_name' };
  if (!/^[A-Z0-9]+$/.test(symbol) || symbol.length > limits.symbol) return { error: 'bad_symbol' };
  if ([...description].length > limits.description) return { error: 'bad_description' };

  const links = {};
  for (const key of ['twitter', 'telegram', 'website']) {
    const l = link(fields[key]);
    if (!l.ok) return { error: `bad_${key}` };
    links[key] = l.value;
  }

  const raw = text(fields.devBuy ?? '0') || '0';
  const devBuy = Number(raw);
  if (!Number.isFinite(devBuy) || devBuy < 0 || devBuy > maxDevBuy) return { error: 'bad_dev_buy' };

  const creator = text(fields.creator);
  const mint = text(fields.mint);
  if (!isPubkey(creator)) return { error: 'bad_creator' };
  if (!isPubkey(mint) || mint === creator) return { error: 'bad_mint' };

  return {
    value: {
      name, symbol, description, ...links,
      devBuy: Math.round(devBuy * 1e4) / 1e4,
      creator, mint,
    },
  };
}

export function validateImage(file) {
  if (!file || typeof file === 'string') return 'no_image';
  if (!CONFIG.image.types.includes(file.type)) return 'bad_image_type';
  if (file.size > CONFIG.image.maxBytes) return 'image_too_big';
  return null;
}
