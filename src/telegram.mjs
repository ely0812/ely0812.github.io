// Posts the biggest price drops to a Telegram channel (optional traffic channel).
// Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (e.g. @my_channel). Skips silently otherwise.
import fs from 'node:fs/promises';
import path from 'node:path';
import { priceDrops } from './deals.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = async (f) => JSON.parse(await fs.readFile(path.join(ROOT, f), 'utf8'));
const config = await read('site.config.json');
const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = process.env;

if (!config.telegram.enabled || !token || !chatId) {
  console.log('⏭ 텔레그램 비활성화 (site.config.json telegram.enabled / TELEGRAM_* 환경변수 확인)');
  process.exit(0);
}
const state = await read('data/state.json');
if (state.mode !== 'live') {
  console.log('⏭ MOCK 데이터는 텔레그램에 게시하지 않습니다');
  process.exit(0);
}

const products = await read('data/products.json');
const posted = new Set(state.telegramPosted ?? []);
const today = new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10); // KST date
const drops = priceDrops(products, { minDropPercent: config.telegram.minDropPercent, limit: 50 })
  .filter((d) => !posted.has(`${d.product.id}:${today}`))
  .slice(0, config.telegram.maxPostsPerRun);

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
for (const { product: p, before, percent } of drops) {
  const text = `📉 <b>${esc(p.name)}</b>\n${before.toLocaleString('ko-KR')}원 → <b>${p.price.toLocaleString('ko-KR')}원</b> (-${percent}%)\n${p.rocket ? '🚀 로켓배송\n' : ''}\n<a href="${esc(p.url)}">쿠팡에서 보기</a>\n\n<i>${esc(config.disclosure)}</i>`;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, photo: p.image, caption: text, parse_mode: 'HTML' }),
  });
  if (!res.ok) { console.warn(`⚠ 텔레그램 전송 실패: ${res.status} ${await res.text()}`); continue; }
  posted.add(`${p.id}:${today}`);
  console.log(`✔ 텔레그램 게시: ${p.name}`);
}
state.telegramPosted = [...posted].filter((k) => k.endsWith(today));
await fs.writeFile(path.join(ROOT, 'data/state.json'), JSON.stringify(state, null, 1) + '\n');
