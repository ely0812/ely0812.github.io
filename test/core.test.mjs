import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { authorization, normalize } from '../src/coupang.mjs';
import { priceDrops } from '../src/deals.mjs';

test('authorization header signs signedDate+method+path+query in UTC yyMMddTHHmmssZ', () => {
  const date = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
  const path = '/v2/providers/affiliate_open_api/apis/openapi/v1/products/search';
  const header = authorization('GET', path, 'keyword=a&limit=1', 'AK', 'SK', date);
  const expected = crypto.createHmac('sha256', 'SK').update(`260102T030405ZGET${path}keyword=a&limit=1`).digest('hex');
  assert.equal(header, `CEA algorithm=HmacSHA256, access-key=AK, signed-date=260102T030405Z, signature=${expected}`);
});

test('normalize maps API fields and keys by option (vendorItemId)', () => {
  const p = normalize({ productId: 1, productName: 'x', productPrice: '1000', productImage: 'i', productUrl: 'u', isRocket: true });
  assert.deepEqual([p.id, p.price, p.rocket, p.freeShipping], ['1', 1000, true, false]);
  const a = normalize({ productId: 9, productPrice: 7500, productUrl: 'https://link.coupang.com/re/AFFSDP?itemId=1&vendorItemId=111' });
  const b = normalize({ productId: 9, productPrice: 16100, productUrl: 'https://link.coupang.com/re/AFFSDP?itemId=2&vendorItemId=222' });
  assert.deepEqual([a.id, b.id, a.productId], ['111', '222', '9']);
});

test('priceDrops finds drops vs previous record, only for items seen on latest day', () => {
  const products = {
    a: { id: 'a', price: 800, lastSeen: '2026-01-02', history: [{ date: '2026-01-01', price: 1000 }, { date: '2026-01-02', price: 800 }] },
    b: { id: 'b', price: 990, lastSeen: '2026-01-02', history: [{ date: '2026-01-01', price: 1000 }, { date: '2026-01-02', price: 990 }] },
    c: { id: 'c', price: 100, lastSeen: '2026-01-01', history: [{ date: '2025-12-31', price: 1000 }, { date: '2026-01-01', price: 100 }] },
  };
  const drops = priceDrops(products, { minDropPercent: 5 });
  assert.deepEqual(drops.map((d) => [d.product.id, d.percent]), [['a', 20]]);
});

test('priceDrops flags record lows only with 7+ days of history', () => {
  const days = (prices) => prices.map((price, i) => ({ date: `2026-01-0${i + 1}`, price }));
  const products = {
    long: { id: 'long', price: 900, lastSeen: '2026-01-07', history: days([1000, 950, 980, 1000, 960, 990, 900]) },
    short: { id: 'short', price: 900, lastSeen: '2026-01-07', history: [{ date: '2026-01-06', price: 1000 }, { date: '2026-01-07', price: 900 }] },
  };
  const byId = Object.fromEntries(priceDrops(products, { minDropPercent: 1 }).map((d) => [d.product.id, d.recordLow]));
  assert.deepEqual(byId, { long: true, short: false });
});

test('priceDrops ignores implausibly large drops', () => {
  const products = { x: { id: 'x', price: 2000, lastSeen: '2026-01-02', history: [{ date: '2026-01-01', price: 10000 }, { date: '2026-01-02', price: 2000 }] } };
  assert.equal(priceDrops(products, { minDropPercent: 5 }).length, 0);
  assert.equal(priceDrops(products, { minDropPercent: 5, maxDropPercent: 90 }).length, 1);
});
