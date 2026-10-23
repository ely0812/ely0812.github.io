// Detects products whose latest price is lower than the previous day's recorded price.
// Drops above maxDropPercent are almost always data glitches (option or price-field changes), not deals.
export function priceDrops(products, { minDropPercent = 5, maxDropPercent = 60, limit = 20 } = {}) {
  const today = Object.values(products).reduce((d, p) => (p.lastSeen > d ? p.lastSeen : d), '');
  return Object.values(products)
    .filter((p) => p.lastSeen === today && p.history.length >= 2)
    .map((p) => {
      const before = p.history.at(-2).price;
      const percent = Math.round(((before - p.price) / before) * 100);
      const prevLow = Math.min(...p.history.slice(0, -1).map((h) => h.price));
      // A "record low" only means something once there is enough history.
      const recordLow = p.history.length >= 7 && p.price < prevLow;
      return { product: p, before, percent, recordLow };
    })
    .filter((d) => d.percent >= minDropPercent && d.percent <= maxDropPercent)
    .sort((a, b) => b.percent - a.percent)
    .slice(0, limit);
}
