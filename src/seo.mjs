// SEO helpers for build.mjs: JSON-LD structured data, breadcrumbs, lastmod, descriptions.
// Pure functions (no file or data access) so they can be unit-tested.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;

// "</script>" inside a product name must not end the script tag early.
export const jsonLdScript = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

// Only real collected data: name, image, price in KRW. No ratings or reviews (we have none),
// and no availability/condition because the API doesn't tell us.
export const productLd = (p) => ({
  '@type': 'Product',
  name: p.name,
  ...(p.image && { image: p.image }),
  ...(p.productId && { productID: String(p.productId) }),
  offers: { '@type': 'Offer', price: p.price, priceCurrency: 'KRW', url: p.url },
});

// crumbs: [{ name, path }] from the home page down to the current page; path is site-relative.
export const breadcrumbLd = (base, crumbs) => ({
  '@type': 'BreadcrumbList',
  itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${base}${c.path}` })),
});

export function crumbHtml(crumbs, href) {
  if (crumbs.length < 2) return '';
  const parts = crumbs.map((c, i) => (i === crumbs.length - 1 ? `<span aria-current="page">${esc(c.name)}</span>` : `<a href="${href(c.path)}">${esc(c.name)}</a>`));
  return `<p class="crumb">${parts.join(' › ')}</p>`;
}

export const faqLd = (faq) => ({
  '@type': 'FAQPage',
  mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
});

// One @graph per page: the page itself, its breadcrumb, product list and FAQ.
// dateModified is the data update time that the page shows as "업데이트: …".
export function pageGraph({ base, path, title, description, siteName, lang = 'ko', updatedAt, crumbs = [], items = [], faq = [] }) {
  const url = `${base}${path}`;
  const website = { '@type': 'WebSite', '@id': `${base}/#website`, name: siteName, url: `${base}/`, inLanguage: lang };
  const webPage = {
    '@type': items.length ? 'CollectionPage' : 'WebPage', '@id': url, url, name: title, description, inLanguage: lang,
    isPartOf: { '@id': website['@id'] }, ...(updatedAt && { dateModified: updatedAt }),
  };
  const graph = [webPage];
  if (path === '/') graph.push({ ...website, description });
  if (crumbs.length >= 2) {
    webPage.breadcrumb = { '@id': `${url}#breadcrumb` };
    graph.push({ '@id': `${url}#breadcrumb`, ...breadcrumbLd(base, crumbs) });
  }
  if (items.length) {
    webPage.mainEntity = { '@id': `${url}#itemlist` };
    graph.push({
      '@type': 'ItemList', '@id': `${url}#itemlist`, name: title, numberOfItems: items.length,
      itemListElement: items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, item: productLd(p) })),
    });
  }
  if (faq.length) graph.push({ '@id': `${url}#faq`, ...faqLd(faq) });
  return { '@context': 'https://schema.org', '@graph': graph };
}

// Date (YYYY-MM-DD) a list of products last changed: the latest day any of them got a new
// price or was first recorded. Used for sitemap <lastmod> so it only moves when content does,
// instead of every hourly build (search engines ignore lastmod that always changes).
export function lastChanged(items, fallback) {
  let latest = '';
  for (const p of items) {
    const h = p.history ?? [];
    let d = h[0]?.date ?? '';
    for (let i = 1; i < h.length; i++) if (h[i].price !== h[i - 1].price) d = h[i].date;
    if (d > latest) latest = d;
  }
  return latest || fallback;
}

// Guide meta description: real count, price range and date first (what the search snippet
// shows), then the hand-written intro.
export function guideDescription({ subject, intro, items, date }) {
  if (!items.length) return intro;
  const prices = items.map((p) => p.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  const range = min === max ? won(min) : `${won(min)}~${won(max)}`;
  const [, m, d] = date.split('-').map(Number);
  return `${subject} ${items.length}개 가격 비교(${range}, ${m}월 ${d}일 기준). ${intro}`;
}
