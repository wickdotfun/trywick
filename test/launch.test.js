import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateImage, validateLaunch } from '../lib/launch.js';

const CREATOR = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const MINT = 'So11111111111111111111111111111111111111112';
const base = { name: 'Wick Cat', symbol: 'wcat', creator: CREATOR, mint: MINT };

test('a valid launch is cleaned up', () => {
  const { value, error } = validateLaunch({ ...base, symbol: '$wcat', description: '  hi  ', devBuy: '0.12345' });
  assert.equal(error, undefined);
  assert.equal(value.symbol, 'WCAT');
  assert.equal(value.description, 'hi');
  assert.equal(value.devBuy, 0.1235);
  assert.equal(value.twitter, '');
});

test('bad fields are refused', () => {
  assert.equal(validateLaunch({ ...base, name: '' }).error, 'bad_name');
  assert.equal(validateLaunch({ ...base, name: 'x'.repeat(33) }).error, 'bad_name');
  assert.equal(validateLaunch({ ...base, symbol: 'TOO-LONG' }).error, 'bad_symbol');
  assert.equal(validateLaunch({ ...base, symbol: 'ABCDEFGHIJK' }).error, 'bad_symbol');
  assert.equal(validateLaunch({ ...base, twitter: 'http://x.com/a' }).error, 'bad_twitter');
  assert.equal(validateLaunch({ ...base, website: 'javascript:alert(1)' }).error, 'bad_website');
  assert.equal(validateLaunch({ ...base, devBuy: '-1' }).error, 'bad_dev_buy');
  assert.equal(validateLaunch({ ...base, devBuy: '6' }).error, 'bad_dev_buy');
  assert.equal(validateLaunch({ ...base, devBuy: 'abc' }).error, 'bad_dev_buy');
  assert.equal(validateLaunch({ ...base, creator: 'nope' }).error, 'bad_creator');
  assert.equal(validateLaunch({ ...base, mint: CREATOR }).error, 'bad_mint');
});

test('https links are kept', () => {
  const { value } = validateLaunch({ ...base, twitter: 'https://x.com/trywickdotfun', telegram: 'https://t.me/wick' });
  assert.equal(value.twitter, 'https://x.com/trywickdotfun');
  assert.equal(value.telegram, 'https://t.me/wick');
});

test('images: type and size', () => {
  assert.equal(validateImage(null), 'no_image');
  assert.equal(validateImage(new Blob(['x'], { type: 'text/html' })), 'bad_image_type');
  assert.equal(validateImage(new Blob([new Uint8Array(2_000_000)], { type: 'image/png' })), 'image_too_big');
  assert.equal(validateImage(new Blob([new Uint8Array(10)], { type: 'image/png' })), null);
});
