// Naver blog guide titles: built only from real collected data (brands, prices).
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;

// Brand = first word of the product name after promo words ("최신형", "[무료배송]").
// If that word is a usage/generic word ("탁상용", "핸드폰"), the item itself, or a word other
// product names use mid-name ("자외선 차단" -> descriptor, not a brand), the product has no brand.
const PROMO = /^([[(].*|.*[\])]|최신형|신형|신제품|정품|국산|국내산|무료배송|특가|NEW|\d.*|1\+1)$/i;
const GENERIC = /^(.+용|핸드폰|휴대폰|스마트폰|아기|유아|아동|어린이|캠핑|차량|대용량|미니|무선|유선|접이식|초경량|프리미엄|고급|가성비|국민|순면|유기농|스텐|스테인리스|원목|일체형|올인원|키즈폰)$/;
export function brandsOf(items, itemWords = [], names = []) {
  const words = itemWords.flatMap((w) => [w.replace(/\s/g, ''), ...w.split(/\s+/)]).filter((w) => w.length >= 2);
  const midCount = new Map();
  for (const n of names) for (const w of n.split(/\s+/).slice(1)) midCount.set(w, (midCount.get(w) ?? 0) + 1);
  const out = [];
  for (const p of items) {
    const b = p.name.split(/\s+/).map((w) => w.replace(/[,.]+$/, '')).find((w) => w && !PROMO.test(w));
    if (!b || b.length < 2 || b.length > 10 || GENERIC.test(b) || (midCount.get(b) ?? 0) >= 2) continue;
    if (words.some((w) => b.includes(w) || w.includes(b))) continue;
    if (!out.some((o) => o.toLowerCase() === b.toLowerCase())) out.push(b);
  }
  return out;
}

// Long-tail titles: subject + real brands + real prices, in three rotating patterns so
// consecutive guide posts don't all look the same in search results.
export function guideTitle({ subject, brands, prices, month, style }) {
  const n = prices.length;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = min === max ? won(min) : `${won(min)}~${won(max)}`;
  const one = brands.length === 1;
  const many = (k) => brands.slice(0, k).join('·');
  switch (style % 3) {
    case 0:
      return `${subject} 가격 비교 | ${brands.length ? `${many(3)} ${n}${one ? '종' : '개'}` : `${n}개`}, ${won(min)}부터`;
    case 1:
      return `${month}월 ${subject} 최저가 정리${brands.length > 1 ? `: ${brands.slice(0, 2).join(' vs ')}` : one ? `: ${brands[0]} ${n}종` : ''} (${range})`;
    default:
      return `${subject} 고르기 전 가격 기록 확인 (${brands.length > 1 ? `${many(2)} 등 ${n}개` : one ? `${brands[0]} ${n}종` : `${n}개`})`;
  }
}
