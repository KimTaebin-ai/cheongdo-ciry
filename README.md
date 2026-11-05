# cheongdo-ciry

1인 가구의 전기요금과 월세를 채팅으로 챙기는 독립 도우미. 모바일 우선 반응형 웹앱을 목표로 하며 구현 상태는 실제 코드와 핸드오프를 확인합니다.

## 3명 · 120분 MVP

- 채팅에서 한전ON 공식 링크 제공 → 사용자가 모바일에서 직접 조회·인증·납부.
- 월세 금액·납부일·은행·계좌번호·예금주 직접 등록 → 복사 가능한 송금 안내 텍스트.
- 납부일 최초 인식 후 동의한 정책으로 자동 알림. MVP는 웹 내 알림이며 백그라운드 푸시는 제외합니다.
- 한전 자동 인증·조회와 원격 브라우저 인계는 제외합니다. 금액·납부일은 사용자가 직접 등록할 수 있습니다.
- A(사용자)는 모바일 프런트·시연, B는 에이전트·API, C는 저장·알림·Azure 배포 담당입니다.
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
uvicorn backend.app.main:app --reload --port 8000
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

## 배포

Azure Container Apps 배포 전 `az login`과 구독 선택을 완료한 뒤, 서버 비밀은 로컬 셸에서만 주입합니다.
`DEMO_PASSWORD`는 기본값을 제공하지 않으며, 설정하지 않으면 데모 인증 없이 실행됩니다.

```bash
az containerapp up -n cheongdo-ciry -g cheongdo-rg --source . --ingress external --target-port 8000
az containerapp secret set -n cheongdo-ciry -g cheongdo-rg --secrets copilot-token="$(gh auth token)"
az containerapp update -n cheongdo-ciry -g cheongdo-rg --set-env-vars COPILOT_GITHUB_TOKEN=secretref:copilot-token
```

## 에이전트 도구 연결

앱 기능을 MCP 서버로 묶어 채팅에서 등록·조회·알림 변경·납부 확인·납부 안내를 실행하는 방향입니다. 원격 main 8dc0e32에서 Python 함수 도구 5개의 에이전트 등록을 확인했으며, MCP 서버와 프런트 응답 정규화는 후속 작업입니다. 자세한 현황과 대응표는 TRD 9절을 확인하세요.

문서 경로는 `docs/AGENTS.md`, `docs/TDD.md`, `docs/research/`, `docs/design/`, `docs/handoffs/`를 기준으로 합니다.
