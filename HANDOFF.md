# 인계 문서: 생활 최저가 노트 (쿠팡 파트너스 자동화)

마지막 업데이트: 2026-10-22 · 클라우드 세션에서 만든 작업을 로컬이나 다른 세션에서 이어가기 위한 문서입니다.

## 1. 한눈에 보기

| 항목 | 값 |
|---|---|
| 사이트 | https://ely0812.github.io |
| 저장소 | https://github.com/ely0812/ely0812.github.io (public, 예전 이름 `coupang`) |
| 텔레그램 채널 | 로우프라이스사자 · https://t.me/lowprice_saja |
| 호스팅 | GitHub Pages (Source = GitHub Actions) |
| 자동 실행 | `daily.yml`: 매시 13분 cron + 설정·코드 push 때 · `heartbeat.yml`: 55분 대기 타이머로 `daily`를 매시간 재실행하는 보조 장치 |
| 검색 등록 | Google Search Console(`https://ely0812.github.io/`) 확인·사이트맵 제출 완료 · 네이버 서치어드바이저 확인·사이트맵·RSS 제출 완료 |
| 수익 확인 | 쿠팡 파트너스 → 리포트 |

**동작:** 매시간 쿠팡 파트너스 Open API로 골드박스, 카테고리 베스트(상위 50), 키워드 검색을 수집합니다. 그 결과를 `data/`에 날짜별 가격 이력으로 쌓습니다. 이어서 정적 사이트(`dist/`)를 만들어 Pages에 배포하고, 가격이 하락하면 텔레그램에 게시합니다.

## 2. 사이트 구성

4개 섹션, 키워드 가이드 45개, 베스트 카테고리 7개로 이루어져 있습니다(`site.config.json`).

| 섹션 | 카테고리 ID | 가이드 |
|---|---|---|
| 육아 `baby` | 1011 출산/유아동, 1030 유아동패션, 1020 완구/취미 | 15 |
| 자취·생필품 `living` | 1014 생활용품, 1012 식품 | 10 |
| 캠핑 `camping` | 1017 스포츠/레저 | 10 |
| 홈카페·주방 `homecafe` | 1013 주방용품 | 10 |

페이지 경로는 아래와 같습니다. 이미 검색엔진에 제출했으니 **경로를 바꾸지 마세요.**
- `/` 홈
- `/deals/` 가격 하락
- `/goldbox/` 골드박스
- `/topic/<section>/` 섹션별 모아보기
- `/best/<slug>/` 카테고리 베스트
- `/guide/<slug>/` 키워드 가이드
- `sitemap.xml`, `rss.xml`, `robots.txt`

상품이 없는 가이드나 카테고리 페이지는 만들지 않고 사이트맵에서도 뺍니다.

## 3. 파일 구조

```
site.config.json        사이트 이름, 섹션, 카테고리, 가이드, 한도, 텔레그램, 검색엔진 확인 태그
src/coupang.mjs         API 클라이언트 (HMAC 서명, CEA 헤더). err.status 포함
src/collect.mjs         수집 → data/products.json, data/state.json
src/build.mjs           data → dist/ 정적 HTML
src/deals.mjs           priceDrops(): 직전 날짜 대비 하락률, recordLow(이력 7일 이상)
src/telegram.mjs        아침 골드박스 요약 + 가격 하락 알림. `--test`로 연결 테스트
src/check.mjs           API 키와 접속 점검 (키 길이와 앞 4자리만 표시)
src/mock.mjs            키 없을 때 샘플 데이터
templates/style.css     스타일 (다크모드 포함)
test/core.test.mjs      node:test 4개
.github/workflows/daily.yml   매시 실행: collect → build → notify → data 커밋(pull --rebase) → Pages 배포
.github/workflows/check.yml   수동 실행: API 점검 + 텔레그램 테스트 메시지
.github/workflows/heartbeat.yml  'heartbeat' 환경의 대기 타이머(55분) 뒤 daily와 자기 자신을 재실행(체인). 타이머가 없으면 45분 미만 대기를 감지하고 멈춤
```

### data/state.json 주요 필드
| 필드 | 의미 |
|---|---|
| `mode` | `live`(실제 데이터) 또는 `mock`(샘플 데이터) |
| `lists` | 페이지별 상품 ID 목록 (`goldbox`, `best:<slug>`, `guide:<slug>`) |
| `guideCursor` | 다음에 검색할 가이드 위치 |
| `searchLog` | 최근 1시간 검색 호출 시각. `limits.maxSearchPerHour`(20)로 제한 |
| `searchPausedUntil` | 검색 API가 403/429를 반환하면 1시간 동안 검색 중지 |
| `telegramPosted` | 오늘 이미 게시한 상품 (`<id>:<date>`, 중복 방지) |
| `digestDate` | 아침 골드박스 요약을 마지막으로 보낸 날짜 |

## 4. 비밀값과 설정 (GitHub → Settings → Secrets and variables → Actions)

| 이름 | 종류 | 설명 |
|---|---|---|
| `COUPANG_ACCESS_KEY` | Secret | 파트너스 Open API Access Key |
| `COUPANG_SECRET_KEY` | Secret | 파트너스 Open API Secret Key |
| `TELEGRAM_BOT_TOKEN` | Secret | @BotFather로 발급한 토큰 |
| `TELEGRAM_CHAT_ID` | Secret 또는 Variable | `@lowprice_saja` (워크플로가 둘 다 읽음) |
| `COUPANG_SUB_ID` | Variable (선택) | 채널별 실적 구분용, 미설정 |

**비밀값은 절대 커밋하거나 채팅에 붙여 넣지 마세요.** 로컬에서는 `.env`에 둡니다(`.gitignore` 처리됨).

## 5. 확인된 사실 vs 미확인

**확인됨 (2026-10-22 실측)**
- API 서명 방식이 정상 작동합니다. GitHub 미국 러너 IP(20.169.x.x)에서도 접속됩니다. IP 차단 없음.
- 검색 API를 약 1시간 안에 28회 넘게 호출했지만 모두 성공했습니다. 블로그에 나온 "시간당 10회"는 현재 적용되지 않는 것으로 보입니다.
- `bestcategories`에 `limit=50`을 넣어도 정상입니다. 카테고리 1030(유아동패션)도 유효합니다.
- 상품 링크가 `link.coupang.com/re/AFFSDP?lptag=...` 형태로 오는 것을 확인했습니다. 이 링크로 구매하면 수수료가 추적됩니다.
- 텔레그램 봇 게시 테스트에 성공했습니다.

- ⚠️ 같은 productId라도 호출마다 **다른 옵션(vendorItemId, 용량·묶음 수)** 이 돌아옵니다. 그래서 상품은 `vendorItemId`(옵션) 단위로 추적합니다(`optionId()`). 2026-10-23에는 productId 단위로 비교하는 버그 때문에 잘못된 "-45~50%" 알림 3건이 텔레그램에 나갔고, 같은 날 수정했습니다. 마이그레이션은 `state.idScheme = 'option'`으로 표시합니다.

**미확인**
- 파트너스 API의 공식 호출 한도. 블로그에서는 검색 10회/시간, 전체 100회/분, 초과 시 24시간 차단이라고 합니다.
- 골드박스 응답에 `discountRate`가 들어오는지. 들어오지 않으면 아침 요약은 API가 준 순서대로 정렬됩니다.

## 6. 내린 결정과 이유

- **정적 사이트 + GitHub Actions/Pages:** 비용 0원이고 서버를 관리할 필요가 없습니다. Vercel Hobby는 비상업용 조건이라 제외했습니다.
- **저장소 이름 변경 (`coupang` → `ely0812.github.io`):** 네이버 서치어드바이저는 `호스트 단위` URL만 받습니다.
- **핫딜카페 크롤링이나 재게시는 하지 않음:** 약관 위반, 커뮤니티의 레퍼럴 금지 규칙, 글 복제 문제가 있습니다. 대신 자체 가격 이력으로 하락을 감지합니다.
- **대가성 문구:** 사이트에서는 모든 페이지의 상단과 하단에 넣었습니다. 텔레그램에서는 글 맨 앞에 넣었습니다. 링크에는 `rel="sponsored nofollow"`를 붙였습니다. 자동 리다이렉트와 플로팅 배너는 쓰지 않습니다. 쿠팡이 "납치광고"를 제재한 사례가 있습니다.
- **가이드 소개글:** 사용 후기가 아니라 "고르는 기준"으로만 썼습니다. 써 보지 않은 제품의 후기를 쓰면 광고 규정 위반입니다.
- **텔레그램:**
  - 하락률 10% 이상이거나 기록 최저가일 때 게시합니다.
  - 한 번 실행에 최대 3개, 상품마다 하루 1회입니다.
  - 0~7시(KST)에도 게시하지만 무음(disable_notification)으로 보냅니다(`silentHours`).
  - 아침 요약은 7시~정오 사이 하루 1회 보냅니다(`digestHour`).

## 6-1. 예약 실행 문제와 보조 장치 (2026-10-22)
- 새 저장소에서 GitHub cron(`daily.yml`, 매시 13분)이 3시간 연속 실행되지 않았습니다. 워크플로 상태는 active, 실행 주체는 ely0812로 정상이었습니다.
- 보조 장치 `heartbeat.yml`을 만들었습니다. 동작하려면 **Settings → Environments → `heartbeat` → Wait timer 55분** 설정이 필요합니다(이 세션의 프록시는 환경 API를 막고 있어 사용자가 직접 설정). 설정한 뒤 Actions에서 heartbeat를 한 번 수동 실행하면 체인이 시작됩니다.
- 체인이 끊겨도 `heartbeat.yml`의 6시간 cron이 다시 살립니다(GitHub cron이 동작할 경우).

## 7. 남은 할 일 (우선순위 순)

1. **커스텀 도메인 (사용자 결정 대기):** 후보는 `lowpricesaja.com`입니다. 사용자가 도메인을 산 뒤 할 일은 다음과 같습니다.
   - DNS에 A 레코드 4개(185.199.108~111.153)와 `www` CNAME(→ `ely0812.github.io`)를 추가합니다.
   - Pages → Custom domain에 입력하고, Enforce HTTPS를 켭니다.
   - `site.config.json`의 `baseUrl`을 새 주소로 바꾸고, 구글과 네이버에 새 속성을 등록합니다(확인 태그는 `verification` 필드).
2. **방문자 통계:** Google Analytics 측정 ID(`G-...`)를 받아 `<head>`에 넣습니다. 아직 미구현입니다.
3. **일주일 뒤 점검:**
   - 텔레그램 알림이 실제로 올라오는지 봅니다.
   - `searchPausedUntil`이 생긴 적이 있는지 봅니다.
   - 서치 콘솔과 서치어드바이저의 색인 수를 봅니다.
   - 쿠팡 리포트의 클릭 수를 봅니다.
4. **README 정리:** 일부 설명이 초기 버전 기준입니다.

## 8. 로컬에서 이어가기

```bash
git clone https://github.com/ely0812/ely0812.github.io.git
cd ely0812.github.io
npm test                 # 테스트 (외부 의존성 없음, Node 20.11+)
npm run build            # 커밋된 실제 데이터로 dist/ 생성
npm run preview          # http://localhost:4173 미리보기
claude                   # Claude Code 실행 → CLAUDE.md와 이 문서를 자동으로 참고
```

### 주의 (중요)
- **로컬에서 `npm run collect`나 `npm run daily`를 돌린 뒤 `data/`를 커밋하지 마세요.**
  - 키 없이 돌리면 샘플 데이터가 섞입니다.
  - 키를 넣고 돌리면 검색 호출 한도를 함께 씁니다.
  - 테스트한 뒤에는 `git checkout data`로 되돌리세요.
- 원격 저장소에는 매시간 GitHub Actions가 `data:` 커밋을 올립니다. **push 전에 항상 `git pull --rebase origin main`을 먼저 실행하세요.**
- `site.config.json`, `src/**`, `templates/**`를 push하면 즉시 수집과 배포가 한 번 실행됩니다. 짧은 시간에 여러 번 push하면 검색 호출이 몰립니다. 이때는 시간당 상한이 보호해 줍니다.

## 9. 사용자 정보 (작업 방식)
- 개발자가 아닙니다. 한국어로 **쉽게, 단계별로** 설명하는 방식을 선호합니다.
- 응답에 **결론, 신뢰도, 주의사항**을 함께 적어 달라고 요청했습니다.
- 브라우저나 GitHub 설정 화면 조작은 사용자가 직접 합니다. Claude가 할 수 없는 단계는 클릭 경로를 링크와 함께 안내합니다.
