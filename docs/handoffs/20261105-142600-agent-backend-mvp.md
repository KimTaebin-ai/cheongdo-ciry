# Agent Backend MVP Handoff

- 일시: 2026-11-05 14:26:00 Asia/Seoul
- 작성자/역할: Copilot / 에이전트·백엔드 담당
- 목표/담당 피처: F02, MVP 2~6단계

## 상태

- 완료: Bill 계약, 5개 도구, 인메모리 샘플 3건
- 완료: FastAPI SSE chat, 세션 문맥, bills/reminders/healthz API, CORS
- 완료: 모델/도구 오류 분리, focused pytest, Dockerfile 및 인증 환경변수 문서
- Docker `/healthz`: 성공
- Docker `/api/chat`: 토큰을 주입하지 않은 smoke 실행이라 모델 오류 이벤트 반환

## 검증

- `PYTHONPATH=. /tmp/cheongdo-ciry-venv/bin/python -m pytest -q`
- 결과: `7 passed, 12 warnings`
- `docker build -t cheongdo-ciry-backend .`: 성공
- Docker `GET /healthz`: `{"status":"ok"}`
- Docker `POST /api/chat`: `event: error`, `{"kind":"model","message":"모델 호출에 실패했어요"}`
- 컨테이너 로그 원인: `No GitHub OAuth token or Copilot HMAC key provided`

## 커밋

- `70e570b feat(agent): add bill tools and sample store`
- `de6da99 feat(agent): add SSE chat and bill API`
- `1157c04 feat(agent): handle model and tool failures`
- `0e8e1d0 feat(agent): add focused bill and reminder tests`
- `3bc73c0 feat(agent): document container authentication and execution`

푸시는 하지 않았다. 현재 브랜치는 `feat/agent-backend`다.
