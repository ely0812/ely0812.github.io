// Renders data/*.json into a static, SEO-friendly site in dist/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { priceDrops } from './deals.mjs';
import { crumbHtml, guideDescription, jsonLdScript, lastChanged, pageGraph } from './seo.mjs';
import { asOfKo, priceStats, sparkline } from './history.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const read = async (f) => JSON.parse(await fs.readFile(path.join(ROOT, f), 'utf8'));
const config = await read('site.config.json');
const products = await read('data/products.json');
const state = await read('data/state.json');
const base = (process.env.SITE_URL || config.baseUrl).replace(/\/$/, '');
const updated = new Date(state.updatedAt);
const kstDate = (d) => new Date(d.getTime() + 9 * 36e5).toISOString().slice(0, 10);
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

function card(p, extra = '') {
  const st = priceStats(p);
  const badges = [
    p.rocket && '<span class="b rocket">로켓배송</span>',
    p.freeShipping && '<span class="b">무료배송</span>',
    st.recordLow && '<span class="b low">역대 최저가</span>',
    st.belowUsual && `<span class="b sale">평소보다 -${st.usualPercent}%</span>`,
  ].filter(Boolean).join('');
  // Every claim names its basis: how many days were recorded, and the usual price when it is used.
  const record = st.recordLow ? `기록 ${st.days}일 중 최저` : `기록 ${st.days}일 · 최저 ${won(st.low)}`;
  return `<li class="card">
  <a href="${esc(p.url)}" target="_blank" rel="sponsored nofollow noopener"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" width="200" height="200"></a>
  <div class="body">
    <h3><a href="${esc(p.url)}" target="_blank" rel="sponsored nofollow noopener">${esc(p.name)}</a></h3>
    <div class="badges">${badges}</div>
    <p class="price">${won(p.price)} ${extra}</p>
    <p class="asof">${p.seenAt ? `<time datetime="${esc(p.seenAt.slice(0, 16))}Z">${asOfKo(p.seenAt)}</time>` : asOfKo(null, p.lastSeen)}</p>
    ${sparkline(p.history, { usual: st.belowUsual ? st.usual : null, recordLow: st.recordLow })}
    <p class="meta">${record}${st.belowUsual ? ` · 평소 ${won(st.usual)}` : ''}</p>
    <a class="btn" href="${esc(p.url)}" target="_blank" rel="sponsored nofollow noopener">쿠팡에서 보기</a>
  </div>
</li>`;
}

const grid = (items, extra) => (items.length ? `<ul class="grid">${items.map((p) => card(p, extra?.(p))).join('\n')}</ul>` : '<p class="empty">아직 수집된 상품이 없습니다.</p>');

function page({ path: urlPath, title, description, body, items = [], crumbs = [], faq = [], notFound = false }) {
  const canonical = `${base}${urlPath}`;
  const depth = urlPath.split('/').filter(Boolean).length;
  // 404.html is served at any missing URL, so its links must not be relative.
  const rel = notFound ? `${root}/` : depth ? '../'.repeat(depth) : './';
  const ld = !notFound && pageGraph({ base, path: urlPath, title, description, siteName: config.siteName, lang: config.lang, updatedAt: state.updatedAt, crumbs, items, faq });
  const ogImage = items[0]?.image || `${base}/og.png`;
  const nav = [['', '홈'], ['deals/', '가격 하락'], ['goldbox/', '골드박스'], ...sections.map((sec) => [`topic/${sec.slug}/`, sec.name])]
    .map(([href, label]) => `<a href="${rel}${href}">${esc(label)}</a>`).join('');
  return `<!doctype html>
<html lang="${config.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title === config.siteName ? esc(title) : `${esc(title)} | ${esc(config.siteName)}`}</title>
<meta name="description" content="${esc(description)}">
${notFound ? '<meta name="robots" content="noindex">' : `<meta name="robots" content="max-image-preview:large">
${verificationMeta}
<link rel="canonical" href="${canonical}">`}
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:site_name" content="${esc(config.siteName)}">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary">
<link rel="icon" href="${rel}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${rel}og.png">
<link rel="alternate" type="application/rss+xml" href="${base}/rss.xml" title="${esc(config.siteName)}">
<link rel="stylesheet" href="${rel}style.css">
${ld ? jsonLdScript(ld) : ''}
</head>
<body>
<p class="disclosure">${esc(config.disclosure)}</p>
<header><a class="logo" href="${rel}">${esc(config.siteName)}</a><nav>${nav}</nav></header>
<main>
${tgCta('top')}
${crumbHtml(crumbs, href)}
<h1>${esc(title)}</h1>
<p class="updated">${state.mode === 'mock' ? '⚠ 샘플 데이터(MOCK) · ' : ''}업데이트: ${updatedKo} · 가격은 변동될 수 있으며 구매 시점의 쿠팡 페이지 가격이 우선합니다.</p>
${body}
${tgCta('bottom')}
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
const bestLinks = (cs) => (cs.length ? `<ul class="links">${cs.map((c) => `<li><a href="${href(`/best/${c.slug}/`)}">${esc(c.name)} 베스트 상품 순위</a></li>`).join('')}</ul>` : '');
// Breadcrumb trail (visible + BreadcrumbList): 홈 › section › page.
const crumbsFor = (secSlug, ...rest) => [{ name: '홈', path: '/' }, ...(sectionName[secSlug] ? [{ name: sectionName[secSlug], path: `/topic/${secSlug}/` }] : []), ...rest];
// Links to the rest of the same section, so every guide/best page links to its siblings.
function related(secSlug, { guide, category } = {}) {
  const sec = sections.find((s) => s.slug === secSlug);
  if (!sec) return '';
  const gs = sec.guides.filter((g) => g !== guide);
  const cs = sec.categories.filter((c) => c !== category);
  return [
    gs.length && `<h2>같은 분야 다른 가이드</h2>${guideLinks(gs)}`,
    cs.length && `<h2>${esc(sec.name)} 베스트 순위</h2>${bestLinks(cs)}`,
    `<p><a href="${href(`/topic/${sec.slug}/`)}">${esc(sec.name)} 최저가 모음 전체 보기 →</a></p>`,
  ].filter(Boolean).join('\n');
}

const tg = config.telegram?.channel;
const tgCta = (variant) => (tg ? `<a class="tg tg-${variant}" href="https://t.me/${esc(tg)}" target="_blank" rel="noopener">📣 <b>${esc(config.telegram.channelName || '텔레그램')}</b> 채널에서 가격 하락 알림 받기 →</a>` : '');

const pages = [];
const add = (p) => pages.push(p);

const drops = priceDrops(products, { minDropPercent: config.telegram?.minDropPercent ?? 10, limit: 30 });
const dropTag = (p) => {
  const d = drops.find((x) => x.product.id === p.id);
  return d ? `<s>${won(d.before)}</s> <em>-${d.percent}%</em>` : '';
};

add({
  path: '/', title: config.siteName, description: config.siteDescription, items: list('goldbox').slice(0, 8),
  shown: [...drops.slice(0, 8).map((d) => d.product), ...list('goldbox').slice(0, 8), ...sections.flatMap((sec) => preview(sec))],
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
    crumbs: crumbsFor(sec.slug), shown: [...secDrops.slice(0, 8), ...sec.categories.flatMap((c) => list(`best:${c.slug}`).slice(0, 8))],
    body: `<p class="lead">${esc(sec.description)}</p>
${secDrops.length ? `<h2>가격이 내려간 ${esc(sec.name)} 상품</h2>${grid(secDrops.slice(0, 8), dropTag)}` : ''}
<h2>품목별 최저가 가이드</h2>${guideLinks(sec.guides)}
${sec.categories.map((c) => `<h2><a href="${href(`/best/${c.slug}/`)}">${esc(c.name)} 베스트</a></h2>${grid(list(`best:${c.slug}`).slice(0, 8))}`).join('\n')}`,
  });
}

const dealsDesc = '매일 기록한 가격 이력을 바탕으로 직전 가격 대비 가격이 내려간 상품을 모았습니다.';
add({
  path: '/deals/', title: '최근 가격이 내려간 쿠팡 상품', description: dealsDesc, crumbs: crumbsFor(null, { name: '가격 하락', path: '/deals/' }),
  items: drops.map((d) => d.product), body: `<p class="lead">${esc(dealsDesc)}</p>
<h2>가격 하락 상품 ${drops.length}개</h2>${grid(drops.map((d) => d.product), dropTag)}`,
});

const goldDesc = '하루 한정 쿠팡 골드박스 특가 상품 목록과 가격 추이.';
add({
  path: '/goldbox/', title: '오늘의 쿠팡 골드박스', description: goldDesc, crumbs: crumbsFor(null, { name: '골드박스', path: '/goldbox/' }),
  items: list('goldbox'), body: `<p class="lead">${esc(goldDesc)}</p>
<h2>골드박스 특가 상품 ${list('goldbox').length}개</h2>${grid(list('goldbox'))}`,
});

for (const c of categories) {
  const items = list(`best:${c.slug}`).slice(0, 20);
  const title = `${c.name} 베스트 상품 순위`;
  add({
    path: `/best/${c.slug}/`, title, description: `쿠팡 ${c.name} 카테고리에서 지금 많이 팔리는 상품 ${items.length}개와 가격 추이.`, items,
    crumbs: crumbsFor(c.section, { name: title, path: `/best/${c.slug}/` }),
    body: `<h2>${esc(c.name)} 인기 상품 ${items.length}개</h2>${grid(items)}
${related(c.section, { category: c })}`,
  });
}

for (const g of guides) {
  const items = list(`guide:${g.slug}`);
  const rows = items.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${won(p.price)}</td><td>${p.rocket ? '로켓' : '-'}</td></tr>`).join('');
  add({
    path: `/guide/${g.slug}/`, title: g.title, items, faq: g.faq ?? [],
    description: guideDescription({ subject: g.title.replace(/\s*(추천|최저가)$/, ''), intro: g.intro, items, date: items.reduce((d, p) => (p.lastSeen > d ? p.lastSeen : d), '') || kstDate(updated) }),
    crumbs: crumbsFor(g.section, { name: g.title, path: `/guide/${g.slug}/` }),
    body: `<p class="lead">${esc(g.intro)}</p>
${items.length ? `<h2>한눈에 비교</h2><div class="tablewrap"><table><thead><tr><th>#</th><th>상품</th><th>가격</th><th>배송</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
<h2>상품 목록</h2>${grid(items)}
${g.faq?.length ? `<h2>자주 묻는 질문</h2>${g.faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('\n')}` : ''}
${related(g.section, { guide: g })}`,
  });
}

await fs.rm(DIST, { recursive: true, force: true });
for (const p of pages) {
  const dir = path.join(DIST, p.path);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'index.html'), page(p));
}
await fs.writeFile(path.join(DIST, '404.html'), page({
  path: '/404.html', title: '페이지를 찾을 수 없습니다', description: '요청한 페이지를 찾을 수 없습니다.', notFound: true,
  body: `<p class="lead">상품이 모두 사라져 잠시 내려간 페이지일 수 있습니다. 아래에서 다른 가이드를 찾아보세요.</p>
${sections.map((sec) => `<h2><a href="${href(`/topic/${sec.slug}/`)}">${esc(sec.name)}</a></h2>${guideLinks(sec.guides)}`).join('\n')}`,
}));
await fs.copyFile(path.join(ROOT, 'templates/style.css'), path.join(DIST, 'style.css'));
await fs.copyFile(path.join(ROOT, 'brand/lion.svg'), path.join(DIST, 'favicon.svg'));
await fs.copyFile(path.join(ROOT, 'brand/profile.png'), path.join(DIST, 'og.png'));
await fs.writeFile(path.join(DIST, '.nojekyll'), '');

for (const p of pages) p.lastmod = lastChanged(p.shown ?? p.items, kstDate(updated));
await fs.writeFile(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `<url><loc>${base}${p.path}</loc><lastmod>${p.lastmod}</lastmod></url>`).join('\n')}
</urlset>
`);
await fs.writeFile(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
await fs.writeFile(path.join(DIST, 'rss.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${esc(config.siteName)}</title><link>${base}/</link><description>${esc(config.siteDescription)}</description>
<language>ko</language><atom:link href="${base}/rss.xml" rel="self" type="application/rss+xml"/>
<lastBuildDate>${updated.toUTCString()}</lastBuildDate>
${pages.slice(1).sort((a, b) => b.lastmod.localeCompare(a.lastmod)).map((p) => {
  // pubDate/guid follow the page's last content change, so readers (and Naver) only see an item as new when it changed.
  const date = new Date(`${p.lastmod}T00:00:00+09:00`).toUTCString();
  return `<item><title>${esc(p.title)}</title><link>${base}${p.path}</link><guid isPermaLink="false">${base}${p.path}#${p.lastmod}</guid><description>${esc(p.description)}</description><pubDate>${date}</pubDate></item>`;
}).join('\n')}
</channel></rss>
`);
console.log(`✔ ${pages.length}개 페이지 생성 → dist/`);
