// Renders data/*.json into a static, SEO-friendly site in dist/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { priceDrops } from './deals.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const read = async (f) => JSON.parse(await fs.readFile(path.join(ROOT, f), 'utf8'));
const config = await read('site.config.json');
const products = await read('data/products.json');
const state = await read('data/state.json');
const base = (process.env.SITE_URL || config.baseUrl).replace(/\/$/, '');
const updated = new Date(state.updatedAt);
const updatedKo = updated.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'long', timeStyle: 'short' });

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
const list = (key) => (state.lists[key] ?? []).map((id) => products[id]).filter(Boolean);
// Only publish pages that have products, so search engines never index empty pages.
const categories = config.categories.filter((c) => list(`best:${c.slug}`).length);
const guides = config.guides.filter((g) => list(`guide:${g.slug}`).length);
const sections = (config.sections ?? [])
  .map((sec) => ({ ...sec, categories: categories.filter((c) => c.section === sec.slug), guides: guides.filter((g) => g.section === sec.slug) }))
  .filter((sec) => sec.categories.length || sec.guides.length);
const root = new URL(base).pathname.replace(/\/$/, '');
const href = (p) => `${root}${p}`;
const sectionName = Object.fromEntries(sections.map((sec) => [sec.slug, sec.name]));

function sparkline(history) {
  if (history.length < 2) return '';
  const prices = history.map((h) => h.price);
  const min = Math.min(...prices), max = Math.max(...prices), w = 96, h = 24;
  const pts = prices.map((p, i) => `${((i / (prices.length - 1)) * w).toFixed(1)},${(max === min ? h / 2 : h - ((p - min) / (max - min)) * h).toFixed(1)}`);
  return `<svg class="spark" viewBox="-2 -2 ${w + 4} ${h + 4}" width="${w}" height="${h}" role="img" aria-label="최근 ${prices.length}일 가격 추이"><polyline points="${pts.join(' ')}"/></svg>`;
}

function card(p, extra = '') {
  const prices = p.history.map((h) => h.price);
  const low = Math.min(...prices);
  const badges = [p.rocket && '<span class="b rocket">로켓배송</span>', p.freeShipping && '<span class="b">무료배송</span>', p.price <= low && prices.length > 1 && '<span class="b low">기록 최저가</span>'].filter(Boolean).join('');
  return `<li class="card">
  <a href="${esc(p.url)}" target="_blank" rel="sponsored nofollow noopener"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" width="200" height="200"></a>
  <div class="body">
    <h3><a href="${esc(p.url)}" target="_blank" rel="sponsored nofollow noopener">${esc(p.name)}</a></h3>
    <div class="badges">${badges}</div>
    <p class="price">${won(p.price)} ${extra}</p>
    <div class="meta">${sparkline(p.history)}<span>${prices.length}일 기록 · 최저 ${won(low)}</span></div>
    <a class="btn" href="${esc(p.url)}" target="_blank" rel="sponsored nofollow noopener">쿠팡에서 보기</a>
  </div>
</li>`;
}

const grid = (items, extra) => (items.length ? `<ul class="grid">${items.map((p) => card(p, extra?.(p))).join('\n')}</ul>` : '<p class="empty">아직 수집된 상품이 없습니다.</p>');

function page({ path: urlPath, title, description, body, items = [] }) {
  const canonical = `${base}${urlPath}`;
  const depth = urlPath.split('/').filter(Boolean).length;
  const rel = depth ? '../'.repeat(depth) : './';
  const ld = items.length && {
    '@context': 'https://schema.org', '@type': 'ItemList', name: title,
    itemListElement: items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.name, url: p.url })),
  };
  const nav = [['', '홈'], ['deals/', '가격 하락'], ['goldbox/', '골드박스'], ...sections.map((sec) => [`topic/${sec.slug}/`, sec.name])]
    .map(([href, label]) => `<a href="${rel}${href}">${esc(label)}</a>`).join('');
  return `<!doctype html>
<html lang="${config.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title === config.siteName ? esc(title) : `${esc(title)} | ${esc(config.siteName)}`}</title>
<meta name="description" content="${esc(description)}">
${verificationMeta}
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
${items[0] ? `<meta property="og:image" content="${esc(items[0].image)}">` : ''}
<link rel="alternate" type="application/rss+xml" href="${base}/rss.xml" title="${esc(config.siteName)}">
<link rel="stylesheet" href="${rel}style.css">
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<p class="disclosure">${esc(config.disclosure)}</p>
<header><a class="logo" href="${rel}">${esc(config.siteName)}</a><nav>${nav}</nav></header>
<main>
<h1>${esc(title)}</h1>
<p class="updated">${state.mode === 'mock' ? '⚠ 샘플 데이터(MOCK) · ' : ''}업데이트: ${updatedKo} · 가격은 변동될 수 있으며 구매 시점의 쿠팡 페이지 가격이 우선합니다.</p>
${body}
</main>
<footer><p>${esc(config.disclosure)}</p><p>© ${updated.getFullYear()} ${esc(config.siteName)}</p></footer>
</body>
</html>`;
}

const v = config.verification ?? {};
const verificationMeta = [
  v.google && `<meta name="google-site-verification" content="${esc(v.google)}">`,
  v.naver && `<meta name="naver-site-verification" content="${esc(v.naver)}">`,
].filter(Boolean).join('\n');

// Round-robin the top items of a section's lists so the home preview mixes categories and guides.
function preview(sec, n = 4) {
  const lists = [...sec.categories.map((c) => list(`best:${c.slug}`)), ...sec.guides.map((g) => list(`guide:${g.slug}`))];
  const out = new Map();
  for (let i = 0; out.size < n && lists.some((l) => l[i]); i++) for (const l of lists) if (l[i] && out.size < n) out.set(l[i].id, l[i]);
  return [...out.values()];
}
const guideLinks = (gs) => (gs.length ? `<ul class="links">${gs.map((g) => `<li><a href="${href(`/guide/${g.slug}/`)}">${esc(g.title)}</a></li>`).join('')}</ul>` : '');
const crumb = (secSlug) => (sectionName[secSlug] ? `<p class="crumb"><a href="${href('/')}">홈</a> › <a href="${href(`/topic/${secSlug}/`)}">${esc(sectionName[secSlug])}</a></p>` : '');

const pages = [];
const add = (p) => pages.push(p);

const drops = priceDrops(products, { minDropPercent: 3, limit: 30 });
const dropTag = (p) => {
  const d = drops.find((x) => x.product.id === p.id);
  return d ? `<s>${won(d.before)}</s> <em>-${d.percent}%</em>` : '';
};

add({
  path: '/', title: config.siteName, description: config.siteDescription, items: list('goldbox').slice(0, 8),
  body: `<p class="lead">${esc(config.siteDescription)}</p>
${drops.length ? `<h2>오늘 가격이 내려간 상품</h2>${grid(drops.slice(0, 8).map((d) => d.product), dropTag)}` : ''}
<h2>골드박스 특가</h2>${grid(list('goldbox').slice(0, 8))}
${sections.map((sec) => `<h2><a href="${href(`/topic/${sec.slug}/`)}">${esc(sec.name)}</a></h2>
${grid(preview(sec))}
${guideLinks(sec.guides)}`).join('\n')}`,
});

for (const sec of sections) {
  const ids = new Set([...sec.categories.map((c) => `best:${c.slug}`), ...sec.guides.map((g) => `guide:${g.slug}`)].flatMap((k) => state.lists[k] ?? []));
  const secDrops = drops.filter((d) => ids.has(d.product.id)).map((d) => d.product);
  add({
    path: `/topic/${sec.slug}/`, title: `${sec.name} 최저가 모음`, description: sec.description, items: secDrops,
    body: `<p class="lead">${esc(sec.description)}</p>
${secDrops.length ? `<h2>가격이 내려간 ${esc(sec.name)} 상품</h2>${grid(secDrops.slice(0, 8), dropTag)}` : ''}
<h2>품목별 최저가 가이드</h2>${guideLinks(sec.guides)}
${sec.categories.map((c) => `<h2><a href="${href(`/best/${c.slug}/`)}">${esc(c.name)} 베스트</a></h2>${grid(list(`best:${c.slug}`).slice(0, 8))}`).join('\n')}`,
  });
}

add({
  path: '/deals/', title: '최근 가격이 내려간 쿠팡 상품', description: '매일 기록한 가격 이력을 바탕으로 직전 가격 대비 가격이 내려간 상품을 모았습니다.',
  items: drops.map((d) => d.product), body: grid(drops.map((d) => d.product), dropTag),
});

add({
  path: '/goldbox/', title: '오늘의 쿠팡 골드박스', description: '하루 한정 쿠팡 골드박스 특가 상품 목록과 가격 추이.',
  items: list('goldbox'), body: grid(list('goldbox')),
});

for (const c of categories) {
  const items = list(`best:${c.slug}`);
  add({ path: `/best/${c.slug}/`, title: `${c.name} 베스트 상품 순위`, description: `쿠팡 ${c.name} 카테고리에서 지금 많이 팔리는 상품 ${items.length}개와 가격 추이.`, items, body: crumb(c.section) + grid(items) });
}

for (const g of guides) {
  const items = list(`guide:${g.slug}`);
  const rows = items.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${won(p.price)}</td><td>${p.rocket ? '로켓' : '-'}</td></tr>`).join('');
  add({
    path: `/guide/${g.slug}/`, title: g.title, description: g.intro, items,
    body: `${crumb(g.section)}<p class="lead">${esc(g.intro)}</p>
${items.length ? `<h2>한눈에 비교</h2><div class="tablewrap"><table><thead><tr><th>#</th><th>상품</th><th>가격</th><th>배송</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
<h2>상품 목록</h2>${grid(items)}
${guides.some((o) => o.section === g.section && o !== g) ? `<h2>같은 분야 다른 가이드</h2>${guideLinks(guides.filter((o) => o.section === g.section && o !== g))}` : ''}`,
  });
}

await fs.rm(DIST, { recursive: true, force: true });
for (const p of pages) {
  const dir = path.join(DIST, p.path);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'index.html'), page(p));
}
await fs.copyFile(path.join(ROOT, 'templates/style.css'), path.join(DIST, 'style.css'));
await fs.writeFile(path.join(DIST, '.nojekyll'), '');

const iso = updated.toISOString();
await fs.writeFile(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `<url><loc>${base}${p.path}</loc><lastmod>${iso}</lastmod></url>`).join('\n')}
</urlset>
`);
await fs.writeFile(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
await fs.writeFile(path.join(DIST, 'rss.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${esc(config.siteName)}</title><link>${base}/</link><description>${esc(config.siteDescription)}</description>
<lastBuildDate>${updated.toUTCString()}</lastBuildDate>
${pages.slice(1).map((p) => `<item><title>${esc(p.title)}</title><link>${base}${p.path}</link><guid>${base}${p.path}#${iso.slice(0, 10)}</guid><description>${esc(p.description)}</description><pubDate>${updated.toUTCString()}</pubDate></item>`).join('\n')}
</channel></rss>
`);
console.log(`✔ ${pages.length}개 페이지 생성 → dist/`);
