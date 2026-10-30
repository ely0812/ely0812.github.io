// Turns a product's daily price history (one record per KST date, per option) into
// the numbers, badges and inline SVG sparkline shown on the site.

const DAY = 864e5;

// "Usual" price = median of the earlier recorded days (needs 3+), same rule as the blog,
// so a one-day spike can't fake a discount. Even counts take the upper middle value.
export function usualPrice(history, minDays = 3) {
  const prev = history.slice(0, -1).map((h) => h.price).sort((a, b) => a - b);
  return prev.length >= minDays ? prev[prev.length >> 1] : null;
}

// Badges are only claimed once there is enough history to back them:
//   recordLow   7+ days, at the lowest recorded price, and the price has been higher before
//               (a price that never moved is not a "record low").
//   belowUsual  at least 5% under the usual price. The percent is rounded down, never up.
export function priceStats(p, { recordDays = 7, minUsualPercent = 5 } = {}) {
  const prices = p.history.map((h) => h.price);
  const days = prices.length;
  if (!days) return { days, low: p.price, high: p.price, usual: null, usualPercent: null, recordLow: false, belowUsual: false };
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const prevLow = days > 1 ? Math.min(...prices.slice(0, -1)) : Infinity;
  const usual = usualPrice(p.history);
  const usualPercent = usual ? Math.floor(((usual - p.price) / usual) * 100) : null;
  return {
    days, low, high, usual, usualPercent,
    recordLow: days >= recordDays && p.price <= prevLow && p.price < high,
    belowUsual: usualPercent !== null && usualPercent >= minUsualPercent,
  };
}

// "2026년 10월 30일 14시 기준" in KST. With only a date (older records), the hour is unknown,
// so it is left out rather than guessed.
export function asOfKo(seenAt, lastSeen) {
  if (seenAt && !Number.isNaN(Date.parse(seenAt))) {
    const k = new Date(Date.parse(seenAt) + 9 * 36e5);
    return `${k.getUTCFullYear()}년 ${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 ${k.getUTCHours()}시 기준`;
  }
  const [y, m, d] = String(lastSeen ?? '').split('-').map(Number);
  return y && m && d ? `${y}년 ${m}월 ${d}일 기준` : '';
}

const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
const md = (date) => { const [, m, d] = date.split('-').map(Number); return `${m}월 ${d}일`; };

// Inline SVG sparkline, built at build time (no JS). x = day index from the first record,
// so missing days show as gaps in time instead of being squeezed together; the viewBox is
// one unit per day, which keeps every coordinate an integer. Points in the middle of a flat
// run are dropped (lossless) to keep pages small. Stretched to the card width by CSS.
export function sparkline(history, { usual = null, recordLow = false } = {}) {
  if (history.length < 2) return '';
  const t0 = Date.parse(history[0].date);
  const span = Math.max(1, Math.round((Date.parse(history.at(-1).date) - t0) / DAY));
  const prices = history.map((h) => h.price);
  if (!Number.isFinite(usual)) usual = null;
  const min = Math.min(...prices, usual ?? Infinity);
  const max = Math.max(...prices, usual ?? -Infinity);
  // The y range spans at least 10% of the price, so a 1% wiggle doesn't look like a crash.
  const range = Math.max(max - min, max * 0.1) || 1;
  const top = (max + min) / 2 + range / 2;
  const H = 30, pad = 4;
  const y = (v) => Math.round(pad + ((top - v) / range) * (H - 2 * pad));
  const pts = history
    .map((h, i) => ({ x: Math.round((Date.parse(h.date) - t0) / DAY), y: y(h.price), i }))
    .filter(({ i }) => i === 0 || i === prices.length - 1 || !(prices[i - 1] === prices[i] && prices[i] === prices[i + 1]));
  const last = pts.at(-1);
  const label = `${md(history[0].date)}~${md(history.at(-1).date)} 가격 추이: 최저 ${won(Math.min(...prices))}, 최고 ${won(Math.max(...prices))}`;
  return `<svg class="spark" viewBox="0 0 ${span} ${H}" preserveAspectRatio="none" width="120" height="28" role="img" aria-label="${label}">`
    + (usual ? `<path class="u" d="M0 ${y(usual)}H${span}"/>` : '')
    + `<polyline points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}"/>`
    + `<path class="${recordLow ? 'now low' : 'now'}" d="M${last.x} ${last.y}h0"/></svg>`;
}
