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

test('normalize maps API fields', () => {
  const p = normalize({ productId: 1, productName: 'x', productPrice: '1000', productImage: 'i', productUrl: 'u', isRocket: true });
  assert.deepEqual([p.id, p.price, p.rocket, p.freeShipping], ['1', 1000, true, false]);
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
