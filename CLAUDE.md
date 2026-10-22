# CLAUDE.md

쿠팡 파트너스 가격추적 정적 사이트(https://ely0812.github.io)입니다. **작업 전에 `HANDOFF.md`를 먼저 읽으세요.** 결정 배경, 확인된 사실, 남은 할 일이 정리되어 있습니다.

## 명령
- `npm test`: node:test로 실행합니다. 의존성이 없습니다.
- `npm run build`: `data/`의 데이터로 `dist/`를 만듭니다.
- `npm run preview`: 만든 `dist/`를 http://localhost:4173 에서 미리 봅니다.
- `npm run collect` / `npm run daily`: API를 호출하고 `data/`를 바꿉니다. 로컬에서 돌렸다면 `git checkout data`로 되돌립니다.

## 규칙
- `data/`는 GitHub Actions만 커밋합니다. 로컬이나 샘플 데이터는 절대 커밋하지 않습니다.
- push 전에는 항상 `git pull --rebase origin main`을 실행합니다. 매시간 data 커밋이 올라오기 때문입니다.
- 이미 검색엔진에 제출한 URL 경로(`/guide/<slug>/`, `/best/<slug>/`, `/topic/<slug>/`)를 바꾸지 않습니다.
- 대가성 문구, `rel="sponsored nofollow"`, 자동 리다이렉트 금지 원칙을 유지합니다. 텔레그램에서는 문구를 글 맨 앞에 둡니다.
- 비밀값(API 키, 봇 토큰)은 코드나 채팅에 넣지 않습니다. GitHub Secrets나 로컬 `.env`에만 둡니다.
- 사용자는 비개발자입니다. 한국어로, 단계별로, 결론·신뢰도·주의사항을 함께 답합니다.
