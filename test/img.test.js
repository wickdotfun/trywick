import { test } from 'node:test';
import assert from 'node:assert/strict';
import { img, isCid } from '../src/api/img.js';
import { imgSrc } from '../src/client/util.js';

const CID = 'bafkreih4e3ynrptzjvf2k5ifh7bwb7c6nfazd2cmkfyhoyg3yhe7yjeyxe';
const req = (cid) => ({ request: new Request(`https://trywick.fun/api/img?cid=${cid}`), env: {} });

test('coin logos on IPFS go through the site; other https images stay as they are', () => {
  assert.equal(imgSrc(`https://ipfs.io/ipfs/${CID}`), `/api/img?cid=${CID}`);
  assert.equal(imgSrc(`https://gateway.pinata.cloud/ipfs/${CID}?x=1`), `/api/img?cid=${CID}`);
  assert.equal(imgSrc('https://example.com/a.png'), 'https://example.com/a.png');
  assert.equal(imgSrc('javascript:alert(1)'), null);
  assert.equal(imgSrc(null), null);
  assert.ok(isCid(CID));
  assert.ok(!isCid('../../etc'));
});

test('the image proxy tries the next gateway when one fails, and never serves anything but an image', async () => {
  const tried = [];
  globalThis.fetch = async (url) => {
    tried.push(String(url));
    if (tried.length === 1) return new Response('slow down', { status: 429 });
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
  };
  const res = await img(req(CID));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.match(res.headers.get('cache-control'), /immutable/);
  assert.equal(tried.length, 2);

  globalThis.fetch = async () => new Response('<svg onload=alert(1)>', { headers: { 'content-type': 'image/svg+xml' } });
  assert.equal((await img(req(CID))).status, 404);
  assert.equal((await img(req('nope'))).status, 400);
});
