# AGENTS.md

쿠팡 파트너스 가격추적 사이트(https://ely0812.github.io), 텔레그램 채널(@lowprice_saja), 네이버 블로그(lowprice_saja, 예전 아이디 hyemihyemi33) 자동화 프로젝트입니다. **작업 전에 [HANDOFF.md](HANDOFF.md)를 먼저 읽으세요.** 구조, 실측한 사실, 결정, 남은 일이 정리되어 있습니다.

## 명령
- `npm test`: node:test (의존성 없음)
- `npm run build`: `data/` → `dist/`
- `npm run preview`: http://localhost:4173
- `node src/blog.mjs --out <dir> [--date YYYY-MM-DD --max N --kinds roundup,guide]`: 블로그 글 패키지 생성
- 블로그 업로드 도구는 저장소 밖 `~/abbys/naver-blog-tool/`에 있습니다(`run_daily.sh`, `adapter/*.py`, Python venv `.venv`).

## 규칙
- `data/`는 GitHub Actions만 커밋합니다. 로컬·샘플 데이터는 커밋하지 않습니다.
- push 전에는 항상 `git pull --rebase origin main`을 합니다.
- 검색엔진에 제출한 URL 경로(`/guide/<slug>/`, `/best/<slug>/`, `/topic/<slug>/`)는 바꾸지 않습니다.
- 대가성 문구, `rel="sponsored nofollow"`, 자동 리다이렉트 금지를 유지합니다. 텔레그램에서는 문구를 글 맨 앞에 둡니다.
- 블로그 글에서 가격·할인율은 데이터에서만 넣고, 기준 시각을 표기합니다. 체험 후기를 지어내지 않습니다.
- 비밀값(API 키, 봇 토큰, 네이버 비밀번호)은 코드·문서·채팅에 넣지 않습니다.
- `~/abbys/naver-blog-tool/`은 제3자 도구(재배포 금지 라이선스)와 브라우저 로그인 프로필을 담고 있으므로 이 저장소나 다른 곳에 올리지 않습니다.
- 사용자는 비개발자입니다. 한국어로, 단계별로, 결론·신뢰도·주의사항을 함께 답합니다.
