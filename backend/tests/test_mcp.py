"""앱 MCP 서버(stdio)와 에이전트 연결·대체 경로 테스트."""

import asyncio
import json
import sys
from datetime import datetime
from types import SimpleNamespace

from agent_framework import Content
from fastapi.testclient import TestClient
from mcp import ClientSession, StdioServerParameters, stdio_client

from app import chat, main
from app.models import Bill
from app.store import Store
from app.timeutil import KST


def _seed(path) -> None:
    store = Store(str(path))
    store.set_reminder_enabled(True)
    store.save_bill(Bill(id="electricity-2026-11", kind="electricity", period="2026-11", amount_krw=48320,
                         due_date="2026-11-25", source="sample"))


async def _call(db_path, name: str, arguments: dict) -> tuple[set[str], object]:
    params = StdioServerParameters(command=sys.executable, args=["-m", "backend.mcp_server"],
                                   env={"DB_PATH": str(db_path)}, cwd=str(chat.REPO_ROOT))
    async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        names = {tool.name for tool in (await session.list_tools()).tools}
        result = await session.call_tool(name, arguments)
    return names, result


def test_mcp_server_lists_read_only_tools_and_reads_shared_db(tmp_path):
    db = tmp_path / "shared.db"
    _seed(db)
    names, result = asyncio.run(_call(db, "list_due_bills", {"kind": "electricity"}))

    assert names == set(chat.MCP_TOOL_NAMES)
    assert not names & {"save_rent", "confirm_paid", "set_reminder_enabled", "refresh_electricity"}
    assert result.isError is False
    bills = result.structuredContent["result"]
    assert [(b["id"], b["amount_krw"], b["due_date"]) for b in bills] == [("electricity-2026-11", 48320, "2026-11-25")]


def test_mcp_payment_guide_is_official_link(tmp_path):
    _, result = asyncio.run(_call(tmp_path / "empty.db", "get_payment_guide", {}))
    assert json.loads(result.content[0].text)["url"] == "https://cyber.kepco.co.kr"


def test_probe_connects_and_agent_uses_mcp_for_reads(monkeypatch, tmp_path):
    monkeypatch.setenv("MCP_ENABLED", "1")
    monkeypatch.setattr(chat, "DB_PATH", str(tmp_path / "probe.db"))
    monkeypatch.setattr(chat, "agent", None)
    captured: dict = {}

    class CapturingAgent:
        def __init__(self, *, instructions, tools, default_options):
            captured.update(tools=[tool.__name__ for tool in tools], options=default_options)

    monkeypatch.setattr(chat, "GitHubCopilotAgent", CapturingAgent)
    assert asyncio.run(chat.probe_mcp()) == "connected"
    chat.get_agent()

    assert set(captured["tools"]) == chat.WRITE_TOOL_NAMES
    server = captured["options"]["mcp_servers"][chat.MCP_SERVER_NAME]
    assert server["type"] == "stdio" and server["args"] == ["-m", "backend.mcp_server"]
    assert server["env"] == {"DB_PATH": str(tmp_path / "probe.db")}
    assert server["tools"] == chat.MCP_TOOL_NAMES
    monkeypatch.setattr(chat, "mcp_status", "fallback")


def test_probe_failure_falls_back_to_function_tools(monkeypatch):
    monkeypatch.setenv("MCP_ENABLED", "1")
    monkeypatch.setattr(chat, "_mcp_params", lambda: StdioServerParameters(command=sys.executable, args=["-c", "raise SystemExit(1)"]))
    assert asyncio.run(chat.probe_mcp(timeout=10)) == "fallback"
    assert {tool.__name__ for tool in chat.agent_tools()} >= {"list_bills", "get_bill", "get_rent", "rent_transfer_text"}


class McpStreamingAgent:
    """MCP 도구 호출을 SDK와 같은 function_call/function_result 업데이트로 흘려 보내는 대역."""

    def __init__(self, fail: bool = False):
        self.fail = fail
        self.stopped = False

    async def start(self):
        return None

    async def stop(self):
        self.stopped = True

    def create_session(self, session_id: str):
        return SimpleNamespace(session_id=session_id)

    def run(self, message, *, stream, session):
        async def updates():
            if self.fail:
                raise RuntimeError("MCP server crashed")
            yield SimpleNamespace(text=None, contents=[
                Content.from_function_call(call_id="c1", name="cheongdo-app-list_due_bills", arguments={"kind": "electricity"})])
            yield SimpleNamespace(text=None, contents=[Content.from_function_result(call_id="c1", result="[]")])
            yield SimpleNamespace(text="이번 달 전기요금은 48,320원입니다.", contents=[])
        return updates()


def _client(monkeypatch, fake) -> TestClient:
    store = Store(":memory:", clock=lambda: datetime(2026, 11, 5, 14, tzinfo=KST))
    monkeypatch.setattr(chat, "store", store)
    monkeypatch.setattr(main, "store", store)
    monkeypatch.setattr(chat, "agent", fake)
    chat.reset_chat_state()
    return TestClient(main.app)


def _events(text: str) -> list[tuple[str, dict]]:
    chunks = [c for c in text.split("\n\n") if c.strip()]
    return [(c.splitlines()[0].removeprefix("event: "), json.loads(c.splitlines()[1].removeprefix("data: "))) for c in chunks]


def test_agent_mcp_tool_call_is_streamed_as_tool_events(monkeypatch):
    with _client(monkeypatch, McpStreamingAgent()) as client:
        monkeypatch.setattr(chat, "mcp_status", "connected")
        assert client.get("/health").json()["mcp"] == "connected"
        response = client.post("/api/chat", json={"session_id": "mcp", "message": "이번 달 낼 돈 정리해줘"})

    events = _events(response.text)
    assert ("tool_call", {"name": "list_due_bills", "source": "mcp"}) in events
    assert ("tool_result", {"name": "list_due_bills", "source": "mcp", "summary": "MCP 조회"}) in events
    assert events[-1][0] == "done"


def test_agent_failure_with_mcp_switches_to_fallback(monkeypatch):
    fake = McpStreamingAgent(fail=True)
    with _client(monkeypatch, fake) as client:
        monkeypatch.setattr(chat, "mcp_status", "connected")
        response = client.post("/api/chat", json={"session_id": "mcp-fail", "message": "이번 달 낼 돈 정리해줘"})
        health = client.get("/health").json()

    assert _events(response.text)[-1][0] == "error"
    assert health["mcp"] == "fallback"
    assert fake.stopped and chat.agent is None


def test_model_failure_keeps_mcp_when_server_is_healthy(monkeypatch, tmp_path):
    monkeypatch.setenv("MCP_ENABLED", "1")
    monkeypatch.setattr(chat, "DB_PATH", str(tmp_path / "healthy.db"))
    fake = McpStreamingAgent(fail=True)
    with _client(monkeypatch, fake) as client:
        monkeypatch.setattr(chat, "mcp_status", "connected")
        response = client.post("/api/chat", json={"session_id": "model-fail", "message": "이번 달 낼 돈 정리해줘"})
        health = client.get("/health").json()
        assert chat.agent is fake and not fake.stopped

    assert _events(response.text)[-1][0] == "error"
    assert health["mcp"] == "connected"


def test_agent_start_hang_is_bounded_by_model_timeout(monkeypatch):
    class HangingStart(McpStreamingAgent):
        async def start(self):
            await asyncio.sleep(30)

    monkeypatch.setenv("GITHUB_COPILOT_TIMEOUT", "1")
    with _client(monkeypatch, HangingStart()) as client:
        response = client.post("/api/chat", json={"session_id": "hang", "message": "이번 달 낼 돈 정리해줘"})

    assert _events(response.text)[-1] == ("error", {"kind": "model", "message": "모델 호출 시간이 초과됐어요"})
