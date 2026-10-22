// One-shot connectivity check: verifies the HMAC signature and that this host's IP
// can reach the Coupang Partners API. Run it once on any new host before relying on cron.
import { createClient } from './coupang.mjs';

const { COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY } = process.env;
if (!COUPANG_ACCESS_KEY || !COUPANG_SECRET_KEY) {
  console.error('✖ COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY 환경변수를 설정하세요');
  process.exit(1);
}
const ip = await fetch('https://api.ipify.org').then((r) => r.text()).catch(() => '알 수 없음');
console.log(`이 서버의 공인 IP: ${ip}`);
try {
  const items = await createClient({ accessKey: COUPANG_ACCESS_KEY, secretKey: COUPANG_SECRET_KEY }).search('텀블러', 1);
  console.log(`✔ 성공: 서명과 네트워크 모두 정상 (검색 결과 ${items.length}건)`, items[0]?.productName ?? '');
} catch (e) {
  console.error(`✖ 실패: ${e.message}`);
  console.error('  401/서명 오류 → 키 확인 · 403/타임아웃 → 이 호스트 IP가 차단됐을 수 있음 (README "IP 차단 시" 참고)');
  process.exit(1);
}
