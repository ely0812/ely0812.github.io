// Posts sharp price drops and record lows to a Telegram channel (optional traffic channel).
// Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (e.g. @my_channel). Skips silently otherwise.
import fs from 'node:fs/promises';
import path from 'node:path';
import { priceDrops } from './deals.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = async (f) => JSON.parse(await fs.readFile(path.join(ROOT, f), 'utf8'));
const config = await read('site.config.json');
const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = process.env;

if (process.argv.includes('--test') && Boolean(token) !== Boolean(chatId)) {
  console.error(`✖ 텔레그램 설정이 반쪽만 되어 있습니다: ${token ? 'TELEGRAM_CHAT_ID' : 'TELEGRAM_BOT_TOKEN'} 가 없습니다`);
  process.exit(1);
}
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

const escAttr = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const kstHour = new Date(Date.now() + 9 * 36e5).getUTCHours();
// Late-night posts still go out (night owls catch deals) but arrive without sound.
const [silentFrom, silentTo] = config.telegram.silentHours ?? [0, 7];
const silent = kstHour >= silentFrom && kstHour < silentTo;
if (silent) console.log(`🔕 ${silentFrom}~${silentTo}시(KST)라 무음으로 게시`);

const products = await read('data/products.json');
const today0 = new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);

// Morning digest: once a day, the first run from digestHour (KST) to noon posts today's top goldbox deals.
if (config.telegram.morningDigest && state.digestDate !== today0 && kstHour >= (config.telegram.digestHour ?? 7) && kstHour < 12) {
  const top = (state.lists.goldbox ?? []).map((id) => products[id]).filter(Boolean)
    .sort((a, b) => (b.discountRate ?? 0) - (a.discountRate ?? 0)).slice(0, 5);
  if (top.length) {
    const lines = top.map((p, i) => `${i + 1}. <a href="${escAttr(p.url)}">${escAttr(p.name)}</a>\n    <b>${p.price.toLocaleString('ko-KR')}원</b>${p.discountRate ? ` (-${p.discountRate}%)` : ''}${p.rocket ? ' 🚀' : ''}`);
    const text = `<i>${escAttr(config.disclosure)}</i>\n\n☀️ <b>오늘의 쿠팡 골드박스 TOP ${top.length}</b> (하루 한정 특가)\n\n${lines.join('\n\n')}\n\n📊 <a href="${config.baseUrl.replace(/\/$/, '')}/goldbox/">골드박스 전체 보기</a>`;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
    });
    if (res.ok) { state.digestDate = today0; console.log('✔ 아침 골드박스 요약 게시'); }
    else console.warn(`⚠ 아침 요약 전송 실패: ${res.status} ${await res.text()}`);
  }
}
const posted = new Set(state.telegramPosted ?? []);
const today = new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10); // KST date
const drops = priceDrops(products, { minDropPercent: 3, limit: 100 })
  .filter((d) => d.percent >= config.telegram.minDropPercent)
  .filter((d) => !posted.has(`${d.product.id}:${today}`))
  .slice(0, config.telegram.maxPostsPerRun);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const site = config.baseUrl.replace(/\/$/, '');
const send = (method, body) => fetch(`https://api.telegram.org/bot${token}/${method}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: chatId, parse_mode: 'HTML', disable_notification: silent, ...body }),
});
// Hot-deal community style headline, tiered by discount. "역대급" is used only when the
// price really is the lowest we have recorded, and says over how many days (no unfounded claims).
function headline(percent, recordLow, days) {
  const t = config.telegram.tiers ?? { insane: 50, hot: 30 };
  const tags = [];
  if (percent >= t.insane) tags.push('🔥 <b>무지성구매급 초특가</b>');
  else if (percent >= t.hot) tags.push('⚡ <b>초특가</b>');
  else tags.push('📉 <b>가격 하락</b>');
  if (recordLow) tags.push(`🏆 <b>역대급 최저가</b> (${days}일 기록 중 최저)`);
  const hurry = percent >= t.insane ? '\n⏰ 수량·시간 한정일 수 있어요. 곧 끝날 수 있음!' : '';
  return tags.join(' · ') + hurry;
}

// Deal-end notices: when an alerted item's price climbs back (>= endRisePercent above the
// alerted price), mark the original post as ended and reply to it, so late readers don't
// click through to an expired deal. End notices carry no affiliate link, so no disclosure.
const active = (state.activeDeals ??= {});
const endRise = 1 + (config.telegram.endRisePercent ?? 5) / 100;
const staleBefore = new Date(Date.now() + 9 * 36e5 - 7 * 864e5).toISOString().slice(0, 10);
for (const [id, d] of Object.entries(active)) {
  const p = products[id];
  if (!p || p.lastSeen < staleBefore) { delete active[id]; continue; }
  if (p.price < d.price * endRise) continue;
  const won = (n) => `${n.toLocaleString('ko-KR')}원`;
  const mark = `⛔ <b>종료된 특가</b> · 지금 ${won(p.price)}`;
  const edited = d.text.replace('\n\n', `\n\n${mark}\n`);
  if (d.messageId) {
    await send(d.kind === 'photo' ? 'editMessageCaption' : 'editMessageText', {
      message_id: d.messageId,
      ...(d.kind === 'photo' ? { caption: edited } : { text: edited, link_preview_options: { is_disabled: true } }),
    });
  }
  const res = await send('sendMessage', {
    text: `⛔ <b>특가 종료</b>\n${esc(d.name)}\n${won(d.price)} → 지금 <b>${won(p.price)}</b>\n\n늦게 보신 분은 다음 알림을 기다려 주세요 🙏`,
    disable_notification: true,
    ...(d.messageId ? { reply_parameters: { message_id: d.messageId, allow_sending_without_reply: true } } : {}),
  });
  if (res.ok) { delete active[id]; console.log(`⛔ 특가 종료 알림: ${d.name}`); }
  else console.warn(`⚠ 종료 알림 실패: ${res.status} ${await res.text()}`);
}

for (const { product: p, before, percent, recordLow } of drops) {
  // Disclosure goes first: SNS ad guidelines expect it at the top of the post.
  const text = `<i>${esc(config.disclosure)}</i>\n\n${headline(percent, recordLow, p.history.length)}\n<b>${esc(p.name)}</b>\n${before.toLocaleString('ko-KR')}원 → <b>${p.price.toLocaleString('ko-KR')}원</b> (-${percent}%)\n${p.rocket ? '🚀 로켓배송\n' : ''}\n👉 <a href="${esc(p.url)}">쿠팡에서 보기</a>\n📊 <a href="${site}/deals/">오늘의 가격 하락 전체</a>`;
  // Fall back to a text message if Telegram cannot fetch the product image.
  let kind = 'photo';
  let res = await send('sendPhoto', { photo: p.image, caption: text });
  if (!res.ok) { kind = 'text'; res = await send('sendMessage', { text, link_preview_options: { is_disabled: true } }); }
  if (!res.ok) { console.warn(`⚠ 텔레그램 전송 실패: ${res.status} ${await res.text()}`); continue; }
  const messageId = (await res.json().catch(() => ({})))?.result?.message_id;
  active[p.id] = { name: p.name, price: p.price, before, messageId, kind, text, postedAt: today };
  posted.add(`${p.id}:${today}`);
  console.log(`✔ 텔레그램 게시: ${p.name}`);
}
state.telegramPosted = [...posted].filter((k) => k.endsWith(today));
await fs.writeFile(path.join(ROOT, 'data/state.json'), JSON.stringify(state, null, 1) + '\n');
