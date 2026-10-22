// One-shot connectivity check: verifies the HMAC signature and that this host's IP
// can reach the Coupang Partners API. Run it once on any new host before relying on cron.
import { createClient } from './coupang.mjs';

const { COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY } = process.env;
if (!COUPANG_ACCESS_KEY || !COUPANG_SECRET_KEY) {
  console.error('✖ COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY 환경변수를 설정하세요');
  process.exit(1);
}
// Masked shape of each key, to spot swapped or mis-pasted values without exposing them.
const shape = (k) => `${k.trim().length}자, ${k.trim().slice(0, 4)}…${k !== k.trim() ? ' (앞뒤 공백 있음 → 자동 제거)' : ''}`;
console.log(`ACCESS_KEY: ${shape(COUPANG_ACCESS_KEY)}`);
console.log(`SECRET_KEY: ${shape(COUPANG_SECRET_KEY)}`);
const ip = await fetch('https://api.ipify.org').then((r) => r.text()).catch(() => '알 수 없음');
console.log(`이 서버의 공인 IP: ${ip}`);
try {
  const items = await createClient({ accessKey: COUPANG_ACCESS_KEY, secretKey: COUPANG_SECRET_KEY }).search('텀블러', 1);
  console.log(`✔ 성공: 서명과 네트워크 모두 정상 (검색 결과 ${items.length}건)`, items[0]?.productName ?? '');
} catch (e) {
  console.error(`✖ 실패: ${e.message}`);
  if (/not registered/i.test(e.message)) {
    console.error('  → 쿠팡 서버에는 접속됨(IP 차단 아님). ACCESS_KEY 값이 쿠팡에 등록된 키와 다릅니다.');
    console.error('    ① ACCESS/SECRET 이 서로 바뀌지 않았는지 ② 파트너스(partners.coupang.com)에서 발급한 키인지(Wing 판매자 키 아님) ③ 재발급 후 옛 키가 아닌지 확인하세요.');
  } else {
    console.error('  401/서명 오류 → 키 확인 · 403/타임아웃 → 이 호스트 IP가 차단됐을 수 있음 (README "IP 차단 시" 참고)');
  }
  process.exit(1);
}
