// Builds Naver Blog post packages (title, HTML body, tags, images) from the collected price data.
// Output goes to a local outbox that the Mac-only Naver uploader picks up; nothing here touches the site.
//
//   node src/blog.mjs --out <dir> [--ledger <file>] [--date YYYY-MM-DD]
//
// Per day: one price-drop roundup, plus one flash-deal post (>= tiers.insane %) if any,
// otherwise one buying guide (rotated; a guide is not repeated within 30 days).
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { priceDrops } from './deals.mjs';
import { brandsOf, guideTitle } from './titles.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = async (f) => JSON.parse(await fs.readFile(path.join(ROOT, f), 'utf8'));

const { values: args } = parseArgs({
  options: {
    out: { type: 'string' }, ledger: { type: 'string' }, date: { type: 'string' },
    // Set by the publish planner: how many posts the target day still has room for, and which kinds.
    max: { type: 'string' }, kinds: { type: 'string' },
  },
});
if (!args.out) {
  console.error('사용법: node src/blog.mjs --out <출력 폴더> [--ledger <기록 파일>]');
  process.exit(1);
}
const OUT = path.resolve(args.out);
const LEDGER = path.resolve(args.ledger ?? path.join(OUT, 'ledger.json'));

const config = await read('site.config.json');
const products = await read('data/products.json');
const state = await read('data/state.json');
const base = config.baseUrl.replace(/\/$/, '');
const today = args.date ?? new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);
const [, mm, dd] = today.split('-').map(Number);
const dateKo = `${mm}월 ${dd}일`;
// Prices are a snapshot: name the data time so a post read days later is still accurate.
const dataKst = new Date(Date.parse(state.updatedAt) + 9 * 36e5);
const asOf = `${dataKst.getUTCFullYear()}년 ${dataKst.getUTCMonth() + 1}월 ${dataKst.getUTCDate()}일 ${dataKst.getUTCHours()}시`;
// Flash deals end within hours, so they stay on Telegram; drafts wait for review and would go stale.
const blog = { maxPerDay: 2, roundupSize: 5, guideRepeatDays: 30, includeFlash: false, ...(config.blog ?? {}) };
const insane = config.telegram?.tiers?.insane ?? 50;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
const list = (key) => (state.lists[key] ?? []).map((id) => products[id]).filter(Boolean);
const low = (p) => Math.min(...p.history.map((h) => h.price));
// "Usual" price = median of earlier recorded days (needs 3+). A guide item counts as on sale
// when it is at least 5% below that, so a one-day spike can't fake a discount.
function usual(p) {
  const prev = p.history.slice(0, -1).map((h) => h.price).sort((a, b) => a - b);
  if (prev.length < 3) return null;
  const u = prev[prev.length >> 1];
  const percent = Math.round(((u - p.price) / u) * 100);
  return percent >= 5 ? { price: u, percent } : null;
}

let ledger = { posts: [] };
try { ledger = JSON.parse(await fs.readFile(LEDGER, 'utf8')); } catch {}
const postedToday = ledger.posts.filter((x) => x.date === today);
const daysAgo = (d) => (Date.parse(today) - Date.parse(d)) / 864e5;

// Which section an item belongs to, for tags and wording.
const sectionOf = {};
for (const c of config.categories) for (const id of state.lists[`best:${c.slug}`] ?? []) sectionOf[id] ??= c.section;
for (const g of config.guides) for (const id of state.lists[`guide:${g.slug}`] ?? []) sectionOf[id] ??= g.section;
const sectionName = Object.fromEntries((config.sections ?? []).map((s) => [s.slug, s.name]));

// ---- HTML building blocks (kept to tags SmartEditor accepts: p, h2, h3, b, a, img, hr) ----
const P = (html) => `<p>${html}</p>`;
const disclosure = P(`<b>${esc(config.disclosure)}</b>`);
const link = (p, label = '쿠팡에서 가격 확인하기') => `<a href="${esc(p.url)}">👉 ${esc(label)}</a>`;
const badges = (p) => [p.rocket && '🚀 로켓배송', p.freeShipping && '무료배송'].filter(Boolean).join(' · ');

// Editor-ready blocks (the Naver uploader turns these into SmartEditor components):
//   { t: 'p', runs: [{ text, bold?, url? }] }  |  { t: 'h', text }  |  { t: 'img', src }
const T = (text, o = {}) => ({ text, ...o });
const para = (...runs) => ({ t: 'p', runs });
function productBlocks(p, before, label = '현재', beforeLabel = '') {
  const lowest = low(p);
  return [
    { t: 'h', text: p.name },
    { t: 'img', src: p.image },
    para(T(before ? `${beforeLabel}${won(before)} → ` : ''), T(`${label} ${won(p.price)}`, { bold: true }), T(badges(p) ? ` · ${badges(p)}` : '')),
    para(T(`가격 기록 ${p.history.length}일 · 기록 중 최저 ${won(lowest)}${p.price <= lowest && p.history.length > 1 ? ' (기록 최저가)' : ''}`)),
    para(T('👉 쿠팡에서 가격 확인하기', { bold: true, url: p.url })),
  ];
}

function productBlock(p, extra = '') {
  const lowest = low(p);
  const lines = [
    `<h3>${esc(p.name)}</h3>`,
    `<img src="${esc(p.image)}" alt="${esc(p.name)}">`,
    P(`${extra}<b>${asOf} 기준 ${won(p.price)}</b>${badges(p) ? ` · ${badges(p)}` : ''}`),
    P(`가격 기록 ${p.history.length}일 · 기록 중 최저 ${won(lowest)}${p.price <= lowest && p.history.length > 1 ? ' (기록 최저가)' : ''}`),
    P(link(p)),
  ];
  return lines.join('\n');
}

// Plain facts per product. The AI writer only adds wording; every number shown comes from here.
const fact = (p, before) => ({
  id: p.id, name: p.name, price: p.price, before: before ?? null,
  percent: before ? Math.round(((before - p.price) / before) * 100) : null,
  usual: usual(p)?.price ?? null, usualPercent: usual(p)?.percent ?? null,
  lowest: low(p), days: p.history.length, rocket: p.rocket, freeShipping: p.freeShipping,
  section: sectionName[sectionOf[p.id]] ?? '', url: p.url, image: p.image,
});

function wrap(title, intro, blocks, outro, tags, images, structured = []) {
  const content = [
    disclosure,
    P(esc(intro)),
    '<hr>',
    ...blocks,
    '<hr>',
    P(esc(outro)),
    P(`매시간 갱신되는 전체 가격 기록은 <a href="${base}/">${esc(config.siteName)}</a>에서 볼 수 있어요.`),
    P('※ 가격과 재고는 수시로 바뀌며, 구매 시점의 쿠팡 페이지 가격이 우선합니다.'),
    disclosure,
  ].join('\n');
  const tagList = [...new Set(tags)].slice(0, 10);
  const disc = para(T(config.disclosure, { bold: true }));
  const editorBlocks = [
    disc,
    para(T(intro)),
    ...structured,
    para(T(outro)),
    para(T('매시간 갱신되는 전체 가격 기록: '), T(config.siteName, { url: `${base}/` })),
    para(T('※ 가격과 재고는 수시로 바뀌며, 구매 시점의 쿠팡 페이지 가격이 우선합니다.')),
    disc,
    para(T(tagList.map((t) => `#${t}`).join(' '))),
  ].map((b) => (b.t === 'p' ? { ...b, runs: b.runs.filter((r) => r.text) } : b));
  return { title, content, tags: tagList, images: [...new Set(images)].filter(Boolean), blocks: editorBlocks };
}

// ---- post types ----
const drops = priceDrops(products, { minDropPercent: 10, limit: 200 });

function roundup() {
  const top = drops.slice(0, blog.roundupSize);
  if (top.length < 3) return null; // not enough real drops to make a useful post
  const blocks = top.map((d) => productBlock(d.product, `${won(d.before)} → `));
  const secs = [...new Set(top.map((d) => sectionName[sectionOf[d.product.id]]).filter(Boolean))];
  return {
    kind: 'roundup',
    key: `roundup:${today}`,
    facts: { asOf, products: top.map((d) => fact(d.product, d.before)) },
    ...wrap(
      `${asOf} 기준 쿠팡 가격 하락 기록 TOP ${top.length} | ${secs.slice(0, 3).join('·') || '생활'}`,
      `${asOf} 기준 기록입니다. 매시간 가격을 기록하는 ${Object.keys(products).length.toLocaleString('ko-KR')}개 상품 중 전날보다 가격이 내려간 상품을 하락률 순으로 정리했어요(최대 ${top[0].percent}%). 할인은 이미 끝났을 수 있으니 링크에서 현재 가격을 꼭 확인하세요.`,
      top.map((d, i) => `<h2>${i + 1}위 · -${d.percent}%</h2>\n${blocks[i]}`),
      '이 글의 가격은 위 시각 기준이에요. 할인은 몇 시간 만에 끝나기도 하니, 실시간 하락 알림은 텔레그램 채널에서 받아 보세요.',
      ['쿠팡최저가', '오늘의특가', '가격하락', '쿠팡할인', ...secs.map((s) => `${s.replace(/·/g, '')}최저가`)],
      top.map((d) => d.product.image),
      top.flatMap((d, i) => [{ t: 'h', text: `${i + 1}위 · -${d.percent}%` }, ...productBlocks(d.product, d.before, `${asOf} 기준`)]),
    ),
  };
}

function flash() {
  const seen = new Set(ledger.posts.filter((x) => x.kind === 'flash' && daysAgo(x.date) < 7).map((x) => x.productId));
  const d = drops.find((x) => x.percent >= insane && !seen.has(x.product.id));
  if (!d) return null;
  const p = d.product;
  const sec = sectionName[sectionOf[p.id]];
  return {
    kind: 'flash',
    key: `flash:${p.id}:${today}`,
    productId: p.id,
    ...wrap(
      `[${d.percent}% 할인] ${p.name.slice(0, 40).trim()} ${won(p.price)} 초특가`,
      `기록해 둔 가격보다 ${d.percent}% 내려간 상품이 있어 바로 정리했어요. 어제 ${won(d.before)}이던 가격이 지금 ${won(p.price)}입니다. 수량·시간 한정 할인일 수 있어 곧 끝날 수 있어요.`,
      [productBlock(p, `${won(d.before)} → `)],
      '파격 할인은 몇 시간 만에 끝나는 경우가 많아요. 글을 늦게 보셨다면 링크에서 현재 가격을 꼭 확인해 주세요.',
      ['쿠팡초특가', '쿠팡핫딜', '오늘의특가', sec && `${sec.replace(/·/g, '')}할인`, '쿠팡최저가'].filter(Boolean),
      [p.image],
      productBlocks(p, d.before),
    ),
  };
}

function guide() {
  const recent = new Set(ledger.posts.filter((x) => x.kind === 'guide' && daysAgo(x.date) < blog.guideRepeatDays).map((x) => x.guide));
  const candidates = config.guides.filter((g) => !recent.has(g.slug) && list(`guide:${g.slug}`).length >= 3);
  if (!candidates.length) return null;
  // Prefer the guide with the most items on sale; rotate by day among ties (or when none are).
  const onSale = (g) => list(`guide:${g.slug}`).filter(usual).length;
  const most = Math.max(...candidates.map(onSale));
  const pool = candidates.filter((g) => onSale(g) === most);
  const g = pool[Math.floor(Date.parse(today) / 864e5) % pool.length];
  // On-sale items first (biggest discount first), then the rest in search order.
  const all = list(`guide:${g.slug}`);
  const sale = all.filter(usual).sort((a, b) => usual(b).percent - usual(a).percent);
  // One option per product: color/size variants of the same item would waste slots.
  const seen = new Set();
  const items = [...sale, ...all.filter((p) => !usual(p))].filter((p) => !seen.has(p.productId ?? p.id) && seen.add(p.productId ?? p.id)).slice(0, 5);
  const atLow = items.filter((p) => p.history.length > 1 && p.price <= low(p) * 1.03).length;
  const kw = g.keyword.replace(/\s/g, '');
  const subject = g.title.replace(/\s*(추천|최저가)$/, '');
  const brands = brandsOf(items, [g.keyword, subject], Object.values(products).map((p) => p.name));
  // Next pattern after the last guide post, so consecutive guides never share a title shape.
  const style = ledger.posts.filter((x) => x.kind === 'guide').length;
  const title = guideTitle({ subject, brands, prices: items.map((p) => p.price), month: mm, style });
  const brandTags = brands.slice(0, 3).map((b) => `${b}${kw}`);
  return {
    kind: 'guide',
    key: `guide:${g.slug}:${today}`,
    guide: g.slug,
    brandTags,
    facts: { asOf, guide: { title: g.title, keyword: g.keyword, intro: g.intro, section: sectionName[g.section] ?? '' }, products: items.map((p) => fact(p)) },
    ...wrap(
      title,
      `${g.intro} 아래는 ${asOf} 기준 쿠팡 검색 상위 상품의 가격과 기록상 최저가예요.${sale.length ? ` 평소 기록 가격보다 5% 이상 싼 상품 ${Math.min(sale.length, 5)}개를 앞에 두었어요.` : ''}${atLow ? ` 이 중 ${atLow}개는 그 시각 기준 기록 최저가 근처였습니다.` : ''} 가격은 수시로 바뀌니 링크에서 현재 가격을 확인하세요.`,
      items.map((p, i) => `<h2>${i + 1}. ${esc(p.name.slice(0, 30))}${usual(p) ? ` · 평소보다 -${usual(p).percent}%` : ''}</h2>\n${productBlock(p, usual(p) ? `평소 ${won(usual(p).price)} → ` : '')}`),
      '가격이 자주 바뀌는 품목이라, 기록 최저가 근처일 때 사면 가장 이득이에요.',
      [kw, `${kw}추천`, `${kw}최저가`, '쿠팡추천', `${(sectionName[g.section] ?? '').replace(/·/g, '')}추천`, ...brandTags],
      items.map((p) => p.image),
      items.flatMap((p, i) => [{ t: 'h', text: `${i + 1}. ${p.name.slice(0, 30)}${usual(p) ? ` · 평소보다 -${usual(p).percent}%` : ''}` }, ...productBlocks(p, usual(p)?.price, `${asOf} 기준`, '평소 ')]),
    ),
  };
}

// ---- pick today's posts ----
const maxToday = args.max !== undefined ? Number(args.max) : blog.maxPerDay;
const kinds = args.kinds ? args.kinds.split(',') : null;
const slots = Math.max(0, maxToday - postedToday.length);
const picked = [];
const done = new Set(postedToday.map((x) => x.kind));
const makers = { roundup, flash, guide };
const order = kinds ?? (blog.includeFlash ? ['roundup', 'flash', 'guide'] : ['roundup', 'guide']);
for (const make of order.map((k) => makers[k]).filter(Boolean)) {
  if (picked.length >= slots) break;
  if (make === guide && (done.has('flash') || picked.some((x) => x.kind === 'flash'))) continue; // flash replaces the guide
  if (done.has(make.name)) continue;
  const post = make();
  if (post) picked.push(post);
}

await fs.mkdir(OUT, { recursive: true });
for (const post of picked) {
  const dir = path.join(OUT, `${today}-${post.kind}${post.guide ? `-${post.guide}` : ''}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'post.json'), JSON.stringify({ ...post, date: today, status: 'ready' }, null, 1) + '\n');
  await fs.writeFile(path.join(dir, 'preview.html'), `<!doctype html><meta charset="utf-8"><title>${esc(post.title)}</title><h1>${esc(post.title)}</h1>\n${post.content}\n<p>태그: ${post.tags.map(esc).join(', ')}</p>`);
  ledger.posts.push({ key: post.key, kind: post.kind, date: today, guide: post.guide, productId: post.productId, title: post.title });
  console.log(`✔ ${post.kind}: ${post.title}`);
}
ledger.posts = ledger.posts.filter((x) => daysAgo(x.date) < 90);
await fs.writeFile(LEDGER, JSON.stringify(ledger, null, 1) + '\n');
if (!picked.length) console.log('오늘 만들 글이 없습니다 (이미 만들었거나 조건에 맞는 상품이 부족)');
