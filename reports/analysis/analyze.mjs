// Price-history analysis for content strategy (read-only: never writes to data/).
//
//   git fetch --unshallow origin main   # once, if the clone is shallow
//   node reports/analysis/analyze.mjs   # writes reports/analysis/output/{tables.md,results.json}
//
// Options: --ref <git ref> (default origin/main), --refresh (rebuild the snapshot cache)
import fs from 'node:fs';
import path from 'node:path';
import { loadSnapshots, ROOT } from './history.mjs';
import { GUIDE_TERMS, TOPICS } from './topics.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUT = path.join(import.meta.dirname, 'output');
const DROP = 10; // drop threshold used by Telegram, /deals/ and the blog roundup
const END_RISE = 1.05; // Telegram "deal ended" rule: price back up 5%+ from the alerted price

const { snapshots: snaps, meta, head } = await loadSnapshots({ ref: opt('--ref', 'origin/main'), refresh: args.includes('--refresh') });
const products = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/products.json'), 'utf8'));
const state = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/state.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));

// ---------- helpers ----------
const H = 36e5;
const kst = (t) => new Date(Date.parse(t) + 9 * H);
const kDate = (t) => kst(t).toISOString().slice(0, 10);
const kHour = (t) => kst(t).getUTCHours();
const kMin = (t) => kHour(t) * 60 + kst(t).getUTCMinutes();
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const wd = (date) => WD[new Date(date + 'T00:00:00Z').getUTCDay()];
const pct = (from, to) => Math.round(((from - to) / from) * 100);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const fmt = (x, d = 1) => (x == null || Number.isNaN(x) ? '-' : Number(x).toLocaleString('ko-KR', { maximumFractionDigits: d }));
const share = (a, b) => (b ? r1((a / b) * 100) : null);
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map((c) => fmt0(c)).join(' | ')} |`)].join('\n');
const fmt0 = (c) => (typeof c === 'number' ? fmt(c) : c ?? '-');

const last = snaps.at(-1);
const sectionName = { goldbox: '골드박스', ...last.sections };
const groupSection = (key) => {
  if (key === 'goldbox') return 'goldbox';
  const [kind, slug] = key.split(':');
  if (kind === 'best') return last.categories.find((c) => c.slug === slug)?.section ?? snaps.flatMap((s) => s.categories).find((c) => c.slug === slug)?.section;
  return config.guides.find((g) => g.slug === slug)?.section ?? snaps.flatMap((s) => s.guides).find((g) => g.slug === slug)?.section;
};
const groupLabel = (key) => {
  if (key === 'goldbox') return '골드박스';
  const [kind, slug] = key.split(':');
  if (kind === 'best') return `베스트·${last.categories.find((c) => c.slug === slug)?.name ?? slug}`;
  return `가이드·${config.guides.find((g) => g.slug === slug)?.keyword ?? slug}`;
};
const kindOf = (key) => (key === 'goldbox' ? 'goldbox' : key.split(':')[0]);

// Item -> list keys it is in, per snapshot.
const membership = snaps.map((s) => {
  const m = new Map();
  for (const [key, ids] of Object.entries(s.lists)) for (const id of ids) (m.get(id) ?? m.set(id, []).get(id)).push(key);
  return m;
});

// ---------- 1. hourly observation series ----------
// collect.mjs writes goldbox, then best lists, then searches, so when an item is in a
// searched guide list its stored price comes from the search API ("search"), otherwise from
// the goldbox/best API ("list"). The two APIs do not always agree on the price.
const series = new Map(); // id -> [{i, t, price, src}]
snaps.forEach((s, i) => {
  const fromSearch = new Set(s.searched.flatMap((slug) => s.lists[`guide:${slug}`] ?? []));
  for (const [id, price] of Object.entries(s.obs)) (series.get(id) ?? series.set(id, []).get(id)).push({ i, t: s.t, price, src: fromSearch.has(id) ? 'search' : 'list' });
});
const srcAt = new Map(); // `${i}:${id}` -> src
for (const [id, obs] of series) for (const o of obs) srcAt.set(`${o.i}:${id}`, o.src);

// How often do the two APIs disagree? Items in a goldbox/best list whose guide was searched
// this run, with the same price in the runs right before and after.
const apiCheck = { n: 0, differ: 0, lower: 0 };
for (const [id, obs] of series) {
  for (let k = 1; k < obs.length - 1; k++) {
    const [a, b, c] = [obs[k - 1], obs[k], obs[k + 1]];
    if (b.src !== 'search' || a.src !== 'list' || c.src !== 'list' || a.price !== c.price || c.i - a.i > 2) continue;
    if (!(membership[b.i].get(id) ?? []).some((key) => !key.startsWith('guide:'))) continue;
    apiCheck.n++;
    if (b.price !== a.price) { apiCheck.differ++; if (b.price < a.price) apiCheck.lower++; }
  }
}

// Drop events between two consecutive observations of the same item.
// "usual" = median of all earlier observations (needs 6+ observations over 24h+), so a
// drop that only undoes a short price spike is not counted as a real discount.
const MIN_DROP = 5; // keep 5%+ drops too, to compare thresholds
const allEvents = [];
const changes = { up: 0, down: 0, same: 0 };
for (const [id, obs] of series) {
  for (let k = 1; k < obs.length; k++) {
    const prev = obs[k - 1];
    const cur = obs[k];
    if (cur.price === prev.price) { changes.same++; continue; }
    changes[cur.price < prev.price ? 'down' : 'up']++;
    const p = pct(prev.price, cur.price);
    if (p < MIN_DROP) continue;
    const before = obs.slice(0, k);
    const hasUsual = before.length >= 6 && Date.parse(cur.t) - Date.parse(before[0].t) >= 24 * H;
    const usual = hasUsual ? median(before.map((o) => o.price)) : null;
    // Duration: hours until the price is back up 5%+ (Telegram's end rule); censored at the
    // last observation if that never happens.
    let end = null;
    for (let j = k + 1; j < obs.length; j++) if (obs[j].price >= cur.price * END_RISE) { end = obs[j]; break; }
    const lastObs = obs.at(-1);
    const recovered = end && end.price >= prev.price * 0.95;
    const next = obs[k + 1];
    allEvents.push({
      id, i: cur.i, t: cur.t, from: prev.price, to: cur.price, percent: p,
      // Price came from a different API than the previous observation: likely not a real drop.
      switched: prev.src !== cur.src,
      blip: Boolean(next && next.i - cur.i <= 2 && next.price >= prev.price * 0.95),
      gapH: (Date.parse(cur.t) - Date.parse(prev.t)) / H,
      usual, usualPercent: usual ? pct(usual, cur.price) : null,
      keys: membership[cur.i].get(id) ?? [],
      durH: ((end ?? lastObs).t === cur.t ? 0 : (Date.parse((end ?? lastObs).t) - Date.parse(cur.t)) / H),
      ended: Boolean(end), recovered: Boolean(recovered),
    });
  }
}
const events = allEvents.filter((e) => e.percent >= DROP);
const real = (e) => !e.switched;
const genuine = (e) => real(e) && e.usualPercent != null && e.usualPercent >= DROP;
const realEvents = events.filter(real);
// Guides whose search results are mostly off-topic (filled in after guideRows below).
let junkGuides = new Set();

// Kaplan-Meier: share of drops still active after h hours.
function km(evts, hours) {
  const pts = evts.map((e) => ({ d: e.durH, ended: e.ended })).sort((a, b) => a.d - b.d);
  let s = 1;
  let atRisk = pts.length;
  const out = {};
  const hs = [...hours];
  let idx = 0;
  for (const h of hs) {
    while (idx < pts.length && pts[idx].d <= h) {
      const d = pts[idx].d;
      let endedHere = 0;
      let leaving = 0;
      while (idx < pts.length && pts[idx].d === d) { endedHere += pts[idx].ended ? 1 : 0; leaving++; idx++; }
      if (atRisk > 0) s *= 1 - endedHere / atRisk;
      atRisk -= leaving;
    }
    out[h] = r1(s * 100);
  }
  return out;
}
function kmMedian(evts) {
  const pts = evts.map((e) => ({ d: e.durH, ended: e.ended })).sort((a, b) => a.d - b.d);
  let s = 1;
  let atRisk = pts.length;
  for (let idx = 0; idx < pts.length;) {
    const d = pts[idx].d;
    let endedHere = 0;
    let leaving = 0;
    while (idx < pts.length && pts[idx].d === d) { endedHere += pts[idx].ended ? 1 : 0; leaving++; idx++; }
    if (atRisk > 0) s *= 1 - endedHere / atRisk;
    atRisk -= leaving;
    if (s <= 0.5) return r1(d);
  }
  return null; // more than half never ended within the data
}

// ---------- 2. group stats (Q1) ----------
const dayCount = (Date.parse(last.t) - Date.parse(snaps[0].t)) / (24 * H);
function groupStats(filterKey) {
  const items = new Set();
  let obsN = 0;
  snaps.forEach((s, i) => {
    for (const id of Object.keys(s.obs)) if ((membership[i].get(id) ?? []).some(filterKey)) { items.add(id); obsN++; }
  });
  const all = events.filter((e) => e.keys.some(filterKey));
  const ev = all.filter(real);
  const gen = ev.filter(genuine);
  const ps = ev.map((e) => e.percent);
  const itemsWithDrop = new Set(ev.map((e) => e.id)).size;
  return {
    items: items.size, obs: obsN, all: all.length, switched: all.length - ev.length, events: ev.length, genuine: gen.length,
    blipShare: share(ev.filter((e) => e.blip).length, ev.length),
    perItemWeek: items.size ? r1((ev.length / items.size) * (7 / dayCount)) : null,
    itemsWithDropShare: share(itemsWithDrop, items.size),
    mean: r1(mean(ps)), median: r1(median(ps)), max: ps.length ? Math.max(...ps) : null,
    genMean: r1(mean(gen.map((e) => e.usualPercent))), genMax: gen.length ? Math.max(...gen.map((e) => e.usualPercent)) : null,
    t30: ev.filter((e) => e.percent >= 30).length, t50: ev.filter((e) => e.percent >= 50).length,
  };
}
const allKeys = [...new Set(snaps.flatMap((s) => Object.keys(s.lists)))];
const byKind = Object.fromEntries(['goldbox', 'best', 'guide'].map((k) => [k, groupStats((key) => kindOf(key) === k)]));
const bySection = Object.fromEntries(['goldbox', ...Object.keys(last.sections)].map((sec) => [sec, groupStats((key) => groupSection(key) === sec)]));
const byGroup = Object.fromEntries(allKeys.filter((k) => k !== 'goldbox' && (k.startsWith('best:') || config.guides.some((g) => `guide:${g.slug}` === k))).map((k) => [k, groupStats((key) => key === k)]));

// Was a site/Telegram drop caused by the price switching API source? Compare the source of
// the observation that triggered it with the source of the previous day's last observation.
function dropSwitched(id, idx) {
  const date = kDate(snaps[idx].t);
  const obs = series.get(id) ?? [];
  const before = obs.filter((o) => kDate(o.t) < date).at(-1);
  const src = srcAt.get(`${idx}:${id}`);
  return Boolean(before && src && before.src !== src);
}

// By Coupang's own category label on each product (e.g. 로켓프레시 = fresh food).
const byCoupangCat = {};
for (const id of new Set(snaps.flatMap((s) => Object.keys(s.obs)))) {
  const cat = meta[id]?.category ?? '?';
  (byCoupangCat[cat] ??= { items: 0, events: 0, genuine: 0, ps: [] }).items++;
}
for (const e of realEvents) {
  const c = byCoupangCat[meta[e.id]?.category ?? '?'];
  c.events++;
  if (genuine(e)) c.genuine++;
  c.ps.push(e.percent);
}
const catRows = Object.entries(byCoupangCat).map(([cat, c]) => ({ cat, items: c.items, events: c.events, genuine: c.genuine, per100: r1((c.events / c.items) * 100), mean: r1(mean(c.ps)), max: c.ps.length ? Math.max(...c.ps) : null })).sort((a, b) => b.per100 - a.per100);

// Daily view = what the site/Telegram/blog actually see: items in priceDrops(>=10%) at any
// run of that KST day (one per item per day, largest percent).
const daily = new Map(); // date -> Map(id -> {percent, firstT, firstIdx})
snaps.forEach((s, i) => {
  const date = kDate(s.t);
  const m = daily.get(date) ?? daily.set(date, new Map()).get(date);
  for (const d of s.drops10) {
    const cur = m.get(d.id);
    if (!cur) m.set(d.id, { id: d.id, percent: d.percent, before: d.before, price: d.price, firstT: s.t, firstIdx: i, keys: membership[i].get(d.id) ?? [], switched: dropSwitched(d.id, i) });
    else if (d.percent > cur.percent) Object.assign(cur, { percent: d.percent, before: d.before, price: d.price });
  }
});
// The 10%+ list at run i without the source-switch suspects.
const realDrops10 = (i) => snaps[i].drops10.filter((d) => !daily.get(kDate(snaps[i].t))?.get(d.id)?.switched);

const dailyRows = [...daily.entries()].map(([date, m]) => {
  const runs = snaps.filter((s) => kDate(s.t) === date);
  const observed = new Set(runs.flatMap((s) => Object.keys(s.obs)));
  const ps = [...m.values()].filter((x) => !x.switched).map((x) => x.percent);
  const suspect = [...m.values()].filter((x) => x.switched).length;
  const posted = new Set(runs.flatMap((s) => s.telegramPosted.filter((k) => k.endsWith(date))));
  const postedSuspect = [...posted].filter((k) => m.get(k.split(':')[0])?.switched).length;
  const firstH = runs.length ? kHour(runs[0].t) : null;
  const lastH = runs.length ? kHour(runs.at(-1).t) : null;
  return { date, wd: wd(date), runs: runs.length, hours: `${firstH}~${lastH}시`, observed: observed.size, drops: m.size, suspect, realDrops: m.size - suspect, rate: share(m.size - suspect, observed.size), mean: r1(mean(ps)), max: ps.length ? Math.max(...ps) : null, t30: ps.filter((p) => p >= 30).length, t50: ps.filter((p) => p >= 50).length, telegram: posted.size, postedSuspect };
});

// ---------- 3. timing (Q2) ----------
// Only items checked every hour (goldbox + best lists) can tell *when* a price changed;
// guide items are re-checked every ~8 hours, so their drop time is just their search time.
const hourly = Array.from({ length: 24 }, (_, h) => ({ h, runs: 0, obs: 0, events: 0, genuine: 0, drops10Size: [] }));
snaps.forEach((s, i) => {
  const h = kHour(s.t);
  hourly[h].runs++;
  hourly[h].drops10Size.push(realDrops10(i).length);
  for (const id of Object.keys(s.obs)) if ((membership[i].get(id) ?? []).some((k) => !k.startsWith('guide:'))) hourly[h].obs++;
});
for (const e of realEvents) {
  if (!e.keys.some((k) => !k.startsWith('guide:')) || e.gapH > 1.6) continue;
  hourly[kHour(e.t)].events++;
  if (genuine(e)) hourly[kHour(e.t)].genuine++;
}
const hourRows = hourly.map((x) => ({ h: x.h, runs: x.runs, events: x.events, genuine: x.genuine, per1000: x.obs ? r1((x.events / x.obs) * 1000) : null, listAvg: r1(mean(x.drops10Size)) }));

// Goldbox turnover: at which KST hour does the goldbox list get replaced?
const goldboxChanges = [];
for (let i = 1; i < snaps.length; i++) {
  const a = new Set(snaps[i - 1].lists.goldbox ?? []);
  const b = snaps[i].lists.goldbox ?? [];
  const fresh = b.filter((id) => !a.has(id)).length;
  if (fresh >= 5) goldboxChanges.push({ t: snaps[i].t, kst: `${kDate(snaps[i].t)} ${kHour(snaps[i].t)}시`, fresh });
}

// Blog slots: the roundup is built from the last run before 11:40 KST (published 12:40); the
// guide from the last run before 07:10 KST (published 08:10). How big is the 10%+ list then,
// compared with other times of day?
const SLOTS = ['07:10', '09:40', '11:40', '14:40', '17:40', '20:40'];
const dates = [...daily.keys()].filter((d) => snaps.some((s) => kDate(s.t) === d && kHour(s.t) >= 21)); // full days only
function snapAt(date, hhmm) {
  const [hh, mm] = hhmm.split(':').map(Number);
  const target = Date.parse(`${date}T00:00:00Z`) - 9 * H + (hh * 60 + mm) * 6e4;
  let best = null;
  snaps.forEach((s, i) => { if (Date.parse(s.t) <= target && Date.parse(s.t) > target - 3 * H) best = i; });
  return best;
}
const slotRows = SLOTS.map((slot) => {
  const idx = dates.map((d) => snapAt(d, slot)).filter((i) => i != null);
  const sizes = idx.map((i) => realDrops10(i).length);
  const sizes15 = idx.map((i) => realDrops10(i).filter((d) => d.percent >= 15).length);
  return { slot, days: sizes.length, avg: r1(mean(sizes)), min: sizes.length ? Math.min(...sizes) : null, ge3: sizes.filter((n) => n >= 3).length, ge5: sizes.filter((n) => n >= 5).length, avg15: r1(mean(sizes15)), ge3_15: sizes15.filter((n) => n >= 3).length };
});
// Share of the day's 10%+ items already visible at each slot.
const coverage = SLOTS.map((slot) => {
  let seen = 0;
  let total = 0;
  for (const d of dates) {
    const i = snapAt(d, slot);
    const m = daily.get(d);
    total += [...m.values()].filter((x) => !x.switched).length;
    if (i == null) continue;
    for (const x of m.values()) if (!x.switched && x.firstIdx <= i) seen++;
  }
  return { slot, share: share(seen, total) };
});

// ---------- 4. persistence (Q3) ----------
const durKinds = {
  '실제 하락 전체': realEvents,
  '평소가 대비 10%↓': realEvents.filter(genuine),
  '골드박스': realEvents.filter((e) => e.keys.includes('goldbox')),
  '카테고리 베스트': realEvents.filter((e) => e.keys.some((k) => k.startsWith('best:'))),
  '키워드 가이드': realEvents.filter((e) => e.keys.some((k) => k.startsWith('guide:'))),
  '10~29%': realEvents.filter((e) => e.percent < 30),
  '30~49%': realEvents.filter((e) => e.percent >= 30 && e.percent < 50),
  '50%↑': realEvents.filter((e) => e.percent >= 50),
  '(참고) 출처 바뀜 의심': events.filter((e) => !real(e)),
};
const KM_H = [1, 3, 6, 12, 24, 48];
const durRows = Object.entries(durKinds).map(([k, ev]) => ({ k, n: ev.length, ended: ev.filter((e) => e.ended).length, median: kmMedian(ev), ...km(ev, KM_H), recovered: share(ev.filter((e) => e.recovered).length, ev.filter((e) => e.ended).length) }));

// Roundup simulation: top 5 of the 10%+ list at the 11:40 snapshot; is the price still valid
// (not back up 5%+) when readers see it?
const CHECK = [['게시 12:40', 1], ['저녁 18:00', 6.33], ['다음날 08:00', 20.33], ['24시간 뒤', 24.33], ['48시간 뒤', 48.33]];
function priceAt(id, t) { // latest observation at or before t
  const obs = series.get(id) ?? [];
  let p = null;
  for (const o of obs) { if (Date.parse(o.t) <= t) p = o; else break; }
  return p;
}
function freshness(slot, size) {
  const res = CHECK.map(([label]) => ({ label, valid: 0, ended: 0, unknown: 0 }));
  let n = 0;
  let suspect = 0;
  for (const d of dates) {
    const i = snapAt(d, slot);
    if (i == null) continue;
    const base = Date.parse(`${d}T00:00:00Z`) - 9 * H + (Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3))) * 6e4;
    // What the blog actually picked (suspects included), then judged on real price data.
    const top = [...snaps[i].drops10].sort((a, b) => b.percent - a.percent).slice(0, size);
    for (const x of top) {
      n++;
      if (daily.get(d)?.get(x.id)?.switched) suspect++;
      CHECK.forEach(([, plusH], j) => {
        const t = base + plusH * H;
        if (t > Date.parse(last.t)) { res[j].unknown++; return; }
        const o = priceAt(x.id, t);
        if (!o || Date.parse(o.t) <= Date.parse(snaps[i].t)) res[j].unknown++; // not re-checked since
        else if (o.price >= x.price * END_RISE) res[j].ended++;
        else res[j].valid++;
      });
    }
  }
  return { n, suspect, res: res.map((r) => ({ ...r, validShare: share(r.valid, r.valid + r.ended) })) };
}
const roundupFresh = freshness('11:40', 5);

// Real Telegram alerts: how long did they stay in activeDeals (i.e. before the end notice)?
const alertSpans = new Map();
snaps.forEach((s) => {
  for (const [id, d] of Object.entries(s.activeDeals)) {
    const key = `${id}:${d.postedAt}:${d.price}`;
    const a = alertSpans.get(key) ?? alertSpans.set(key, { id, first: s.t, last: s.t, before: d.before, price: d.price }).get(key);
    a.last = s.t;
  }
});
const alerts = [...alertSpans.values()].map((a) => {
  const pos = snaps.findIndex((s) => s.t === a.last);
  const removed = pos < snaps.length - 1; // removed before the latest run = end notice (or 7-day stale)
  const firstIdx = snaps.findIndex((s) => s.t === a.first);
  return { ...a, percent: pct(a.before, a.price), switched: dropSwitched(a.id, firstIdx), ended: removed, durH: (Date.parse(removed ? snaps[pos + 1].t : a.last) - Date.parse(a.first)) / H };
});
const alertStat = (list) => ({ n: list.length, ended: list.filter((a) => a.ended).length, median: kmMedian(list), ...km(list, KM_H) });
const alertStats = { all: alertStat(alerts), real: alertStat(alerts.filter((a) => !a.switched)), suspect: alertStat(alerts.filter((a) => a.switched)) };

// Threshold check: how many real drops per day, how many are below the usual price too,
// and how long they last, at each threshold.
const thresholdRows = [5, 10, 15, 20, 30].map((th) => {
  const ev = allEvents.filter((e) => real(e) && e.percent >= th);
  const withUsual = ev.filter((e) => e.usualPercent != null);
  const dailyN = [...daily.values()].map((m) => [...m.values()].filter((x) => !x.switched && x.percent >= th).length);
  return {
    th, events: ev.length, perDay: r1(ev.length / dayCount),
    usualShare: share(withUsual.filter((e) => e.usualPercent >= th).length, withUsual.length),
    median: kmMedian(ev), keep24: km(ev, [24])[24],
    siteDaily: th >= 10 ? r1(mean(dailyN.slice(1))) : null, // 10/23 excluded (no previous day)
  };
});

// ---------- 5. guide quality (Q4) ----------
const usualNow = (p) => { // same rule as src/blog.mjs usual()
  const prev = p.history.slice(0, -1).map((h) => h.price).sort((a, b) => a - b);
  if (prev.length < 3) return null;
  const u = prev[prev.length >> 1];
  const percent = pct(u, p.price);
  return percent >= 5 ? percent : null;
};
const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase();
const guideRows = config.guides.map((g) => {
  const key = `guide:${g.slug}`;
  const ids = state.lists[key] ?? [];
  const items = ids.map((id) => products[id]).filter(Boolean);
  const distinct = new Set(items.map((p) => p.productId ?? p.id)).size;
  const re = new RegExp(GUIDE_TERMS[g.slug] ?? g.keyword);
  const relevant = items.filter((p) => re.test(p.name)).length;
  const everIds = new Set(snaps.flatMap((s) => s.lists[key] ?? []));
  const everRelevant = [...everIds].filter((id) => re.test(meta[id]?.name ?? '')).length;
  const searches = snaps.filter((s) => s.searched.includes(g.slug)).length;
  const ev = realEvents.filter((e) => e.keys.includes(key));
  const prices = items.map((p) => p.price);
  const hist3 = items.filter((p) => p.history.length >= 4).length;
  return {
    slug: g.slug, keyword: g.keyword, section: g.section, n: items.length, distinct, relevant, relevantShare: share(relevant, items.length),
    ever: everIds.size, everRelevantShare: share(everRelevant, everIds.size), churn: items.length ? r1(everIds.size / items.length) : null, searches,
    onSale: items.filter(usualNow).length, maxSale: Math.max(0, ...items.map((p) => usualNow(p) ?? 0)),
    events: ev.length, genuine: ev.filter(genuine).length, maxDrop: ev.length ? Math.max(...ev.map((e) => e.percent)) : 0,
    hist3, minPrice: prices.length ? Math.min(...prices) : null, maxPrice: prices.length ? Math.max(...prices) : null,
  };
});
junkGuides = new Set(guideRows.filter((r) => r.everRelevantShare < 50).map((r) => `guide:${r.slug}`));
const switchedEvents = events.filter((e) => !real(e));
const switchedJunk = switchedEvents.filter((e) => e.keys.some((k) => junkGuides.has(k))).length;
const flags = (r) => [
  r.n < 5 && `상품 ${r.n}개`,
  r.distinct < r.n - 2 && `옵션 중복(실제 ${r.distinct}종)`,
  r.everRelevantShare != null && r.everRelevantShare < 70 && `관련 상품 ${r.everRelevantShare}%`,
  r.churn != null && r.churn <= 1.2 && '늘 같은 상품',
  r.events === 0 && r.onSale === 0 && '할인 기록 없음',
].filter(Boolean);

// ---------- 6. topic candidates (Q5) ----------
// Product types seen in goldbox/best lists (and guides) over the period, matched by name.
// Evidence only - the final recommendation is a judgement in the report.
const allTracked = new Set(snaps.flatMap((s) => Object.keys(s.obs)));
const topicRows = TOPICS.map((tp) => {
  const re = new RegExp(tp.pattern);
  const ids = [...allTracked].filter((id) => re.test(meta[id]?.name ?? '') && !(tp.exclude && new RegExp(tp.exclude).test(meta[id]?.name ?? '')));
  const set = new Set(ids);
  const ev = realEvents.filter((e) => set.has(e.id));
  const dailyHits = [...daily.values()].flatMap((m) => [...m.values()]).filter((x) => set.has(x.id) && !x.switched);
  // Where these items showed up (junk search results excluded: they are not about this topic).
  const sources = new Set(ids.flatMap((id) => snaps.flatMap((s, i) => membership[i].get(id) ?? [])).filter((k) => !junkGuides.has(k)).map(groupLabel));
  const prices = ids.map((id) => products[id]?.price).filter(Boolean);
  return {
    topic: tp.name, slugIdea: tp.slug, section: tp.section, items: ids.length,
    products: new Set(ids.map((id) => meta[id]?.productId ?? id)).size,
    events: ev.length, genuine: ev.filter(genuine).length, maxDrop: ev.length ? Math.max(...ev.map((e) => e.percent)) : 0,
    dailyDrops: dailyHits.length, medianPrice: median(prices), sources: [...sources].slice(0, 4).join(', '), why: tp.why,
  };
});

// ---------- output ----------
fs.mkdirSync(OUT, { recursive: true });
const period = `${kDate(snaps[0].t)} ${kHour(snaps[0].t)}시 ~ ${kDate(last.t)} ${kHour(last.t)}시 (KST), 수집 실행 ${snaps.length}회, ${r1(dayCount)}일`;
const results = { head, period, dayCount: r1(dayCount), runs: snaps.length, tracked: allTracked.size, changes, eventCount: events.length, realCount: realEvents.length, genuineCount: realEvents.filter(genuine).length, blipCount: realEvents.filter((e) => e.blip).length, switchedJunk, junkGuides: [...junkGuides], halfPrice: realEvents.filter((e) => Math.abs(e.from / e.to - 2) < 0.05).length, apiCheck, byKind, bySection, byGroup, dailyRows, hourRows, goldboxChanges, slotRows, coverage, durRows, thresholdRows, catRows, roundupFresh, alertStats, alerts, guideRows: guideRows.map((r) => ({ ...r, flags: flags(r) })), topicRows };
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1) + '\n');

const statRow = (label, s) => [label, s.items, s.all, s.switched, s.events, s.genuine, s.perItemWeek, s.itemsWithDropShare, s.mean, s.median, s.max, s.t30, s.t50, s.blipShare];
const statHead = ['구분', '추적 상품', '10%↓ 전체', '출처 바뀜 의심', '실제 10%↓', '평소가 대비 10%↓', '상품당 주간 건수', '하락 경험 상품 %', '평균 하락률', '중앙값', '최대', '30%↑', '50%↑', '1시간 내 원복 %'];
const md = [];
md.push(`# 분석 결과 표 (자동 생성)\n\n- 기간: ${period}\n- 기준 커밋: \`${head.slice(0, 7)}\`\n- 한 번이라도 관측된 상품(옵션): ${allTracked.size.toLocaleString()}개\n- 시간 단위 가격 변화: 내림 ${changes.down}, 오름 ${changes.up}, 같음 ${changes.same}\n- 10% 이상 하락(직전 관측 대비): ${events.length}건\n  - 출처 바뀜 의심(검색 API 가격 ↔ 골드박스·베스트 API 가격이 바뀌면서 생긴 하락): ${events.length - realEvents.length}건\n  - 실제 하락: ${realEvents.length}건, 그중 평소가(이전 관측 중앙값) 대비로도 10% 이상: ${realEvents.filter(genuine).length}건, 다음 관측에 바로 원래 가격으로 돌아온 것: ${realEvents.filter((e) => e.blip).length}건, 가격이 정확히 절반이 된 것(묶음 수량 변화일 수 있음): ${realEvents.filter((e) => Math.abs(e.from / e.to - 2) < 0.05).length}건\n- 두 API 가격 비교: 골드박스·베스트에 있는 상품이 같은 실행에서 검색에도 나온 ${apiCheck.n}번 중 ${apiCheck.differ}번(${share(apiCheck.differ, apiCheck.n)}%) 가격이 달랐고, 그중 ${apiCheck.lower}번은 검색 가격이 더 낮았습니다(앞뒤 실행 가격이 같은 경우만 셈).\n- 출처 바뀜 의심 ${switchedEvents.length}건 중 ${switchedJunk}건은 엉뚱한 상품이 검색되는 가이드(${[...junkGuides].join(', ')}) 목록에서 생겼습니다.\n\n아래 표의 하락률·건수는 따로 적지 않으면 '실제 하락' 기준입니다.\n`);
md.push('## 1. 종류별\n\n' + table(statHead, Object.entries(byKind).map(([k, s]) => statRow({ goldbox: '골드박스', best: '카테고리 베스트', guide: '키워드 가이드' }[k], s))));
md.push('## 2. 섹션별 (골드박스는 섹션 없음)\n\n' + table(statHead, Object.entries(bySection).map(([k, s]) => statRow(sectionName[k] ?? k, s))));
md.push('## 3. 베스트 카테고리별\n\n' + table(statHead, Object.entries(byGroup).filter(([k]) => k.startsWith('best:')).sort((a, b) => b[1].perItemWeek - a[1].perItemWeek).map(([k, s]) => statRow(groupLabel(k), s))));
md.push('## 3-1. 쿠팡 카테고리 표시별 (상품에 붙은 쿠팡 카테고리, 관측 상품 10개 이상)\n\n' + table(['쿠팡 카테고리', '관측 상품', '실제 10%↓', '평소가 대비 10%↓', '상품 100개당 건수', '평균 하락률', '최대'], catRows.filter((r) => r.items >= 10).map((r) => [r.cat, r.items, r.events, r.genuine, r.per100, r.mean, r.max])));
md.push('## 4. 가이드별 (10%↓ 건수 순)\n\n' + table(statHead, Object.entries(byGroup).filter(([k]) => k.startsWith('guide:')).sort((a, b) => b[1].events - a[1].events || b[1].max - a[1].max).map(([k, s]) => statRow(groupLabel(k), s))));
md.push('## 5. 날짜·요일별 (사이트·텔레그램이 보는 "전날 대비 10%↓" 목록 기준)\n\n10/23은 옵션 단위 추적을 시작한 다음 날이라 비교할 전날 가격이 거의 없습니다. 10/30은 오후까지만 있습니다.\n\n' + table(['날짜', '요일', '수집 횟수', '수집 시간', '관측 상품', '10%↓ 상품', '그중 출처 바뀜 의심', '실제 10%↓', '비율 %', '평균 하락률', '최대', '30%↑', '50%↑', '텔레그램 게시', '게시 중 의심'], dailyRows.map((r) => [r.date, r.wd, r.runs, r.hours, r.observed, r.drops, r.suspect, r.realDrops, r.rate, r.mean, r.max, r.t30, r.t50, r.telegram, r.postedSuspect])));
md.push('## 6. 시간대별 (KST, 매시간 확인하는 골드박스·베스트 상품만)\n\n' + table(['시', '수집 횟수', '10%↓ 건수', '평소가 대비', '관측 1,000건당', '그 시각 10%↓ 목록 크기(평균)'], hourRows.map((r) => [r.h, r.runs, r.events, r.genuine, r.per1000, r.listAvg])));
md.push('## 7. 골드박스 교체 시각 (새 상품 5개 이상 들어온 실행)\n\n' + table(['시각(KST)', '새 상품 수'], goldboxChanges.map((g) => [g.kst, g.fresh])));
md.push(`## 8. 발행 시각별 10%↓ 목록 크기 (온전한 날 ${dates.length}일)\n\n` + table(['데이터 시각', '날 수', '평균 개수', '최소', '3개 이상인 날', '5개 이상인 날', '그날 10%↓ 중 이미 보이는 비율 %', '15%↑ 평균 개수', '15%↑ 3개 이상인 날'], slotRows.map((r, i) => [r.slot, r.days, r.avg, r.min, r.ge3, r.ge5, coverage[i].share, r.avg15, r.ge3_15])));
md.push('## 9. 하락 지속 시간 (가격이 하락가보다 5% 이상 다시 오르면 종료, 카플란-마이어 추정)\n\n' + table(['구분', '건수', '종료 관측', '중앙값(시간)', '1h 뒤 유지 %', '3h', '6h', '12h', '24h', '48h', '종료된 것 중 원래가 복귀 %'], durRows.map((r) => [r.k, r.n, r.ended, r.median ?? '48h+', r[1], r[3], r[6], r[12], r[24], r[48], r.recovered])));
md.push('## 9-1. 하락 기준(%)별 비교 (실제 하락만)\n\n- 평소가로도 같은 % 이상 낮은 비율: 기록이 충분한(이전 관측 6회·24시간 이상) 하락 중, 이전 관측 중앙값 대비로도 기준 이상 싼 비율\n- 사이트 하루 평균: 사이트·텔레그램이 보는 \"전날 대비\" 목록에서 그 기준을 넘는 상품 수(10/23 제외)\n\n' + table(['기준', '건수', '하루 평균', '평소가로도 같은 % 이상 낮은 비율 %', '지속 중앙값(시간)', '24시간 뒤 유지 %', '사이트 하루 평균'], thresholdRows.map((r) => [`${r.th}%↑`, r.events, r.perDay, r.usualShare, r.median ?? '48h+', r.keep24, r.siteDaily])));
md.push(`## 10. 12:40 가격 하락 글 신선도 (11:40 데이터 상위 5개, ${roundupFresh.n}건, 그중 출처 바뀜 의심 ${roundupFresh.suspect}건)\n\n` + table(['확인 시점', '아직 유효', '이미 종료', '확인 불가', '유효 비율 %'], roundupFresh.res.map((r) => [r.label, r.valid, r.ended, r.unknown, r.validShare])));
md.push('## 11. 실제 텔레그램 알림 유지 시간 (state.json의 activeDeals 기록, 종료 = 알림가보다 5% 이상 오름)\n\n' + table(['구분', '알림 수', '종료 알림까지 간 것', '중앙값(시간)', '1h 뒤 유지 %', '3h', '6h', '12h', '24h', '48h'], [['전체', alertStats.all], ['출처 같음(실제)', alertStats.real], ['출처 바뀜 의심', alertStats.suspect]].map(([k, a]) => [k, a.n, a.ended, a.median ?? '48h+', a[1], a[3], a[6], a[12], a[24], a[48]])));
md.push('## 12. 가이드 품질 (현재 목록 + 기간 중 등장한 모든 상품)\n\n- 관련 상품 %: 기간 중 이 가이드 목록에 한 번이라도 들어온 상품 중 이름이 주제와 맞는 비율(topics.mjs의 GUIDE_TERMS)\n- 교체 배수: 누적 등장 상품 수 ÷ 지금 목록 크기. 1에 가까우면 늘 같은 상품\n- 평소보다 5%↓: 블로그 가이드 글이 \"평소 X원 → Y원\"으로 앞에 두는 상품 수(src/blog.mjs usual()과 같은 규칙)\n\n' + table(['가이드', '섹션', '상품', '실제 종류', '지금 관련 %', '누적 등장', '누적 관련 %', '교체 배수', '검색 횟수', '평소보다 5%↓', '최대 할인 %', '실제 10%↓', '기록 4일+', '문제'], guideRows.map((r) => [r.keyword, sectionName[r.section], r.n, r.distinct, r.relevantShare, r.ever, r.everRelevantShare, r.churn, r.searches, r.onSale, r.maxSale, r.events, r.hist3, flags(r).join(', ') || '-'])));
md.push('## 13. 새 가이드 후보 근거 (상품명 일치, 전체 관측 상품 대상)\n\n' + table(['후보', '섹션', '관측 옵션', '상품 수', '10%↓ 건수', '평소가 대비', '최대 하락', '사이트 하락 목록 등장', '현재가 중앙값', '어디서 보였나'], topicRows.sort((a, b) => b.events - a.events).map((r) => [r.topic, sectionName[r.section] ?? r.section, r.items, r.products, r.events, r.genuine, r.maxDrop, r.dailyDrops, r.medianPrice, r.sources])));
fs.writeFileSync(path.join(OUT, 'tables.md'), md.join('\n\n') + '\n');
console.log(`✔ ${path.relative(ROOT, OUT)}/tables.md, results.json (${period})`);
