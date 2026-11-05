# 핸드오프 — 프런트 도구 의도를 에이전트 경유로 연결

- 일시: 2026-11-05 Asia/Seoul
- 작성자/역할: A / 모바일 프런트
- 목표/피처: M2 실제 API 연결. F04 채팅, F05 에이전트 도구 사용, F07 알림 표시

## 상태

- 완료: 월세 등록·송금 안내·납부 확인·알림 켜기/끄기를 먼저 `/api/chat` 에이전트로 보내 서버 도구(save_rent, rent_transfer_text, confirm_paid, set_reminder_enabled)를 쓰게 함.
- 안전장치: 도구 제안 값이 화면 값과 같을 때만 그 제안(`/api/proposals/{id}/confirm`)으로 저장. 에이전트 실패·45초 초과·값 불일치면 기존 앱 REST로 처리(via=app). 가짜 응답 없음.
- 부분 완료: 납부 확인·알림 켜기/끄기는 서버의 규칙 경로가 없어 모델 호출이 필요함. 로컬은 모델 인증이 없어 시간 초과 → REST 경로로 동작.

## 변경 파일 (frontend/)

- `src/live.ts`: 도구 의도별 에이전트 우선 라우팅, `agentTool`, `consentViaAgent`, 월세 구조화 메시지(`rentMessage`)·값 비교(`sameRent`).
- `src/api.ts`: 제안 이벤트에 `action`·`payload` 보존(save_bill 외 제안도 받음), done 본문을 `final`로 보존, `streamChat` 시간 제한 인자, `confirmProposal`이 `bills`·`notice`도 반환.
- `src/types.ts`: Action에 `proposal_id`.
- `src/api.test.ts`: 에이전트 경로 테스트 3개 추가.

## 검증

- `npx tsc -b` 통과, `npx vite build` 통과, `npx vitest run src` 23개 통과.
- 로컬 통합 백엔드(`backend.app.main`, DEMO_MODE=1)에 직접 요청:
  - 월세 구조화 메시지 → `save_rent` tool_call·proposal 수신, 값 일치 → confirm 저장 성공(rent-2026-11, 2026-11-08).
  - "월세 송금 안내 보여줘" → done에 `rent_transfer_text` 수신.
  - 납부 확인 요청 → 모델 시간 초과 error(로컬 모델 인증 없음).
- 미실행: 브라우저 화면 확인, 모델 인증된 서버에서 confirm_paid·set_reminder_enabled 실제 호출, 실기기, Azure URL.

## 남은 문제와 다음 순서

1. (B) 배포 서버의 모델 인증 확인 후 "전기요금 납부했어", "알림 꺼줘"에서 tool_call이 오는지 확인.
2. (B) 필요하면 납부 확인·알림 켜기/끄기도 `_deterministic_chat`에 규칙 경로 추가(모델 없이 도구 사용, 응답 빠름).
3. (A) `VITE_APP_MODE=api`로 브라우저 확인, 응답 출처 표시가 "서버 채팅 응답 · 도구 …"로 나오는지 확인.
4. 계좌번호 등은 에이전트 메시지로 서버에 전달됨. 합성 예시 값으로만 시연.

## Git

- 브랜치 `main`, HEAD `fca22db`. 위 4개 파일 수정 + 핸드오프 2개(이 파일, figma 재작성본) 미추적.
- add·커밋·푸시·fetch 하지 않음.
