# coupang

쿠팡 파트너스 상품(골드박스 · 카테고리 베스트 · 키워드 검색)을 **매일 자동 수집**하고, **가격 이력**을 쌓아서 SEO용 정적 사이트로 발행합니다. 가격이 내려간 상품은 텔레그램 채널에 자동으로 올릴 수도 있습니다(선택).

비용은 **0원**입니다. GitHub Actions(크론)와 GitHub Pages(호스팅)만 씁니다.

```
GitHub Actions (매일 07:13 KST)
  ├─ collect  : 쿠팡 파트너스 Open API → data/products.json (가격 이력 90일)
  ├─ build    : dist/ 정적 HTML + sitemap.xml + rss.xml + robots.txt
  ├─ notify   : 가격 하락 상품 → 텔레그램 채널 (선택)
  ├─ commit   : data/ 커밋 (가격 이력 보존 + 크론 비활성화 방지)
  └─ deploy   : GitHub Pages
```

## 왜 이렇게 만들었나

| 결정 | 이유 |
|---|---|
| 정적 사이트 (서버 없음) | 수수료 사이트는 **트래픽(SEO)** 이 전부입니다. 정적 HTML이 가장 빠르고 색인이 잘 되며, 운영비와 장애 포인트가 없습니다. |
| GitHub Actions + Pages | 크론, 저장소(가격 이력 = git), 배포를 한 곳에서 무료로 처리합니다. Vercel Hobby는 비상업 용도 조건이 있어 수익 사이트에는 맞지 않습니다. |
| 가격 이력 · 가격 하락 페이지 | 단순 상품 나열은 "얇은 콘텐츠"로 검색에서 밀립니다. 매일 쌓이는 가격 기록은 다른 사이트에 없는 고유 데이터라서, 재방문과 검색 유입의 근거가 됩니다. |
| 대가성 문구를 페이지 맨 위와 맨 아래에 고정 | 쿠팡 파트너스 정책과 공정위 지침 때문입니다. 숨기면 수익 몰수나 퇴출 대상이 됩니다. |
| 자동 리다이렉트·플로팅 배너 없음 | 쿠팡이 "납치광고"를 형사 고소하고 수익을 몰수한 사례가 있습니다. 모든 링크는 사용자가 클릭해야만 이동하며, `rel="sponsored nofollow"`를 붙였습니다. |

## 시작하기

### 1) 키 없이 로컬에서 먼저 돌려보기 (MOCK 모드)
```bash
npm run daily      # 키가 없으면 [샘플] 데이터로 생성됩니다
npm run preview    # http://localhost:4173
npm test
```

### 2) GitHub에 올리고 자동화 켜기
1. 이 폴더를 **public** 저장소로 push합니다. 무료 플랜의 Pages는 public 저장소에서만 됩니다.
2. Settings → Pages → Source를 **GitHub Actions**로 바꿉니다.
3. Settings → Secrets and variables → Actions에서 다음을 등록합니다.
   - Secrets: `COUPANG_ACCESS_KEY`, `COUPANG_SECRET_KEY` (파트너스 → 추가기능 → Open API에서 발급)
   - Variables(선택): `COUPANG_SUB_ID` (채널별 실적 구분용)
4. Actions → **check-coupang-api**를 수동 실행합니다. 서명이 맞는지, 해외 IP에서 접속되는지 1회 확인하는 단계입니다.
5. Actions → **daily**를 수동 실행합니다. 그다음부터는 매일 자동으로 돕니다.
6. `site.config.json`의 `baseUrl`, `siteName`, `categories`, `guides`를 내 니치에 맞게 바꿉니다.

키를 넣으면 첫 LIVE 실행 때 샘플 데이터가 자동으로 지워집니다.

### 3) 검색 등록 (트래픽의 핵심)
- **Google Search Console**: 사이트를 등록하고 `sitemap.xml`을 제출합니다.
- **네이버 서치어드바이저**: 사이트를 등록하고 `sitemap.xml`과 `rss.xml`을 제출합니다. 한국 쇼핑 검색 유입의 큰 몫이 네이버에서 옵니다.
- 커스텀 도메인을 권장합니다. `*.github.io`보다 신뢰도와 브랜딩에 유리합니다. 도메인은 Pages 설정에서 연결합니다.

### 4) 텔레그램 채널 (선택)
1. @BotFather로 봇을 만들고, 내 채널에 관리자로 추가합니다.
2. Secret `TELEGRAM_BOT_TOKEN`, Variable `TELEGRAM_CHAT_ID`(예: `@my_channel`)를 등록합니다.
3. `site.config.json`에서 `telegram.enabled: true`로 바꿉니다. 하루에 몇 개를 올릴지와 최소 하락률을 같은 곳에서 조정합니다.

## IP 차단 시 (check 워크플로가 403이나 타임아웃으로 실패할 때)
GitHub 러너는 주로 미국 IP입니다. 쿠팡이 해외나 클라우드 IP를 막는지는 **공식 문서로 확인하지 못했습니다.** 그래서 check 워크플로를 먼저 돌려 보는 것입니다. 막혀 있다면 다음 중 하나로 대신합니다.
- **Self-hosted runner**: 집 PC나 국내 서버에 러너를 설치하고, `runs-on: self-hosted`로 바꿉니다. 코드는 그대로 씁니다.
- **국내 리전 무료 VM**(예: Oracle Cloud 서울)에서 `npm run daily`를 cron으로 돌리고, 결과 `dist/`만 push합니다.

## 커스터마이즈
- `site.config.json` → `guides`: 키워드별 추천 페이지입니다. 실제 사용 후기나 고르는 기준을 `intro`에 직접 쓸수록 SEO와 전환에 유리합니다.
- `limits.searchPerRun`: 검색 API는 호출 제한이 있으므로, 실행할 때마다 가이드 몇 개씩만 번갈아 갱신합니다.
- 카테고리 ID: 1001 여성패션, 1002 남성패션, 1010 뷰티, 1011 출산/유아동, 1012 식품, 1013 주방용품, 1014 생활용품, 1015 홈인테리어, 1016 가전디지털, 1017 스포츠/레저, 1018 자동차용품, 1019 도서/음반/DVD, 1020 완구/취미, 1021 문구/오피스, 1024 헬스/건강식품, 1029 반려동물용품

## 하지 말 것 (정책 위반 = 수익 몰수·퇴출)
- 클릭 없이 쿠팡으로 보내는 자동 리다이렉트, iframe, 숨긴 링크("납치광고")
- 대가성 문구 생략, 작은 글씨나 배경색 글씨로 숨기기
- 본인 링크로 구매하기, 단톡방·댓글 도배
- 쿠팡 상표 키워드에 검색광고 입찰하기

정확한 금지 조항은 운영 전에 반드시 [파트너스 운영정책](https://partners.coupang.com)에서 직접 확인하세요.
