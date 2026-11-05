# 핸드오프 — 프런트 서버 연결(API 모드)·알림 표시

- 일시: 2026-11-05 15:06 Asia/Seoul
- 작성자/역할: A / 모바일 프런트
- 목표/피처: F04 모바일 채팅·카드·복사 UI 마무리, F07 알림 웹 표시(A 담당분), M2 실제 API 연결

## 상태

- 완료: 프런트 API 모드를 B(채팅 SSE)·C(저장·알림 REST) 실제 계약에 맞춤. 로컬에서 C 서버·B 서버를 띄워 확인.
- 부분 완료: AI 자유 질문 응답은 로컬에서 확인했으나, B·C 저장소가 분리돼 AI 답과 카드·캘린더 자료가 다를 수 있음(남은 문제 1).
- 차단: 없음. 단, B·C 서버가 아직 하나로 합쳐지지 않아 저장소가 둘로 나뉨(남은 문제 1).

## 변경 파일 (frontend/)

- `src/types.ts`: Bill의 `amount_krw`·`due_date`·`checked_at`을 nullable로(C 계약). `reminder_enabled`, `due_date_adjusted`, `Notice` 타입, Reply의 `via`(agent/app/demo)·`tools`·`consent_prompt` 추가.
- `src/api.ts`: 전면 재작성. C REST(`/api/bills`, `/api/notifications`, `/api/reminder-settings`, `/api/rent` GET·PUT, `/api/rent/transfer-text`, `/api/bills/{id}/confirm-paid`, `/health`)와 B 채팅(`/api/chat` SSE: token/tool_call/tool_result/proposal/done/error, `/api/proposals/{id}/confirm`). B 레거시 Bill(category/billing_month/source 객체)도 정규화. 가스 등 MVP 외 항목은 카드에서 제외. 금액·날짜 형식 검증 실패 시 카드로 그리지 않고 오류. 납부 URL은 허용 목록, 아니면 공식 `https://online.kepco.co.kr/`.
- `src/live.ts`(신규): 서버 모드 대화 라우터. 월세 등록·송금 안내·납부 확인·알림 동의는 앱 REST로 직접 처리(`via=app`, 화면에 "앱 API로 처리" 표시). 전기요금 직접 입력은 값을 정리해 B의 `/api/chat` 제안 흐름으로 보내고, 서버 제안 값이 입력값과 다르면 등록 중단. 그 외 질문은 B 에이전트(`via=agent`, "서버 채팅 응답 · 도구 …" 표시). 전기 질문에서 에이전트가 실패하면 실패 사유와 함께 한전ON 공식 링크 카드만 보여줌(가짜 답 없음).
- `src/App.tsx`: 서버 모드에서 30초마다·탭 복귀 시 청구/알림/데모 시간 갱신. 새 알림 토스트·배지·패널 목록(샘플·데모 시간 표시). 등록 직후 채팅 안 알림 동의 카드("알림 받을게요"). 금액·기한 없는 청구는 "금액 미확인/미확인"으로 표시. 송금 안내 문구 원문 표시 후 복사. 월세 카드에 "이번 납부일"(말일 조정 반영). 응답 출처 표시.
- `src/demo.ts`, `src/domain.ts`: null 안전 처리, 데모 알림을 Notice 형식으로, 데모에도 동의 카드.
- `src/styles.css`: 새 요소 스타일. 모바일 토스트를 상단으로 옮겨 입력창을 가리지 않게 함.
- `vite.config.ts`: `/health` 프록시 추가. `VITE_PROXY_TARGET`(기본 8000), `VITE_CHAT_PROXY_TARGET`(B 채팅을 다른 포트로 분리할 때).
- `src/api.test.ts`(신규): 정규화·SSE·라우팅 단위 테스트 10개.

## 계약 관련 결정 (B·C 공유 필요)

1. 프런트는 C의 REST 계약을 기준으로 함. `/api/actions/{id}/confirm`은 더 이상 호출하지 않음.
2. 월세 등록·납부 확인은 현재 B 에이전트에 도구가 없어 프런트가 C REST를 직접 호출함. B가 `register_rent`/`confirm_paid` 도구(MCP)를 붙이면 `live.ts`의 해당 분기를 채팅으로 넘기면 됨.
3. 알림 동의 상태를 읽는 GET API가 C에 없음. 프런트는 브라우저에 마지막 동의 값을 캐시만 함. C가 `GET /api/reminder-settings`를 추가하면 그 값을 쓰도록 바꿀 것.
4. 알림 시각 변경("7시로 바꿔줘")은 C가 3일·1일 전 09시 고정이라 서버 모드에서는 "지원 안 함"으로 안내함.

## 검증

- `npx tsc -b` 통과, `npx vite build` 통과.
- `npx vitest run src`: 3 files, 20 tests 통과(기존 10 + 신규 10).
- `npx playwright test`(데모 모드, 390px·데스크톱): 2 passed.
- 로컬 실연동(브라우저 375×812): C 서버(`origin/yuhyoon-c-backend-deploy` 기준, DEMO_MODE=1) + 프런트 API 모드.
  - 월세 31일 등록 → 누락 없음 → 대화 내 확인 → PUT 저장 → 말일 조정 안내(2026-11-30) → 서버 송금 문구 표시·복사 버튼.
  - 알림 동의 카드 → `/api/reminder-settings` → 데모 시간 +410h → 전기요금 3일 전 알림 토스트·배지·패널 표시("합성 샘플 · 데모 시간").
  - "월세 냈어" → 확인 카드 → confirm-paid → "납부 기록 완료 · 사용자 확인".
  - C 단독 서버에서 전기요금 질문 → 채팅 없음 → 실패 사유 + 한전ON 공식 링크 카드. 가로 넘침 없음(scrollWidth 375).
- B 서버(`origin/feat/bill-proposal-flow`) + C 서버 분리 실행: 전기요금 32,500원/2026-11-20 직접 입력 → B `extract_bill` 제안 카드 → 확인 → 저장 성공.
- 같은 구성에서 "이번 달 뭐 내야 해?" → B 에이전트(Copilot) 실제 SSE 응답 수신·표시(약 60초 소요). 답에 B 샘플 월세 500,000원이 나와 C에 등록한 월세(450,000원)와 다름 → 저장소 분리 문제 재확인.
- 미실행/미확인: 실제 휴대폰, 클립보드 실기기 복사, Azure 배포 URL, 한전ON 이동 후 복귀(실기기), DEMO_PASSWORD Basic 인증 화면.

## 남은 문제와 다음 순서

1. (B·C) 서버 통합: 지금은 B의 제안 저장이 B 인메모리 저장소로, C의 `/api/bills`는 SQLite를 봄. 하나의 앱(C `main.py` + B 채팅 라우터)에서 같은 저장소를 쓰게 맞춰야 전기요금 직접 등록 결과가 캘린더·알림에 반영됨.
2. (B) 채팅 라우터를 C 앱에 `app/chat.py`로 붙이면 프런트는 설정 변경 없이 동작. 따로 띄울 때는 `VITE_CHAT_PROXY_TARGET` 사용.
3. (A) 배포 빌드는 `VITE_APP_MODE=api npm run build` 후 `dist/`를 C 컨테이너의 `STATIC_DIR`로 제공. 실제 휴대폰에서 F09 시연 순서대로 확인.
4. (C) 동의 상태 조회 API 추가 검토, Azure URL 확정 후 공유.

## Git

- 브랜치 `codex/chat-frontend`, 시작 시 HEAD `75ecbe6`.
- 이번 변경은 위 frontend 파일과 이 핸드오프만. git add·커밋·푸시 안 함. 다른 브랜치 merge/pull 안 함(원격 백엔드는 읽기 전용으로 확인).
