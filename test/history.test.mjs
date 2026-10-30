import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asOfKo, priceStats, sparkline, usualPrice } from '../src/history.mjs';

const days = (prices, start = 1) => prices.map((price, i) => ({ date: `2026-01-${String(start + i).padStart(2, '0')}`, price }));
const item = (prices) => ({ price: prices.at(-1), history: days(prices) });

test('usualPrice is the median of earlier days and needs 3+ of them', () => {
  assert.equal(usualPrice(days([1000, 1000, 900])), null);
  assert.equal(usualPrice(days([1000, 2000, 1100, 500])), 1100);
  // A one-day spike does not move the usual price.
  assert.equal(usualPrice(days([1000, 1000, 9000, 1000, 800])), 1000);
});

test('belowUsual needs 5%+ under the usual price and never rounds the percent up', () => {
  const s = priceStats(item([1000, 1000, 1000, 900]));
  assert.deepEqual([s.usual, s.usualPercent, s.belowUsual], [1000, 10, true]);
  assert.equal(priceStats(item([1000, 1000, 1000, 954])).usualPercent, 4); // 4.6% -> 4, not 5
  assert.equal(priceStats(item([1000, 1000, 1000, 954])).belowUsual, false);
  assert.equal(priceStats(item([1000, 1000, 900])).belowUsual, false); // only 2 earlier days
  assert.equal(priceStats(item([1000, 1000, 1000, 1200])).belowUsual, false); // price went up
});

test('recordLow needs 7+ days, the lowest price, and a price that has moved', () => {
  assert.equal(priceStats(item([1000, 950, 980, 1000, 960, 990, 900])).recordLow, true);
  assert.equal(priceStats(item([1000, 950, 980, 1000, 960, 990, 950])).recordLow, true); // ties the low
  assert.equal(priceStats(item([1000, 950, 980, 1000, 960, 990, 960])).recordLow, false);
  assert.equal(priceStats(item([1000, 950, 980, 1000, 900])).recordLow, false); // only 5 days
  assert.equal(priceStats(item([900, 900, 900, 900, 900, 900, 900])).recordLow, false); // never moved
  assert.deepEqual(priceStats({ price: 500, history: [] }), { days: 0, low: 500, high: 500, usual: null, usualPercent: null, recordLow: false, belowUsual: false });
});

test('asOfKo shows the KST check time, or only the date when the hour is unknown', () => {
  assert.equal(asOfKo('2026-10-30T05:38:46.783Z'), '2026년 10월 30일 14시 기준');
  assert.equal(asOfKo('2026-10-30T15:10:00Z'), '2026년 10월 31일 0시 기준'); // past midnight in KST
  assert.equal(asOfKo(undefined, '2026-10-29'), '2026년 10월 29일 기준');
  assert.equal(asOfKo(undefined, undefined), '');
});

test('sparkline spaces points by date, drops flat-run middles, and marks the latest price', () => {
  assert.equal(sparkline(days([1000])), '');
  const h = [
    { date: '2026-01-01', price: 1000 }, { date: '2026-01-02', price: 1000 }, { date: '2026-01-03', price: 1000 },
    { date: '2026-01-06', price: 800 }, // three missing days before this one
  ];
  const svg = sparkline(h);
  assert.match(svg, /viewBox="0 0 5 30"/);
  assert.match(svg, /points="0,4 2,4 5,26"/); // 01-02 dropped (flat run), 01-06 sits at x=5
  assert.match(svg, /class="now" d="M5 26h0"/);
  assert.match(svg, /aria-label="1월 1일~1월 6일 가격 추이: 최저 800원, 최고 1,000원"/);
  assert.doesNotMatch(svg, /class="u"/);
  const withUsual = sparkline(h, { usual: 1000, recordLow: true });
  assert.match(withUsual, /class="u" d="M0 4H5"/);
  assert.match(withUsual, /class="now low"/);
  assert.match(sparkline(days([700, 700])), /points="0,15 1,15"/); // flat price: a level line
  assert.match(sparkline(days([700, 700]), { usual: false }), /points="0,15 1,15"/); // non-numbers are ignored
  // A 1% change stays near the middle instead of spanning the full height.
  assert.match(sparkline(days([1000, 990])), /points="0,14 1,16"/);
});

test('collected items record when this run checked their price', async () => {
  const { createUpsert } = await import('../src/merge.mjs');
  const products = {};
  createUpsert(products, '2026-10-30', '2026-10-30T05:38:46.783Z')([{ productId: 1, productPrice: 1000, productUrl: 'https://link.coupang.com/re/AFFSDP?vendorItemId=7' }]);
  assert.equal(asOfKo(products[7].seenAt, products[7].lastSeen), '2026년 10월 30일 14시 기준');
});
