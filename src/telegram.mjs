// Posts sharp price drops and record lows to a Telegram channel (optional traffic channel).
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
if (process.argv.includes('--test')) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: `✅ ${config.siteName} 채널 연결 테스트\n${config.baseUrl}` }),
  });
  console.log(res.ok ? '✔ 텔레그램 테스트 메시지 전송 성공' : `✖ 실패: ${res.status} ${await res.text()}`);
  process.exit(res.ok ? 0 : 1);
}
const state = await read('data/state.json');
if (state.mode !== 'live') {
  console.log('⏭ MOCK 데이터는 텔레그램에 게시하지 않습니다');
  process.exit(0);
}

const kstHour = new Date(Date.now() + 9 * 36e5).getUTCHours();
const [quietFrom, quietTo] = config.telegram.quietHours ?? [0, 7];
if (kstHour >= quietFrom && kstHour < quietTo) {
  console.log(`⏭ 조용한 시간(${quietFrom}~${quietTo}시 KST)이라 게시하지 않음`);
  process.exit(0);
}

const products = await read('data/products.json');
const posted = new Set(state.telegramPosted ?? []);
const today = new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10); // KST date
const drops = priceDrops(products, { minDropPercent: 3, limit: 100 })
  .filter((d) => d.percent >= config.telegram.minDropPercent || d.recordLow)
  .filter((d) => !posted.has(`${d.product.id}:${today}`))
  .slice(0, config.telegram.maxPostsPerRun);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const site = config.baseUrl.replace(/\/$/, '');
const send = (method, body) => fetch(`https://api.telegram.org/bot${token}/${method}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: chatId, parse_mode: 'HTML', ...body }),
});
for (const { product: p, before, percent, recordLow } of drops) {
  // Disclosure goes first: SNS ad guidelines expect it at the top of the post.
  const text = `<i>${esc(config.disclosure)}</i>\n\n${recordLow ? '🏆 <b>기록 최저가</b>\n' : ''}📉 <b>${esc(p.name)}</b>\n${before.toLocaleString('ko-KR')}원 → <b>${p.price.toLocaleString('ko-KR')}원</b> (-${percent}%)\n${p.rocket ? '🚀 로켓배송\n' : ''}\n👉 <a href="${esc(p.url)}">쿠팡에서 보기</a>\n📊 <a href="${site}/deals/">오늘의 가격 하락 전체</a>`;
  // Fall back to a text message if Telegram cannot fetch the product image.
  let res = await send('sendPhoto', { photo: p.image, caption: text });
  if (!res.ok) res = await send('sendMessage', { text, link_preview_options: { is_disabled: true } });
  if (!res.ok) { console.warn(`⚠ 텔레그램 전송 실패: ${res.status} ${await res.text()}`); continue; }
  posted.add(`${p.id}:${today}`);
  console.log(`✔ 텔레그램 게시: ${p.name}`);
}
state.telegramPosted = [...posted].filter((k) => k.endsWith(today));
await fs.writeFile(path.join(ROOT, 'data/state.json'), JSON.stringify(state, null, 1) + '\n');
