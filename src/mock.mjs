// Deterministic fake API so the whole pipeline runs before you have API keys.
// Prices drift by day so price-history / price-drop features can be tested.
const NAMES = ['무선 이어폰', '에어프라이어', '로봇청소기', '전기포트', '텀블러', '물티슈', '생수 2L', '고양이 모래', '보조배터리', '수납박스', '샴푸', '견과류'];

function rand(seed) {
  let x = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0) % 2147483647 || 1;
  const next = () => (x = (x * 48271) % 2147483647) / 2147483647;
  next(); next(); // warm up so nearby seeds diverge
  return next;
}

function make(prefix, count, seed, category = '') {
  const day = Math.floor(Date.now() / 864e5);
  return Array.from({ length: count }, (_, i) => {
    const r = rand(seed * 1000 + i);
    const base = Math.round((5000 + r() * 195000) / 100) * 100;
    const drift = 1 + (rand(day * 31 + seed + i)() - 0.5) * 0.3;
    const id = `${prefix}${seed}${i}`;
    return {
      productId: id,
      productName: `[샘플] ${NAMES[(seed + i) % NAMES.length]} ${i + 1}호`,
      productPrice: Math.round((base * drift) / 10) * 10,
      productImage: `https://picsum.photos/seed/${id}/400/400`,
      productUrl: 'https://www.coupang.com/',
      isRocket: r() > 0.4,
      isFreeShipping: r() > 0.3,
      categoryName: category,
    };
  });
}

export function mockClient() {
  return {
    goldbox: async () => make('g', 20, 7, '골드박스'),
    best: async (categoryId, limit) => make('b', limit, categoryId),
    search: async (keyword, limit) => make('s', limit, [...keyword].reduce((a, c) => a + c.charCodeAt(0), 0)),
  };
}
