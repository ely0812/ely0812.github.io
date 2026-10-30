// Merges API results into products.json records with one price per item per day.
import { normalize } from './coupang.mjs';

// The search API often reports a different price for the same option than goldbox/best
// do, and flips back the next hour. Keep one source per item per run: once goldbox or
// best has set an item, a search result in the same run only adds it to the guide list.
// seenAt is when this run checked prices; the site shows it as "H시 기준".
export function createUpsert(products, today, seenAt = new Date().toISOString()) {
  const fromList = new Set();
  return function upsert(list, { source = 'list' } = {}) {
    return list.map(normalize).filter((p) => p.id && p.url).map((p) => {
      if (source === 'search' && fromList.has(p.id)) return p.id;
      if (source !== 'search') fromList.add(p.id);
      const prev = products[p.id] ?? { history: [] };
      const history = prev.history.filter((h) => h.date !== today);
      history.push({ date: today, price: p.price });
      products[p.id] = { ...prev, ...p, history: history.slice(-90), lastSeen: today, seenAt };
      return p.id;
    });
  };
}
