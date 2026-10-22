// Fetches products from Coupang Partners API (or mock data when no keys) and
// merges them into data/products.json with a per-day price history.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient, normalize } from './coupang.mjs';
import { mockClient } from './mock.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const config = JSON.parse(await fs.readFile(path.join(ROOT, 'site.config.json'), 'utf8'));

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(path.join(DATA, file), 'utf8')); }
  catch { return fallback; }
}
const writeJson = (file, v) => fs.writeFile(path.join(DATA, file), JSON.stringify(v, null, 1) + '\n');

const { COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY, COUPANG_SUB_ID } = process.env;
const live = Boolean(COUPANG_ACCESS_KEY && COUPANG_SECRET_KEY);
const api = live
  ? createClient({ accessKey: COUPANG_ACCESS_KEY, secretKey: COUPANG_SECRET_KEY, subId: COUPANG_SUB_ID })
  : mockClient();
console.log(live ? '▶ LIVE 모드: 쿠팡 파트너스 API 호출' : '▶ MOCK 모드: API 키가 없어 샘플 데이터 사용');

await fs.mkdir(DATA, { recursive: true });
let products = await readJson('products.json', {});
const state = await readJson('state.json', { guideCursor: 0, lists: {} });
const today = new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10); // KST date
if (live && state.mode === 'mock') {
  console.log('↺ MOCK → LIVE 전환: 샘플 데이터를 비웁니다');
  products = {};
  state.lists = {};
}
// Drop products not seen for 90 days to keep the repo small.
const cutoff = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
products = Object.fromEntries(Object.entries(products).filter(([, p]) => p.lastSeen >= cutoff));
const n = config.limits.productsPerList;

function upsert(list) {
  return list.map(normalize).filter((p) => p.id && p.url).map((p) => {
    const prev = products[p.id] ?? { history: [] };
    const history = prev.history.filter((h) => h.date !== today);
    history.push({ date: today, price: p.price });
    products[p.id] = { ...prev, ...p, history: history.slice(-90), lastSeen: today };
    return p.id;
  });
}

async function safe(label, fn) {
  try { return await fn(); }
  catch (e) { console.warn(`⚠ ${label} 실패: ${e.message}`); return null; }
}

const lists = state.lists;

const gold = await safe('goldbox', () => api.goldbox());
if (gold) lists.goldbox = upsert(gold).slice(0, n * 2);

for (const c of config.categories) {
  const best = await safe(`best ${c.name}`, () => api.best(c.id, n));
  if (best) lists[`best:${c.slug}`] = upsert(best).slice(0, n);
}

// Search API is rate-limited, so rotate through guides a few per run.
const g = config.guides;
for (let i = 0; i < Math.min(config.limits.searchPerRun, g.length); i++) {
  const guide = g[(state.guideCursor + i) % g.length];
  const found = await safe(`search "${guide.keyword}"`, () => api.search(guide.keyword, n));
  if (found) lists[`guide:${guide.slug}`] = upsert(found).slice(0, n);
}
state.guideCursor = (state.guideCursor + config.limits.searchPerRun) % Math.max(g.length, 1);
state.updatedAt = new Date().toISOString();
state.mode = live ? 'live' : 'mock';

await writeJson('products.json', products);
await writeJson('state.json', state);
console.log(`✔ 상품 ${Object.keys(products).length}개, 리스트 ${Object.keys(lists).length}개 저장`);
