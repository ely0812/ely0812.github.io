// Keeps guide lists on topic. The search API sometimes ignores the keyword and returns
// unrelated products (e.g. "팬티형 기저귀" → cleansing foam, soup stock), so each guide in
// site.config.json names a `match` pattern that a product name must contain.

const patterns = new Map();
const patternOf = (guide) => {
  if (!guide?.match) return null;
  if (!patterns.has(guide.match)) patterns.set(guide.match, new RegExp(guide.match));
  return patterns.get(guide.match);
};

// A guide without `match` accepts everything, so adding a guide never needs a pattern first.
export const onTopic = (guide, name) => !patternOf(guide) || patternOf(guide).test(String(name ?? ''));

// Drops off-topic ids from every guide list. Used when reading data, so lists saved before
// a pattern existed (or changed) are cleaned without waiting for the next search.
export function onTopicLists(lists, products, guides) {
  const out = { ...lists };
  for (const g of guides) {
    const key = `guide:${g.slug}`;
    if (out[key]) out[key] = out[key].filter((id) => onTopic(g, products[id]?.name));
  }
  return out;
}
