# cheongdo-ciry

1인 가구의 전기요금과 월세를 채팅으로 챙기는 독립 도우미. 현재 구현 전 기획 단계입니다.

## 3명 · 120분 MVP

- 한전 전기요금 조회 → 금액·납부일 카드 → 공식 납부 페이지 안내.
- 월세 금액·납부일·은행·계좌번호·예금주 직접 등록 → 복사 가능한 송금 안내 텍스트.
- 납부일 최초 인식 후 동의한 정책으로 자동 알림. MVP는 웹 내 알림이며 백그라운드 푸시는 제외합니다.
- 한전 접근은 시작 15분 안에 판정합니다. 실패하면 샘플을 명시하고 동일한 흐름을 시연합니다.
- 가스·보험, 실제 송금·결제, 월간 요약, 별도 내용 확인/중복 관리 화면은 제외합니다.

## 문서

- [PRD: 목적·피처·3명 분업·120분 일정](PRD.md)
- [TRD: 기술 구성·공통 계약·배포](TRD.md)
- [TDD: 선택한 방향의 이유](docs/TDD.md)
- [AGENTS: 작업 규칙과 필수 핸드오프](docs/AGENTS.md)
- [공과금 연동 조사](docs/research/utility-integrations.md)
- [작업 인계 기록](docs/handoffs/)

이전 핸드오프는 당시 상태를 보존한 기록입니다. 현재 범위는 최신 PRD를 따릅니다.

## 실행

Python 환경:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# .env의 COPILOT_GITHUB_TOKEN에 실제 토큰을 로컬에서만 설정
uvicorn backend.api.app:app --reload --port 8000
```

Copilot CLI 인증은 `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN` 중
하나를 환경변수로 전달합니다. 토큰은 코드·로그·Docker 이미지에 넣지 않습니다.

Docker:

```bash
docker build -t cheongdo-ciry-backend .
docker run --rm --env-file .env -p 8000:8000 cheongdo-ciry-backend
```

컨테이너는 `PORT` 환경변수(기본값 `8000`)로 uvicorn을 실행하며,
`docker run --env-file`로 전달된 Copilot 인증 환경변수를 그대로 사용합니다.
