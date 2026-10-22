// Fetches products from Coupang Partners API (or mock data when no keys) and
// merges them into data/products.json with a per-day price history.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient, normalize, optionId } from './coupang.mjs';
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
// One-time migration: re-key products by option (vendorItemId). Old histories mixed
// different options of the same product, so keep only each item's latest price.
if (state.idScheme !== 'option') {
  const remap = {};
  const migrated = {};
  for (const [oldId, p] of Object.entries(products)) {
    const id = optionId({ productId: oldId, productUrl: p.url });
    remap[oldId] = id;
    migrated[id] = { ...p, id, productId: oldId, history: p.history.slice(-1) };
  }
  products = migrated;
  for (const key of Object.keys(state.lists)) state.lists[key] = [...new Set(state.lists[key].map((id) => remap[id] ?? id))];
  state.telegramPosted = [];
  state.idScheme = 'option';
  console.log(`↺ 옵션 단위 추적으로 전환: 상품 ${Object.keys(products).length}개 (가격 이력 초기화)`);
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
// Forget lists for categories/guides removed from the config.
const valid = new Set(['goldbox', ...config.categories.map((c) => `best:${c.slug}`), ...config.guides.map((g) => `guide:${g.slug}`)]);
for (const key of Object.keys(lists)) if (!valid.has(key)) delete lists[key];

const gold = await safe('goldbox', () => api.goldbox());
if (gold) lists.goldbox = upsert(gold).slice(0, n * 2);

// Track more best-sellers than we display so price drops are caught across a wider set.
const bestLimit = config.limits.bestLimit ?? n;
for (const c of config.categories) {
  let best = await safe(`best ${c.name}`, () => api.best(c.id, bestLimit));
  if (!best && bestLimit > n) best = await safe(`best ${c.name} (limit ${n})`, () => api.best(c.id, n));
  if (best) lists[`best:${c.slug}`] = upsert(best);
}

// The search API has the tightest (and undocumented) quota, and exceeding it may
// block the key, so cap calls per rolling hour and back off on 403/429.
const g = config.guides;
const now = Date.now();
state.searchLog = (state.searchLog ?? []).filter((t) => now - Date.parse(t) < 36e5);
const budget = Math.min(config.limits.searchPerRun, (config.limits.maxSearchPerHour ?? 10) - state.searchLog.length, g.length);
if (state.searchPausedUntil && now < Date.parse(state.searchPausedUntil)) {
  console.log(`⏸ 검색 API 일시 중지 중 (${state.searchPausedUntil}까지)`);
} else {
  let done = 0;
  for (; done < budget; done++) {
    const guide = g[(state.guideCursor + done) % g.length];
    state.searchLog.push(new Date().toISOString());
    try {
      const found = await api.search(guide.keyword, n);
      if (found.length) lists[`guide:${guide.slug}`] = upsert(found).slice(0, n);
    } catch (e) {
      console.warn(`⚠ search "${guide.keyword}" 실패: ${e.message}`);
      if (e.status === 403 || e.status === 429) {
        state.searchPausedUntil = new Date(now + 36e5).toISOString();
        console.warn('⏸ 호출 한도로 보여 1시간 동안 검색을 멈춥니다');
        break;
      }
    }
  }
  state.guideCursor = (state.guideCursor + done) % Math.max(g.length, 1);
  console.log(`🔎 검색 ${done}회 (최근 1시간 ${state.searchLog.length}회 / 상한 ${config.limits.maxSearchPerHour ?? 10})`);
}
state.updatedAt = new Date().toISOString();
state.mode = live ? 'live' : 'mock';

await writeJson('products.json', products);
await writeJson('state.json', state);
console.log(`✔ 상품 ${Object.keys(products).length}개, 리스트 ${Object.keys(lists).length}개 저장`);
