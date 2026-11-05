# 고지서 제안 확인 흐름 핸드오프

- 일시: 2026-11-05 14:36:47 (Asia/Seoul)
- 작성자/역할: Copilot / 에이전트·채팅 API
- 목표/담당 피처: 고지서 텍스트 추출→사용자 확인→저장→알림, F03·F05·F06·F07

## 상태

- 완료: 결정적 금액·날짜·공급자·분류 추출, proposal SSE, 10분 임시 proposal 저장, session 검증 confirm API, 중복 확인 방지, 납부기한 없는 needs_review 저장, 세션별 분당 10회 제한.
- 변경 파일: `backend/api/app.py`, `backend/agent/models.py`, `backend/agent/tools.py`, `tests/test_bill_proposals.py`, `tests/test_rate_limit.py`, `tests/fixtures/*.txt`
- 계약 변경: `POST /api/proposals/{proposal_id}/confirm`은 `{ "session_id": "..." }`를 받고, 채팅 저장 요청은 서버 확인 API를 사용해야 한다. SSE `proposal` 데이터는 `proposal_id`, `bill`, `missing_fields`를 포함한다.

## 검증

- 구현 전 새 테스트 실행: 환경 의존성/경로를 보정한 뒤 추출·proposal·rate limit 테스트가 의도대로 실패함을 확인.
- 최종: `PYTHONPATH=. .venv/bin/pytest -q` → 14 passed.
- 최종: `git diff --check`, `PYTHONPATH=. .venv/bin/python -m compileall -q backend tests` 통과.
- 미실행: Azure 배포 및 실제 Copilot 모델 호출 통합 검증.

## 남은 문제와 다음 순서

1. 프런트에서 `proposal` SSE를 받아 `proposal_id`와 `session_id`로 확인 버튼을 연결한다.
2. 확인 버튼은 `POST /api/proposals/{proposal_id}/confirm`만 호출하고, 응답의 `reminders[].at`을 표시한다.
3. 현재 proposal/알림 저장은 단일 프로세스 메모리 전제이므로 운영 영속 저장소 전환 전까지 재시작 시 소실 가능성을 명시한다.

## Git 상태

- 브랜치: `main`
- 커밋/푸시: 하지 않음
- 작업 트리: 본 변경사항과 새 핸드오프가 미커밋 상태
