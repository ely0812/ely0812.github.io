// Detects products whose latest price is lower than the previous recorded price.
export function priceDrops(products, { minDropPercent = 5, limit = 20 } = {}) {
  const today = Object.values(products).reduce((d, p) => (p.lastSeen > d ? p.lastSeen : d), '');
  return Object.values(products)
    .filter((p) => p.lastSeen === today && p.history.length >= 2)
    .map((p) => {
      const before = p.history.at(-2).price;
      const percent = Math.round(((before - p.price) / before) * 100);
      return { product: p, before, percent };
    })
    .filter((d) => d.percent >= minDropPercent)
    .sort((a, b) => b.percent - a.percent)
    .slice(0, limit);
}
