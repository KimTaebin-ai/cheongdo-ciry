# 핸드오프 — Figma Dev Mode 재시도: 연결 미반영 (차단 유지)

- 일시: 2026-11-05 15:26 Asia/Seoul
- 작성자/역할: A / 모바일 프런트
- 목표: 피그마 노드 15:2의 로딩 화면·앱 아이콘·온보딩 페이지 읽기 → 구현
- 담당 피처: F04(로딩 상태). 온보딩의 알림 동의 흐름은 F07 연결 여부 확인 필요
- 이전 핸드오프: `handoffs/20261105-151450-figma-loading-icon-onboarding.md` (현재 저장소에 없음)

## 상태

- 차단 유지: 디자인 데이터를 아직 읽지 못했다. 구현·검증 모두 미실행.
- 사용자 조치: Figma 데스크톱 앱에서 "Enable Dev Mode MCP Server"를 켰다고 보고함.
- 확인 결과:
  - Figma 데스크톱 앱 프로세스가 실행 중이고, `127.0.0.1:3845`(Dev Mode MCP 기본 포트)가 LISTEN 상태다. 즉 Figma 쪽 서버는 올라와 있다.
  - 그런데 Figma MCP `get_metadata(15:2)`는 여전히 "Dev Mode MCP Server를 켜고 앱을 재시작하라"고 응답한다.
  - 원인 추정: MCP 클라이언트 앱이 세션 시작 때(Dev Mode가 꺼진 상태) 연결을 확정했고, 재시작 전까지 반영되지 않는다. 확정 근거는 없다.

## 변경 파일

- 없음. 이번 턴은 조회·재시도만 했다. 작업 트리 변경 없음.

## 검증

- 실행: Figma MCP `get_metadata(15:2)` 재호출 → 동일한 비활성 안내.
- 실행: `pgrep`으로 Figma 프로세스 확인, `lsof`로 `127.0.0.1:3845` LISTEN 확인.
- 미실행: `get_design_context`, `get_screenshot`, 구현, `tsc`/`vite build`/`vitest`/Playwright, 시각 대조.

## 남은 문제와 외부 의존성

- 외부 의존성(사용자): MCP 클라이언트 앱을 완전히 종료 후 다시 실행해야 Figma 연결이 갱신될 것으로 보인다.
- 결정 필요: 표시 제품명(감좋은청년 / 살림메이트). 파일 제목은 "살림메이트 · 1인 가구 독립 도우미"이고 프로젝트 문서·manifest는 "감좋은청년"이다.
- 결정 필요: 앱 아이콘 PNG 크기(iOS 180, Android 192·512 등) 요구 여부.
- 확인 필요: "ㅎ오보 페이지"를 온보딩 페이지로 해석했다. 다르면 정정 필요.

## 다음 담당자 순서

1. 사용자: MCP 클라이언트 앱 완전 종료 후 재실행.
2. 재연결 확인: Figma MCP `get_metadata`를 노드 15:2 또는 선택된 노드로 호출. 여전히 비활성이면 Figma 데스크톱 앱에서 해당 파일을 열고 로딩·아이콘·온보딩 프레임을 선택한 뒤 다시 호출.
3. 성공 시: `get_design_context` + `get_screenshot`을 호출하고 각 화면을 읽는다.
4. 구현:
   - 로딩: `frontend/src/App.tsx:170`의 `splash`, `frontend/src/styles.css`의 `.splash`, `.loading-dots`.
   - 아이콘: `frontend/public/favicon.svg`와 manifest. 필요하면 PNG 아이콘 추가.
   - 온보딩: 신규 컴포넌트. 첫 실행 조건은 실패해도 채팅이 막히지 않게 둔다.
5. 검증: `cd frontend && npx tsc -b && npx vite build && npx vitest run src`, Playwright 390px 스크린샷을 디자인과 대조. 통과하지 않은 항목은 통과로 적지 않는다.

## Git

- 작성 시점 브랜치 `codex/chat-frontend`, HEAD `c691ac9`. 작업 트리 변경은 이 핸드오프 파일 하나뿐이었다.
- 커밋·푸시·fetch·merge 하지 않음.
