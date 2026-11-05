# TRD — 120분 MVP 구현 방향

- 기준: 2026-11-05 / 3명 / 구현 전 계획.
- 플랫폼: 모바일 우선 반응형 웹앱을 Azure에 배포. 설치형 네이티브 앱 아님.
- 범위: 한전ON 공식 연결, 월세 직접 등록·송금 안내 텍스트, 채팅/카드, 웹 내 자동 알림.
- PRD F01–F09 기준. 기존 대규모 인프라와 F01–F14 계획은 대체한다.

## 1. 최소 구성

- 프런트: React + Vite + TypeScript 정적 빌드. A(사용자) 담당.
- 백엔드: Python/FastAPI + Agent Framework의 Copilot SDK 연동 제공자. B 담당.
- FastAPI에서 프런트 빌드도 제공하는 단일 컨테이너로 Azure Container Apps에 배포한다.
- C가 수동 청구·SQLite 저장·내부 알림 작업·배포를 담당한다.
- 모델 인증·패키지 호환은 처음부터 실제 컨테이너에서 검증하고 버전을 고정한다.
- Azure 모델 서비스 추가, 관리형 PostgreSQL, Blob/Key Vault 별도 프로비저닝, 외부 이메일/캘린더는 MVP에서 제외한다.
- 서버 비밀은 환경별 Container Apps secrets로 관리하고 로그에서 제외한다. Git에는 설정 이름과 예제만 저장한다.

## 2. 한전ON 공식 연결

전기요금은 https://online.kepco.co.kr/ 공식 링크만 제공한다. 모바일 사용자의 동작으로 외부 브라우저/탭에서 연다. 앱 안 iframe, 계정정보 전달, 세션 복사, 원격 브라우저 인계, 조회 API 연결은 제외한다. 페이지를 열었다는 사실만으로 납부 완료를 기록하지 않는다. 외부 페이지를 닫거나 뒤로 돌아왔을 때 기존 채팅을 유지한다.

금액·납부일은 사용자가 직접 등록한 값만 앱에 저장한다. 한전ON에서 확인한 결과를 자동으로 읽었다고 표현하지 않는다. 데모 값은 source=sample, 직접 입력은 source=manual로 구분한다.
개인 청구 자동 조회 접근 수단은 미확보로 판정한다. `SampleKepcoAdapter`는 시연용 합성 청구를 제공하며 카드·답변에 샘플임을 표시한다. 직접 입력 청구는 proposal 확인 후 저장하고 알림을 자동 예약한다.

## 3. 공통 계약 — 시작 10분에 동결

Bill: id, kind(electricity/rent), period(YYYY-MM), amount_krw(정수), due_date(YYYY-MM-DD), autopay(true/false/null), status(pending/user_confirmed), source(real/sample/manual), checked_at, payment_url(전기만, nullable).

RentConfig: amount_krw, due_day, bank, account_number(문자열), account_holder, start_month. 누락 필드는 null이며 채팅으로 보완한다. 계좌번호를 숫자로 변환하지 않는다. 월별 Bill을 생성하며 없는 지정일은 사용자에게 알린 월말 정책을 적용한다.

Reminder: bill_id, scheduled_at_utc, state(pending/delivered/cancelled), policy_version. 키는 bill_id+예약시각으로 고정해 재시도 시 갱신한다.

Chat 응답: message, bill_cards[], rent_transfer_text(nullable), pending_action(nullable), mode(real/sample). 스트리밍은 SSE로 text_delta와 최종 구조화 결과를 구분한다. 카드 값은 도구 응답/DB 필드에서 구성한다.

## 4. 에이전트·도구

Agent Framework로 의도→도구 조회/등록→응답을 구성하고 Copilot SDK로 모델을 실행한다. 별도 다중 에이전트는 만들지 않는다.

- MCP 후보 `get_registered_bills`: 앱에 직접 등록된 청구를 조회한다. 한전 조회 기능이 아니다. MCP 연결은 시간 내 검증하며 실패 시 함수 도구로 대체하고 미구현을 공개한다.
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

90분부터 신규 기능 중단. 전기 질문→등록 청구 조회→금액·기한·출처 표시→공식 연결 버튼, 직접 입력→proposal→확인 저장→알림, 월세 입력→저장→복사, 등록→알림, 납부 확인→알림 중지, 실패→오류 표시를 검증한다. 최소 로그는 요청 ID·도구명·시간·성공/실패만 남긴다.

## 8. A(사용자)의 모바일 검증

390×844 화면에서 가로 넘침, 터치 버튼, 소프트 키보드와 입력창, 긴 계좌번호 줄바꿈, 복사 실패 대안, 한전ON 이동 후 복귀를 확인한다. 최종 모바일 검증은 실제 휴대폰에서 수행하며 데스크톱 화면 크기 변경만으로 통과라고 하지 않는다. PC 브라우저 확장 설치를 사용자 필수 조건으로 두지 않는다.

## 9. 백엔드 확인 결과와 MCP 통합 방향

확인 기준: 원격 main `8dc0e32f4ed40a7d1130b05f1065b7d20910d14e` (2026-11-05). 로컬 프런트 브랜치에는 아직 백엔드를 병합하지 않았다. 원격 코드 정적 확인이며 실행 성공을 재검증한 것은 아니다.

### 이미 있는 함수 도구

`backend/agent/tools.py`의 `make_tools(store)`가 아래 Python 함수 5개를 반환하며, `backend/api/app.py`의 `GitHubCopilotAgent(tools=make_tools(store))`에 등록돼 있다.

| 기존 도구 | 실제 코드의 역할 | 제한 |
|---|---|---|
| list_bills | category/month로 청구 조회 | 인메모리 저장소와 샘플 데이터 |
| get_bill | ID별 청구 조회 | 없는 자료는 null |
| extract_bill | 붙여 넣은 텍스트에서 정규식으로 금액·날짜 추출 | 이미지 해석 아님, 저장하지 않음 |
| save_bill | Bill 스키마 검증 후 저장 | 저장 동의는 현재 시스템 지시문에 의존. 서버 검증 승인 ID는 미구현 |
| get_reminders | 미래 3일 전·1일 전 오전 9시 예정 시각 계산 | 예약 영속화·실제 발송·변경·취소 아님 |

이 코드에는 MCP 서버 생성·도구 노출·클라이언트 연결 구성이 없다. 현재는 Agent Framework 함수 도구 연결이며 MCP 구현 완료로 표시하지 않는다. 한국어 항목 키워드로 서버가 list_bills를 먼저 호출하는 prefetch 경로도 있다.

### 합의한 목표 구조

모바일 채팅 → Agent Framework + Copilot SDK → 앱 MCP 서버 → 청구/월세 저장과 알림 처리 → 실제 실행 결과를 채팅 카드로 반환.

기존 함수를 서비스 계층으로 재사용하고 MCP 래퍼만 추가한다. 별도 저장소나 알림 로직을 MCP에 중복 구현하지 않는다. 같은 행위를 함수 도구와 MCP 양쪽에서 동시에 실행하지 않는다. MCP 연결은 stdio 등 지원 방식을 컨테이너에서 검증한다.

| 목표 MCP 이름 | 기존 코드 대응 / 추가 작업 |
|---|---|
| register_bill | save_bill 재사용. 필수값 검증, 기본 알림 생성 연결 필요 |
| register_rent | 기존 save_bill을 활용하되 계좌정보와 반복 월세 설정 모델 추가 필요 |
| list_due_bills | list_bills/get_bill 재사용. 기간 필터와 응답 정규화 필요 |
| update_reminder | 신규 구현. get_reminders는 변경 기능이 아님 |
| confirm_paid | 신규 구현. 사용자 확인 근거와 해당 월 알림 중지 필요 |
| get_payment_guide | 신규 래퍼. 한전ON 공식 링크 또는 등록한 월세 송금 텍스트 반환. 실제 결제 없음 |

사진을 사용한다면 이미지 해석은 에이전트의 모델 입력 단계로 두고 별도 사진 읽기 MCP 도구는 요구하지 않는다. 현재 ChatRequest는 session_id/message만 받아 이미지 전달 경로가 없으므로 이미지 기능은 미구현이다. 선택 모델의 이미지 지원과 SDK 전달 방식 확인 전 제공한다고 표시하지 않는다. 기존 extract_bill 제거는 이번 문서 작업에 포함하지 않는다.

### 프런트·백엔드 통합 시 먼저 맞출 계약

- 프런트 `frontend/src/api.ts`는 text_delta/result SSE와 최종 Reply(message/mode/bill_cards)를 기대한다.
- 현재 백엔드는 token/tool_call/tool_result/done/error 이벤트를 보낸다. 최종 Reply 변환이 필요하다.
- 프런트 Bill은 kind/period/source 문자열, 백엔드는 category/billing_month/source 객체 등 다른 구조다. 어댑터를 하나 두거나 계약을 함께 변경한다.
- 프런트가 쓰는 /api/actions/{id}/confirm은 확인한 백엔드에 없다. 승인 처리를 구현하거나 호출 계약을 맞춘다.
- 저장 성공 도구 결과를 받은 후에만 '등록했어요'라고 응답한다. 등록 실패·누락값은 채팅으로 처리한다.
- 모델 승인 지시문, approve_all 설정만으로 서버의 사용자 승인·접근 통제가 완성되는 것은 아니다. 실제 권한과 쓰기 실행 검증을 구현한다.
