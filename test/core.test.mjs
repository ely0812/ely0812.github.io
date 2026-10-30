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


test('guide titles use real brands/prices and rotate three patterns', async () => {
  const { brandsOf, guideTitle } = await import('../src/titles.mjs');
  const items = [{ name: '탁상용 거치대' }, { name: '[50w 출력] 비파노 스피커' }, { name: 'NINJA 1' }, { name: 'ninja 2' }, { name: '최신형 리빙웰 30L 에어프라이어' }, { name: '닌자 크리스피 3.8L' }, { name: '[특가] 닌자 올인원' }, { name: '에어프라이어 대용량' }];
  assert.deepEqual(brandsOf(items, ['에어프라이어']), ['비파노', 'NINJA', '리빙웰', '닌자']);
  assert.deepEqual(brandsOf([{ name: '핸드폰 거치대' }, { name: '거치대 모센모' }], ['휴대폰 거치대']), []);
  assert.deepEqual(brandsOf([{ name: '자외선 타프' }], [], ['A 자외선 차단', 'B 자외선 코팅']), []);
  const t = (style, brands, prices = [149000, 260000]) => guideTitle({ subject: '에어프라이어', brands, prices, month: 10, style });
  assert.equal(t(0, ['닌자', '리빙웰']), '에어프라이어 가격 비교 | 닌자·리빙웰 2개, 149,000원부터');
  assert.equal(t(1, ['닌자', '리빙웰']), '10월 에어프라이어 최저가 정리: 닌자 vs 리빙웰 (149,000원~260,000원)');
  assert.equal(t(2, ['닌자', '리빙웰']), '에어프라이어 고르기 전 가격 기록 확인 (닌자·리빙웰 등 2개)');
  assert.equal(t(3, ['하기스']), '에어프라이어 가격 비교 | 하기스 2종, 149,000원부터');
  assert.equal(t(1, [], [5000, 5000]), '10월 에어프라이어 최저가 정리 (5,000원)');
});

test('search results do not overwrite a goldbox/best price set in the same run', async () => {
  const { createUpsert } = await import('../src/merge.mjs');
  const item = (id, price, name = 'x') => ({ productId: id, productName: name, productPrice: price, productUrl: `https://link.coupang.com/re/AFFSDP?vendorItemId=${id}` });
  const products = { 1: { id: '1', price: 1000, lastSeen: '2026-01-01', history: [{ date: '2026-01-01', price: 1000 }] } };
  const upsert = createUpsert(products, '2026-01-02');
  assert.deepEqual(upsert([item(1, 1000, 'best')]), ['1']);
  assert.deepEqual(upsert([item(1, 800, 'search'), item(2, 500)], { source: 'search' }), ['1', '2']);
  assert.deepEqual([products[1].price, products[1].name, products[1].history.at(-1).price], [1000, 'best', 1000]);
  assert.equal(products[2].price, 500); // search-only items are still priced from search
  upsert([item(2, 600)]); // a later list result replaces a search price
  assert.equal(products[2].price, 600);
  createUpsert(products, '2026-01-03')([item(1, 900)], { source: 'search' }); // next run, search only
  assert.deepEqual(products[1].history.map((h) => h.price), [1000, 1000, 900]);
});
