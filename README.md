# cheongdo-ciry

1인 가구의 전기요금과 월세를 채팅으로 챙기는 독립 도우미. 모바일 우선 반응형 웹앱을 목표로 하며 구현 상태는 실제 코드와 핸드오프를 확인합니다.

## 심사용 빠른 확인

- 배포 URL: https://cheongdo-ciry.thankfulmeadow-65f89e4d.westus2.azurecontainerapps.io (로그인 없음)
- 상태 확인: `/health` → `{"status":"ok","kepco_mode":"sample",...}`

시연 순서:

1. 채팅에 `전기요금 얼마야?` → 청구 카드(48,320원, 납부기한 25일)가 **합성 샘플** 라벨과 함께 표시됩니다.
2. 채팅에 고지서 텍스트를 붙여 넣습니다. 예: `한국전력공사 전기요금 고지서` / `청구월: 2026년 10월` / `납부기한: 2026-11-20` / `청구금액: 42,100원`. 추출 결과 카드가 뜨고, **확인하고 등록**을 눌러야 저장됩니다.
3. 채팅에 `보험료 얼마야?` → 등록되지 않은 항목이라 금액 없이 "내역이 없다"고 답합니다(Copilot 모델 응답).

샘플 데이터 안내: 한전 개인 청구 자동 조회는 지원하지 않습니다. 전기요금 카드는 합성 샘플(`source=sample`)이며 화면에 "합성 샘플"로 표시됩니다. 서버 DB는 컨테이너 로컬 SQLite라서 재시작하면 초기화되고 샘플로 다시 채워집니다.

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

Azure Container Apps 재배포는 `infra/deploy.sh`를 씁니다(`az login` 후 실행). 무료 구독에서 ACR Tasks(`az acr build`, `--source`)가 막혀 있어 로컬 `docker buildx`로 빌드한 뒤 ACR에 push하고 이미지를 교체합니다. 이미지 태그는 git 짧은 해시입니다. Copilot 토큰 secret 등록 명령은 스크립트 주석에 있습니다. 자세한 내용은 TRD 6절을 보세요.
`DEMO_PASSWORD`는 기본값이 없습니다. 설정하지 않으면 데모 인증 없이 실행됩니다.

## 에이전트 도구 연결

Microsoft Agent Framework의 `GitHubCopilotAgent`에 함수 도구 9개가 등록돼 있습니다(`backend/app/chat.py`). 쓰기는 proposal을 만든 뒤 `POST /api/proposals/{id}/confirm`에서 저장합니다. 읽기 도구 6개는 stdio 앱 MCP 서버(`backend/mcp_server.py`)로 연결하고, 실패하면 함수 도구로 대체합니다(`/health`의 `mcp`). 도구 표와 예외는 TRD 2·3절에 있습니다.

문서 경로는 `docs/AGENTS.md`, `docs/TDD.md`, `docs/research/`, `docs/design/`, `docs/handoffs/`를 기준으로 합니다.
