# 인계 문서: 로우프라이스사자 (쿠팡 파트너스 자동화)

마지막 업데이트: 2026-10-26 · 다른 세션·다른 도구(Claude Code, Codex)에서 이어가기 위한 문서입니다.
작업 규칙은 [CLAUDE.md](CLAUDE.md)(Claude용)와 [AGENTS.md](AGENTS.md)(Codex용)에 있습니다.

## 0. 지금 상태 요약 (2026-10-26 기준)

| 구성 | 상태 | 어디서 돌아가나 |
|---|---|---|
| 가격 추적 사이트 https://ely0812.github.io | ✅ 운영 중, 매시간 갱신 | GitHub Actions (클라우드) |
| 텔레그램 채널 @lowprice_saja | ✅ 가격 하락·종료 알림, 아침 골드박스 요약 | GitHub Actions (클라우드) |
| 네이버 블로그 lowprice_saja (예전 아이디 hyemihyemi33) | ✅ 하루 1~2개 예약발행 (2026-10-26 시작) | **사용자 맥** (launchd, 07:10·11:40) |
| 구글·네이버 검색 등록 | ✅ 사이트맵·RSS 제출 완료 | — |

**바로 확인할 것**
- 2026-10-26: 미리 만들어 둔 침낭 가이드 예약 글(가격이 45시간 전 값)은 사용자가 삭제했고, `reservations.json`에서도 뺐습니다(백업 `reservations.backup-20261026.json`). 같은 날 가이드 시간대를 08:10으로 옮겼습니다. 그런데 10/26 07:10 실행은 글을 만들지 않았습니다. 지운 침낭 글이 `ledger.json`에 '10/26에 만든 글'로 남아 있어 하루 개수가 찬 것으로 계산됐기 때문입니다. 그 기록을 지웠습니다(백업 `ledger.backup-20261026.json`). **예약 글을 지울 때는 `reservations.json`과 `ledger.json` 둘 다에서 빼야 합니다.**
- 2026-10-26: '가전·디지털' 분야를 추가했습니다(섹션 `digital`, 쿠팡 카테고리 1016, 가이드 20개: 디지털 기기·액세서리·생활가전). 블로그 카테고리 '가전·디지털'(번호 11)을 만들고 `categories.json`에 연결했으며, 글쓰기 화면에서 선택되는 것까지 확인했습니다. `collect.mjs`는 이제 한 번도 검색하지 않은 가이드를 먼저 검색하므로, 새 가이드는 몇 시간 안에 채워집니다.
- 2026-10-26: 네이버 블로그 아이디가 `hyemihyemi33` → `lowprice_saja`로 바뀌어 있었습니다(예전 주소는 새 주소로 연결됨). `coupang_drafts.py`·`leave.py`의 `BLOG_ID`를 고쳤습니다. 같은 날 블로그용 크롬의 네이버 로그인이 풀려 있어 사용자가 다시 로그인했습니다.
- 발행된 뒤 쿠팡 링크가 실제로 눌리는지 확인해야 합니다. 에디터에서는 `se-link` 노드로 저장되는 것까지 확인했습니다.
- ~~이 맥의 커밋이 GitHub에 push되지 않음~~ → **2026-10-25 완료.** 이 맥에 `gh auth login`(ely0812)을 하고 밀린 커밋 11개를 push했습니다. 로컬 저장소 주소도 새 이름(`ely0812.github.io.git`)으로 바꿨습니다.

## 1. 전체 구조

```
[GitHub Actions, 매시간]                          [사용자 맥, 07:10·11:40]
쿠팡 API 수집 → data/ 커밋 ──git pull──▶ 글 생성(src/blog.mjs)
  ├ 사이트 빌드·배포 (Pages)                       → AI 문장 작성 + 품질 검사(enrich.py)
  └ 텔레그램 알림                                 → 네이버 예약발행(coupang_drafts.py)
```

| 항목 | 값 |
|---|---|
| 저장소 | https://github.com/ely0812/ely0812.github.io (public, 예전 이름 `coupang`). 이 맥의 로컬 경로는 `~/abbys/coupang` |
| 블로그 도구 | `~/abbys/naver-blog-tool/` (**저장소 밖, 재배포 금지 라이선스라 공개 저장소에 올리지 않음**) |
| 블로그 | https://blog.naver.com/lowprice_saja (예전 아이디 hyemihyemi33) · 이름 "로우프라이스사자 \| 쿠팡 최저가 기록" · 주제 상품리뷰 |
| 수익 확인 | 쿠팡 파트너스 → 리포트 |

## 2. 사이트 + 텔레그램 (클라우드, 이 저장소)

### 파일
```
site.config.json        사이트 이름, 섹션, 카테고리, 가이드 65개, 한도, 텔레그램, 검색엔진 확인 태그
src/coupang.mjs         API 클라이언트 (HMAC, CEA 헤더). optionId() = vendorItemId 단위 추적
src/collect.mjs         수집 → data/products.json, data/state.json (검색 시간당 상한·403/429 시 1시간 중지, 새 가이드 우선 검색)
src/build.mjs           data → dist/ 정적 HTML
src/deals.mjs           priceDrops(): 전날 대비 하락률, recordLow(이력 7일 이상)
src/telegram.mjs        아침 요약, 하락 알림(단계별 머리말), 특가 종료 알림, --test
src/blog.mjs            블로그 글 패키지 생성(아래 3절)
src/check.mjs           API 키·접속 점검
test/core.test.mjs      node:test 4개
.github/workflows/daily.yml      매시 13분 + 설정·코드 push 때: collect → build → notify → data 커밋 → Pages 배포
.github/workflows/heartbeat.yml  'heartbeat' 환경 대기 타이머(55분)로 daily를 매시간 재실행하는 보조 장치
.github/workflows/check.yml      수동: API 점검 + 텔레그램 테스트
```

### 사이트 구성
- 5개 섹션: 육아, 자취·생필품, 캠핑, 홈카페·주방, 가전·디지털. 가이드 65개, 베스트 카테고리 8개.
- **검색엔진에 제출한 경로는 바꾸지 마세요:** `/`, `/deals/`, `/goldbox/`, `/topic/<section>/`, `/best/<slug>/`, `/guide/<slug>/`
- 상품이 없는 페이지는 만들지 않습니다.

### 텔레그램 규칙
- 하락률 10% 이상이거나 기록 최저가일 때 게시합니다. **큰 하락도 제외하지 않습니다**(사용자 결정: 짧은 진짜 핫딜일 수 있음).
- 머리말은 하락률에 따라 단계로 나뉩니다.
  - 50% 이상: "🔥 무지성구매급 초특가" + "⏰ 곧 끝날 수 있음"
  - 30% 이상: "⚡ 초특가"
  - 그 외: "📉 가격 하락"
  - "🏆 역대급 최저가"는 실제 기록 최저(7일 이상)일 때만, "N일 기록 중 최저"라는 근거와 함께 씁니다.
- 특가 종료: 알림 가격보다 5% 이상 오르면 원래 글에 "⛔ 종료된 특가"를 붙여 수정하고, 무음 답장을 보냅니다.
- 0~7시에는 무음으로 보내고, 아침 요약은 7시~정오 사이에 1회 보냅니다. 한 번 실행에 최대 3개, 상품마다 하루 1회입니다.

### 비밀값 (GitHub → Settings → Secrets and variables → Actions)
`COUPANG_ACCESS_KEY`, `COUPANG_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`(Secret), `TELEGRAM_CHAT_ID`(Secret 또는 Variable, `@lowprice_saja`). **값을 커밋하거나 채팅에 붙여 넣지 마세요.**

## 3. 네이버 블로그 자동화 (사용자 맥)

### 흐름 (`run_daily.sh` → `adapter/daily.py`)
1. `git pull`로 최신 가격 데이터를 받습니다.
2. 블로그용 크롬을 확인합니다(`start_blog_chrome.sh`, 포트 9222, 전용 프로필 `chrome-profile/`, 네이버 로그인 유지).
3. `plan.py`가 다음 발행 자리를 정합니다(아래 일정 규칙).
4. `node ~/abbys/coupang/src/blog.mjs --date --max --kinds`로 글 틀(`post.json`: `facts`, `blocks`)을 만듭니다.
5. `enrich.py`
   - 로컬 Claude CLI(`~/.local/bin/claude`, sonnet)가 문장만 씁니다: 서론, 상품 코멘트, 고르는 기준, FAQ 3개, 마무리, 태그 10개.
   - 품질 검사를 통과한 글만 진행합니다(`_qc.json`).
6. `coupang_drafts.py --reserve-at`
   - 이미지를 업로드하고, `src`가 채워질 때까지 기다립니다.
   - 본문을 SmartEditor 컴포넌트로 직접 구성합니다(링크·표·이미지 위치 보존).
   - 원본 도구의 `_set_reservation_ex`로 카테고리·태그·시각을 넣고 확정합니다.
7. 성공하면 `reservations.json`에 기록하고 맥 알림을 보냅니다.
   - 예약 전에 실패하면 임시저장으로 보관합니다.
   - 확정은 눌렸지만 결과가 불명확하면 재시도하지 않습니다(중복 방지).

### 일정 규칙 (`adapter/schedule.json`)
| 항목 | 값 |
|---|---|
| 시작 | 2026-10-26. 처음 14일은 하루 1개(가이드와 가격 기록을 번갈아), 그 뒤 하루 2개 |
| 시간대 | 08:10 가이드(아침) / 12:40 가격 하락 기록(점심), 최소 간격 4시간. 2026-10-26 사용자 요청으로 가이드를 저녁 21:10에서 아침으로 옮김 |
| 신선도 | launchd가 발행 1시간 전(07:10, 11:40)에 실행해 **1.5시간 안의 자리만** 예약합니다. 그래서 가격은 1~2시간 전 값입니다 |
| 하루만 추가 | `schedule.json`의 `extraSlots` (`{"YYYY-MM-DD": {"HH:MM": "guide"}}`)와 launchd plist에 그날 1시간 전 실행(Month·Day 지정)을 함께 넣습니다. 10/26 21:10 가이드가 이 방식입니다(실행 20:10). 지난 항목은 지워도 됩니다 |
| 놓쳤을 때 | 맥이 잠자기 상태 등으로 시간을 놓치면 그 자리는 건너뜁니다(낡은 가격으로 올리지 않음) |
| 글 내용 | 가격은 모두 "YYYY년 M월 D일 H시 기준"으로 표기합니다. 파격 할인 단독 글은 블로그에서 뺐습니다(`blog.includeFlash=false`) |

### 로컬 도구 폴더 (`~/abbys/naver-blog-tool/`)
```
naver_blog_v3/            받은 원본 도구. 로컬 패치: macOS 크롬 경로, Cmd+V, 설정 QV_CATEGORY_OVERRIDES["쿠팡상품"]
adapter/daily.py          하루 실행 총괄
adapter/plan.py           발행 일정 계산 (plan.py next 로 다음 자리 확인)
adapter/schedule.json     일정 규칙
adapter/enrich.py         AI 문장 + 품질 검사 (원본 도구 quality_validator·article_quality·ai_tell 사용)
adapter/coupang_drafts.py 네이버 업로드 (예약 또는 임시저장)
adapter/categories.json   카테고리 번호: 가격 하락 기록=6, 육아=7, 자취·생필품=8, 캠핑=9, 홈카페·주방=10, 가전·디지털=11
outbox/<날짜-종류-slug>/  글 폴더: post.json, post.md, preview.html, _qc.json, _result.json/_error.json
ledger.json               생성한 글 기록 (가이드 30일 반복 금지)
reservations.json         예약 기록 (하루 개수 계산)
logs/daily-YYYYMMDD.log   실행 로그
blog_info_backup.json     블로그 예전 소개글 백업
brand/profile.png         프로필 사자 그림 (저장소 brand/ 에도 사본)
run_daily.sh, start_blog_chrome.sh
```
- launchd 설정 파일은 `~/Library/LaunchAgents/com.hyemi.coupang-blog.plist`입니다.

### 블로그 설정 (2026-10-25)
- 이름 "로우프라이스사자 | 쿠팡 최저가 기록", 별명 "로우프라이스사자", 주제 상품리뷰, 사자 프로필 사진, 소개글(텔레그램과 대가성 문구 포함)로 바꿨습니다.
- 카테고리: 가격 하락 기록 / 육아 / 자취·생필품 / 캠핑 / 홈카페·주방 (+ 기존 게시판).
- 스킨은 아직 겨울 눈사람 테마입니다. 단순한 흰색 스킨으로 바꾸기를 권장합니다.
- 상단 메뉴의 '서혜미'는 계정 실명이라 본인에게만 보이며, 블로그 설정으로는 바꿀 수 없습니다.

## 4. 확인된 사실 (실측)
- 쿠팡 API는 GitHub 미국 IP에서도 접속됩니다. 검색을 시간당 28회 넘게 호출해도 차단되지 않았습니다.
- 같은 productId라도 호출마다 다른 옵션(vendorItemId)이 옵니다. 그래서 옵션 단위로 추적합니다(2026-10-23 잘못된 알림 사고 이후).
- SmartEditor 링크 형식은 `{"link":{"url":..,"@ctype":"urlLink"}}`이고, 표는 `@ctype: table` 컴포넌트로 들어가는 것을 확인했습니다.
- 업로드 직후 이미지 `src`는 비어 있습니다. 채워지기 전에 본문을 구성하면 "존재하지 않는 이미지"로 저장됩니다.
- 원본 도구의 본문 변환은 `<a>`의 주소를 버리고 이미지를 흩어 놓습니다. 그래서 쓰지 않습니다.
- 예약은 에디터 상단 "예약 발행 N건"으로 확인할 수 있습니다. 예약된 글은 발행 전까지 글 목록에 보이지 않습니다.
- 품질 검사 결과: 시험한 글 모두 통과했고, ai_tell은 low였습니다. "안전합니다" 같은 단정 표현은 걸러져 다시 쓰였습니다.

## 5. 결정과 경계
- **사이트:** 정적 사이트 + GitHub Pages로 비용 0원. 네이버 서치어드바이저가 호스트 단위 주소만 받아서 저장소 이름을 `ely0812.github.io`로 바꿨습니다.
- **콘텐츠:** 핫딜카페 크롤링·재게시는 하지 않고, 자체 가격 이력만 씁니다. 체험 후기를 지어내지 않고 "고르는 기준"만 씁니다. AI는 숫자를 쓰지 않습니다.
- **광고 표시:** 대가성 문구를 모든 페이지·글의 상단과 하단에 넣습니다(텔레그램은 맨 앞). `rel="sponsored nofollow"`를 쓰고, 자동 리다이렉트와 플로팅 배너는 쓰지 않습니다.
- **Claude가 하지 않은 것(경계):**
  - 네이버 봇 탐지를 속이는 기능은 넣지 않았습니다(사람인 척하는 입력 지연, 자동화 흔적 숨김, 브라우저 지문 바꾸기). 원본 도구의 해당 기능도 켜지 않았습니다. 사용자는 이에 동의하지 않았고 Codex로 하겠다고 했습니다.
  - 되돌릴 수 없는 삭제(임시저장·예약 글 삭제)는 사용자가 직접 했습니다.
  - 비밀번호 입력은 하지 않습니다. 네이버 로그인은 사용자가 블로그용 크롬에서 직접 합니다.

## 6. 일상 운영과 문제 해결

| 상황 | 할 일 |
|---|---|
| 맥 알림 "로그인이 풀렸는지 확인" | 블로그용 크롬 창에서 네이버에 다시 로그인합니다(`~/abbys/naver-blog-tool/start_blog_chrome.sh`) |
| 오늘 예약이 안 됨 | `logs/daily-오늘.log`와 `outbox/*/_qc.json`·`_error.json`을 봅니다. 다음 자리는 `.venv/bin/python adapter/plan.py next`로 확인합니다 |
| 수동으로 한 번 돌리기 | `~/abbys/naver-blog-tool/run_daily.sh` (다음 1.5시간 안에 자리가 있을 때만 예약) |
| 일정 바꾸기 | `adapter/schedule.json` (rampDays, maxPerDay, slots, maxLeadHours). 실행 시각을 바꾸면 launchd plist도 같이 고칩니다 |
| 임시저장 모드로 되돌리기 | `schedule.json`의 `"mode": "draft"` |
| 사이트·텔레그램 문제 | GitHub Actions 실행 기록을 봅니다. heartbeat 체인이 살아 있는지(55분 대기 중인 실행이 있는지) 확인합니다 |

## 7. 남은 할 일 (우선순위 순)
1. **첫 발행 확인:** 10/26에는 발행되지 않았습니다(위 0절). 다음 자동 발행은 10/27 12:40 가격 기록입니다. 그날 로그(`logs/daily-YYYYMMDD.log`)와 맥 알림을 보고, 글이 발행됐는지, 카테고리가 맞는지, 링크가 눌리는지, 표와 이미지가 제대로 보이는지 확인합니다.
2. **10/27 11:40 가격 기록 자동 예약 확인:** 로그와 "예약 발행 1건" 표시를 봅니다.
3. **Codex 로그인:** 사용자가 `codex login`을 직접 합니다(CLI 설치 완료: `~/.local/bin/codex` 0.164.0).
4. **블로그 스킨 교체** (선택, 사용자 승인 필요).
5. **커스텀 도메인 `lowpricesaja.com`** (사용자 결정 대기): DNS A 레코드 4개(185.199.108~111.153)와 `www` CNAME → Pages Custom domain → `baseUrl` 변경 → 검색엔진에 새 속성 등록.
6. **방문자 통계:** Google Analytics 측정 ID를 받아 `<head>`에 넣습니다.
7. **2주 뒤(11/9 전후) 점검:** 블로그 노출·유입, 저품질 신호 여부, 쿠팡 클릭 수. 이를 보고 하루 2개 전환 여부를 판단합니다.

## 8. 작업할 때 주의
- `data/`는 GitHub Actions만 커밋합니다. 로컬에서 collect를 돌렸다면 `git checkout data`로 되돌립니다.
- push 전에는 항상 `git pull --rebase origin main`을 합니다(매시간 data 커밋이 올라옵니다).
- `site.config.json`, `src/**`, `templates/**`를 push하면 즉시 수집과 배포가 한 번 돕니다.
- 이 맥의 GitHub 로그인(`gh`) 권한은 `repo`까지만 있고 `workflow`는 없습니다. `.github/workflows/`를 고쳐서 push하려면 먼저 `gh auth refresh -s workflow`가 필요합니다. 패널 터미널에서는 `gh`의 Y/n 질문에 키 입력이 안 들어가므로 `< /dev/null`을 붙여 웹 코드 방식으로 진행합니다.
- 블로그 도구 폴더(`~/abbys/naver-blog-tool/`)는 git에 넣지 않습니다(라이선스, 그리고 크롬 로그인 프로필이 들어 있음).

## 9. 사용자 정보 (작업 방식)
- 개발자가 아닙니다. 한국어로 **쉽게, 단계별로** 설명합니다. 응답에는 **결론, 신뢰도, 주의사항**을 함께 씁니다.
- 결정할 일은 선택지로 물어보는 방식을 선호합니다. 이미 정한 일은 다시 묻지 않습니다.
- 제약 때문에 못 하는 일은 이유를 짧게 한 번만 설명하고, 대신 할 수 있는 가장 가까운 단계까지 해 둡니다(예: 삭제 직전 화면까지 열어 두기).
