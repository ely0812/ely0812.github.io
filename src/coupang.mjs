// Coupang Partners Open API client (zero dependencies).
// Auth: HMAC-SHA256 over `${signedDate}${method}${path}${query}`, sent as a CEA Authorization header.
import crypto from 'node:crypto';

const HOST = 'https://api-gateway.coupang.com';
const BASE = '/v2/providers/affiliate_open_api/apis/openapi/v1';

function signedDate(d = new Date()) {
  // yyMMddTHHmmssZ in UTC
  const p = (n) => String(n).padStart(2, '0');
  return (
    p(d.getUTCFullYear() % 100) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
    'T' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z'
  );
}

export function authorization(method, path, query, accessKey, secretKey, date = new Date()) {
  const dt = signedDate(date);
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(dt + method + path + query)
    .digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${dt}, signature=${signature}`;
}

export function createClient({ accessKey, secretKey, subId } = {}) {
  // Pasted secrets often carry stray spaces or newlines.
  accessKey = accessKey?.trim();
  secretKey = secretKey?.trim();
  subId = subId?.trim() || undefined;
  if (!accessKey || !secretKey) throw new Error('COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY 가 필요합니다');

  async function call(method, endpoint, params = {}, body) {
    const path = BASE + endpoint;
    const query = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    ).toString();
    const res = await fetch(HOST + path + (query ? `?${query}` : ''), {
      method,
      headers: {
        Authorization: authorization(method, path, query, accessKey, secretKey),
        'Content-Type': 'application/json;charset=UTF-8',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || (json.rCode && json.rCode !== '0')) {
      const err = new Error(`Coupang API ${res.status} ${endpoint}: ${json.rMessage || json.message || 'unknown error'}`);
      err.status = res.status;
      throw err;
    }
    return json.data;
  }

  return {
    goldbox: () => call('GET', '/products/goldbox', { subId }),
    best: (categoryId, limit = 20) =>
      call('GET', `/products/bestcategories/${categoryId}`, { limit, subId }),
    search: async (keyword, limit = 10) =>
      (await call('GET', '/products/search', { keyword, limit, subId }))?.productData ?? [],
    deeplink: (urls) => call('POST', '/deeplink', {}, { coupangUrls: urls, subId }),
  };
}

// Normalize the slightly different shapes returned by goldbox / best / search.
// The same productId can come back as different options (pack size, quantity) between
// calls, so prices are tracked per option (vendorItemId) to avoid fake "price drops".
export function optionId(p) {
  try {
    return new URL(p.productUrl).searchParams.get('vendorItemId') || String(p.productId);
  } catch {
    return String(p.productId);
  }
}

export function normalize(p) {
  return {
    id: optionId(p),
    productId: String(p.productId),
    name: p.productName,
    price: Number(p.productPrice) || 0,
    image: p.productImage,
    url: p.productUrl, // already an affiliate (partners) link
    rocket: Boolean(p.isRocket),
    freeShipping: Boolean(p.isFreeShipping),
    category: p.categoryName || '',
    discountRate: p.discountRate ?? null,
    originalPrice: p.originalPrice ?? null,
  };
}
