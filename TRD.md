# TRD — 120분 MVP 구현 방향

- 기준: 2026-11-05 / 3명 / 구현 전 계획.
- 범위: 한전 조회, 월세 직접 등록·송금 안내 텍스트, 채팅/카드, 웹 내 자동 알림.
- PRD F01–F09 기준. 기존 대규모 인프라와 F01–F14 계획은 대체한다.

## 1. 최소 구성

- 프런트: React + Vite + TypeScript 정적 빌드. A 담당.
- 백엔드: Python/FastAPI + Agent Framework의 Copilot SDK 연동 제공자. B 담당.
- FastAPI에서 프런트 빌드도 제공하는 단일 컨테이너로 Azure Container Apps에 배포한다.
- C가 한전 어댑터·SQLite 저장·내부 알림 작업·배포를 담당한다.
- 모델 인증·패키지 호환은 처음부터 실제 컨테이너에서 검증하고 버전을 고정한다.
- Azure 모델 서비스 추가, 관리형 PostgreSQL, Blob/Key Vault 별도 프로비저닝, 외부 이메일/캘린더는 MVP에서 제외한다.
- 서버 비밀은 환경별 Container Apps secrets로 관리하고 로그에서 제외한다. Git에는 설정 이름과 예제만 저장한다.

## 2. 한전 연결과 대체 경로

공식 EDS 또는 민간 API 중 사용 가능한 경로 하나만 선택한다. 개인 청구액과 납부기한을 반환하는지 검증한다. API 목록 조회를 실청구 조회로 오인하지 않는다. 조사 근거는 `docs/research/utility-integrations.md`를 참조한다.

15분까지 권한·인증·필드를 확인하지 못하면 `SampleKepcoAdapter`로 전환한다. 동일 스키마를 사용하고 모든 관련 카드에 샘플을 표시한다. 이후 조회/알림 흐름은 실제 앱 코드로 동작한다. 샘플 응답을 실기관 연결 성과로 발표하지 않는다.

웹훅·공급기관 백그라운드 수집은 필수 범위가 아니다. MVP에서는 최초 연결/조회 때 얻은 청구에 알림을 예약한다. 실제 정기 조회는 인증 갱신과 호출 조건이 확인될 때만 추가한다.

## 3. 공통 계약 — 시작 10분에 동결

Bill: id, kind(electricity/rent), period(YYYY-MM), amount_krw(정수), due_date(YYYY-MM-DD), autopay(true/false/null), status(pending/user_confirmed), source(real/sample/manual), checked_at, payment_url(전기만, nullable).

RentConfig: amount_krw, due_day, bank, account_number(문자열), account_holder, start_month. 누락 필드는 null이며 채팅으로 보완한다. 계좌번호를 숫자로 변환하지 않는다. 월별 Bill을 생성하며 없는 지정일은 사용자에게 알린 월말 정책을 적용한다.

Reminder: bill_id, scheduled_at_utc, state(pending/delivered/cancelled), policy_version. 키는 bill_id+예약시각으로 고정해 재시도 시 갱신한다.

Chat 응답: message, bill_cards[], rent_transfer_text(nullable), pending_action(nullable), mode(real/sample). 스트리밍은 SSE로 text_delta와 최종 구조화 결과를 구분한다. 카드 값은 도구 응답/DB 필드에서 구성한다.

## 4. 에이전트·도구

Agent Framework로 의도→도구 조회/등록→응답을 구성하고 Copilot SDK로 모델을 실행한다. 별도 다중 에이전트는 만들지 않는다.

- MCP `get_electricity_bill`: 조회 어댑터 결과를 반환한다. 프로젝트 내부의 제한된 MCP 서버 한 개를 stdio로 연결하는 방향을 먼저 검증한다.
- 함수 도구 `prepare_rent`: 입력을 파싱하고 누락 필드 또는 등록 제안을 반환한다.
- 함수 도구 `save_rent`: 대화에서 확인한 제안 ID를 서버가 검증해 저장한다. 실제 송금 기능 없음.
- 함수 도구 `get_rent_transfer_text`: 저장한 월세에서 복사할 안내 텍스트 생성.
- 함수 도구 `confirm_paid` / `set_reminder_enabled`: 사용자 확인 기록, 해당 청구 알림 중지/설정.

MCP 인증이나 패키지 연결이 막히면 같은 어댑터를 함수 도구로 연결해 핵심을 유지한다. 이 경우 MCP 미구현을 명시한다. 도구 명칭은 계획이며 구현 완료를 뜻하지 않는다.

제안 API: POST /api/chat, GET /api/bills, GET /api/notifications, POST /api/actions/{id}/confirm, POST /api/reminder-settings, GET /health. B는 채팅/행동, C는 조회/알림·저장 계약을 담당한다. 인증과 데모 사용자 범위는 공통 의존성이다.

## 5. 알림과 저장

- 초기 동의한 뒤 유효 납부일을 저장할 때 3일 전·1일 전 KST 오전 9시 예약.
- 서버 내부 작업이 주기적으로 due 항목을 delivered로 바꾸며 웹은 조회해 토스트/알림 목록 표시. 웹 미접속 중 기록도 다음 접속 시 보인다.
- 브라우저 종료 중 OS 푸시를 제공하지 않는다. 서버 다운/스케일 0 동안은 작업이 실행되지 않으므로 데모 서버 최소 replica 1 설정을 검토한다.
- 기한 수정은 이전 예약 취소·재계산, 사용자 납부 확인은 해당 월의 남은 예약 취소. 자동이체는 출금 예정 문구.
- 시연 모드의 시간 이동은 별도 데모 설정으로 격리·표시한다. 실제 납부일을 몰래 변경하지 않는다.
- SQLite 단일 프로세스·단일 replica를 전제로 한다. 영속 볼륨이 준비돼 있으면 사용한다. 없으면 컨테이너 재배포/교체 때 데이터가 사라질 수 있음을 명시하고 합성 데모 데이터를 재주입한다. 영속 저장 완료라고 주장하지 않는다.
- 범용 작업 큐·배치 서비스·외부 캘린더는 추가하지 않는다.

## 6. 오류와 최소 보안

- 금액/날짜 스키마 검증 실패 시 채팅 질문. 별도 내용 검토 화면 없음.
- 조회 없음, 인증 만료, 외부 장애를 구분하며 임의 청구 생성 금지.
- 샘플은 합성 데이터, 실제 비밀번호·OTP·개인정보·계좌를 Git/로그/모델에 넣지 않음.
- 공개 다중 사용자 기능 제외. 보호된 단일 데모 사용자로 접근을 제한하고 API도 같은 보호를 적용한다. 브라우저 번들에 비밀을 넣지 않는다.
- 공식 납부 URL은 허용 목록에서 가져온다. 외부 데이터 내 명령은 무시한다.
- 안내 복사·링크 열기는 상태 변경 없음. '사용자 납부 확인'과 기관 검증을 구분한다.

## 7. 배포와 통합

C가 초기부터 컨테이너 골격과 /health를 배포한다. Dockerfile과 재실행 가능한 배포 명령을 남긴다. Azure 구독 또는 Copilot 런타임 인증이 막히면 즉시 공유한다. 로컬 동작만으로 Azure 배포 성공이라고 하지 않는다.

90분부터 신규 기능 중단. 전기 질문→MCP→카드, 월세 입력→저장→복사, 등록→알림, 납부 확인→알림 중지, 실패→오류 표시를 검증한다. 최소 로그는 요청 ID·도구명·시간·성공/실패만 남긴다.
