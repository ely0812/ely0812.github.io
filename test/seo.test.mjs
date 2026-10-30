import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crumbHtml, guideDescription, jsonLdScript, lastChanged, pageGraph, productLd } from '../src/seo.mjs';

const base = 'https://example.github.io';
const item = (id, price, history = [{ date: '2026-10-30', price }]) => ({ id, productId: `p${id}`, name: `상품 ${id}`, image: `https://img/${id}.jpg`, url: `https://link.coupang.com/${id}`, price, history, lastSeen: history.at(-1).date });

test('productLd has only real data: KRW price offer, no made-up ratings or reviews', () => {
  const ld = productLd(item('1', 13900));
  assert.deepEqual(ld.offers, { '@type': 'Offer', price: 13900, priceCurrency: 'KRW', url: 'https://link.coupang.com/1' });
  assert.equal(ld.productID, 'p1');
  for (const k of ['aggregateRating', 'review', 'availability']) assert.ok(!(k in ld) && !(k in ld.offers), k);
});

test('pageGraph links page, breadcrumb and product list; FAQ only when given', () => {
  const crumbs = [{ name: '홈', path: '/' }, { name: '캠핑', path: '/topic/camping/' }, { name: '타프 추천', path: '/guide/tarp/' }];
  const g = pageGraph({ base, path: '/guide/tarp/', title: '타프 추천', description: 'd', siteName: 'S', updatedAt: '2026-10-30T05:00:00.000Z', crumbs, items: [item('1', 1000), item('2', 2000)] });
  const [pageNode, bc, list] = g['@graph'];
  assert.equal(g['@context'], 'https://schema.org');
  assert.deepEqual([pageNode['@type'], pageNode.dateModified, pageNode.breadcrumb['@id'], pageNode.mainEntity['@id']], ['CollectionPage', '2026-10-30T05:00:00.000Z', bc['@id'], list['@id']]);
  assert.deepEqual(bc.itemListElement.map((e) => [e.position, e.name, e.item]), [[1, '홈', `${base}/`], [2, '캠핑', `${base}/topic/camping/`], [3, '타프 추천', `${base}/guide/tarp/`]]);
  assert.deepEqual(list.itemListElement.map((e) => [e.position, e.item['@type'], e.item.offers.price]), [[1, 'Product', 1000], [2, 'Product', 2000]]);
  assert.equal(g['@graph'].length, 3);

  const withFaq = pageGraph({ base, path: '/guide/tarp/', title: 't', description: 'd', siteName: 'S', crumbs, faq: [{ q: '언제 싸요?', a: '기록을 보세요.' }] });
  const faq = withFaq['@graph'].find((n) => n['@type'] === 'FAQPage');
  assert.deepEqual(faq.mainEntity, [{ '@type': 'Question', name: '언제 싸요?', acceptedAnswer: { '@type': 'Answer', text: '기록을 보세요.' } }]);
  assert.equal(withFaq['@graph'][0]['@type'], 'WebPage');
});

test('home page graph has WebSite and no single-item breadcrumb', () => {
  const g = pageGraph({ base, path: '/', title: 'S', description: 'd', siteName: 'S', crumbs: [{ name: '홈', path: '/' }] });
  assert.deepEqual(g['@graph'].map((n) => n['@type']), ['WebPage', 'WebSite']);
  assert.equal(g['@graph'][1].url, `${base}/`);
});

test('jsonLdScript cannot be closed early by product names', () => {
  const s = jsonLdScript({ name: '</script><b>x' });
  assert.equal(s.match(/<\/script>/g).length, 1);
  assert.deepEqual(JSON.parse(s.slice(s.indexOf('>') + 1, s.lastIndexOf('<'))), { name: '</script><b>x' });
});

test('crumbHtml links parents, marks the current page, escapes names', () => {
  const href = (p) => `/root${p}`;
  assert.equal(crumbHtml([{ name: '홈', path: '/' }], href), '');
  assert.equal(
    crumbHtml([{ name: '홈', path: '/' }, { name: '육아', path: '/topic/baby/' }, { name: 'A&B', path: '/guide/x/' }], href),
    '<p class="crumb"><a href="/root/">홈</a> › <a href="/root/topic/baby/">육아</a> › <span aria-current="page">A&amp;B</span></p>',
  );
});

test('lastChanged moves only when a price changes or a product is first recorded', () => {
  const steady = item('a', 1000, [{ date: '2026-10-25', price: 1000 }, { date: '2026-10-30', price: 1000 }]);
  const changed = item('b', 900, [{ date: '2026-10-24', price: 1000 }, { date: '2026-10-27', price: 900 }, { date: '2026-10-30', price: 900 }]);
  assert.equal(lastChanged([steady], 'X'), '2026-10-25');
  assert.equal(lastChanged([steady, changed], 'X'), '2026-10-27');
  assert.equal(lastChanged([], '2026-10-30'), '2026-10-30');
});

test('guideDescription leads with real count, price range and date', () => {
  const items = [item('1', 44800), item('2', 165000)];
  assert.equal(guideDescription({ subject: '타프', intro: '크기를 보세요.', items, date: '2026-10-30' }), '타프 2개 가격 비교(44,800원~165,000원, 10월 30일 기준). 크기를 보세요.');
  assert.equal(guideDescription({ subject: '타프', intro: '크기를 보세요.', items: [item('1', 5000)], date: '2026-11-01' }), '타프 1개 가격 비교(5,000원, 11월 1일 기준). 크기를 보세요.');
  assert.equal(guideDescription({ subject: '타프', intro: 'i', items: [], date: '2026-10-30' }), 'i');
});
