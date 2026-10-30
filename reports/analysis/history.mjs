// Rebuilds hourly price snapshots from the git history of data/ (read-only).
// Every hourly GitHub Actions run commits data/products.json + data/state.json, so each
// commit is one observation of the tracked products. products.json itself keeps only one
// price per day (the last one), so the hourly view has to come from git.
//
// Result is cached in reports/analysis/.cache/snapshots.json (not committed).
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CACHE_DIR = path.join(import.meta.dirname, '.cache');

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }).trim();

// Read many blobs with one `git cat-file --batch` process (much faster than git show per file).
function catFiles(specs) {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['cat-file', '--batch'], { cwd: ROOT });
    const chunks = [];
    proc.stdout.on('data', (c) => chunks.push(c));
    proc.on('error', reject);
    proc.on('close', () => {
      const buf = Buffer.concat(chunks);
      const out = [];
      let pos = 0;
      for (let i = 0; i < specs.length; i++) {
        const nl = buf.indexOf(10, pos);
        const header = buf.subarray(pos, nl).toString();
        pos = nl + 1;
        if (header.endsWith('missing')) { out.push(null); continue; }
        const size = Number(header.split(' ')[2]);
        out.push(buf.subarray(pos, pos + size).toString('utf8'));
        pos += size + 1;
      }
      resolve(out);
    });
    proc.stdin.end(specs.join('\n') + '\n');
  });
}

// Same rule as src/deals.mjs priceDrops() (copied so this folder has no dependency on src/).
function priceDrops(products, minDropPercent) {
  const today = Object.values(products).reduce((d, p) => (p.lastSeen > d ? p.lastSeen : d), '');
  return Object.values(products)
    .filter((p) => p.lastSeen === today && p.history.length >= 2)
    .map((p) => {
      const before = p.history.at(-2).price;
      return { id: p.id, before, price: p.price, percent: Math.round(((before - p.price) / before) * 100) };
    })
    .filter((d) => d.percent >= minDropPercent);
}

export async function loadSnapshots({ ref = 'origin/main', refresh = false } = {}) {
  const head = git('rev-parse', ref);
  const cacheFile = path.join(CACHE_DIR, 'snapshots.json');
  if (!refresh && fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (cached.head === head) return cached;
  }
  if (git('rev-parse', '--is-shallow-repository') === 'true') {
    throw new Error('얕은(shallow) 저장소입니다. 먼저 `git fetch --unshallow origin main`을 실행하세요.');
  }
  const shas = git('rev-list', '--reverse', ref, '--', 'data/products.json').split('\n').filter(Boolean);
  const snapshots = [];
  const meta = {};
  let prev = null;
  const BATCH = 20;
  for (let b = 0; b < shas.length; b += BATCH) {
    const group = shas.slice(b, b + BATCH);
    const blobs = await catFiles(group.flatMap((s) => [`${s}:data/products.json`, `${s}:data/state.json`, `${s}:site.config.json`]));
    for (let i = 0; i < group.length; i++) {
      const [pj, sj, cj] = blobs.slice(i * 3, i * 3 + 3);
      if (!pj || !sj || !cj) continue;
      const products = JSON.parse(pj);
      const state = JSON.parse(sj);
      const config = JSON.parse(cj);
      // Before this, products were keyed by productId and mixed different options' prices.
      if (state.idScheme !== 'option' || state.mode !== 'live') { prev = null; continue; }
      if (prev && prev.t === state.updatedAt) continue; // commit without a new run

      const lists = state.lists ?? {};
      const observed = new Set();
      for (const [key, ids] of Object.entries(lists)) if (!key.startsWith('guide:')) ids.forEach((id) => observed.add(id));
      // Guides searched in this run: never-searched ones first, then the rotation cursor.
      const guides = config.guides ?? [];
      const searched = new Set();
      if (prev) {
        guides.filter((g) => !(`guide:${g.slug}` in prev.lists)).forEach((g) => searched.add(g.slug));
        const len = Math.max(guides.length, 1);
        const steps = ((state.guideCursor ?? 0) - (prev.cursor ?? 0) + len) % len;
        for (let k = 0; k < steps; k++) searched.add(guides[((prev.cursor ?? 0) + k) % len].slug);
        for (const [key, ids] of Object.entries(lists)) {
          if (key.startsWith('guide:') && JSON.stringify(ids) !== JSON.stringify(prev.lists[key] ?? null)) searched.add(key.slice(6));
        }
      }
      for (const slug of searched) (lists[`guide:${slug}`] ?? []).forEach((id) => observed.add(id));

      const obs = {};
      for (const id of observed) if (products[id]) obs[id] = products[id].price;
      for (const p of Object.values(products)) {
        meta[p.id] = { name: p.name, productId: p.productId, category: p.category, rocket: p.rocket };
      }
      const snap = {
        t: state.updatedAt,
        sha: group[i],
        obs,
        lists,
        searched: [...searched],
        drops10: priceDrops(products, 10),
        telegramPosted: state.telegramPosted ?? [],
        activeDeals: Object.fromEntries(Object.entries(state.activeDeals ?? {}).map(([id, d]) => [id, { price: d.price, before: d.before, postedAt: d.postedAt }])),
        sections: Object.fromEntries((config.sections ?? []).map((s) => [s.slug, s.name])),
        categories: (config.categories ?? []).map((c) => ({ slug: c.slug, name: c.name, section: c.section })),
        guides: guides.map((g) => ({ slug: g.slug, title: g.title, keyword: g.keyword, section: g.section })),
      };
      snapshots.push(snap);
      prev = { t: state.updatedAt, lists, cursor: state.guideCursor };
    }
  }
  const result = { head, builtAt: new Date().toISOString(), snapshots, meta };
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(result));
  return result;
}
