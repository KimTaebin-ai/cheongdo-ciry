import json
from datetime import datetime

from fastapi.testclient import TestClient

from app import chat, main
from app.models import RentConfig
from app.store import Store
from app.timeutil import KST


def _client(monkeypatch, *, consent: bool = True) -> TestClient:
    store = Store(":memory:", clock=lambda: datetime(2026, 11, 5, 14, tzinfo=KST))
    if consent:
        store.set_reminder_enabled(True)
    monkeypatch.setattr(chat, "store", store)
    monkeypatch.setattr(main, "store", store)
    chat.reset_chat_state()
    return TestClient(main.app)


def _events(response: str) -> list[tuple[str, dict]]:
    chunks = [chunk for chunk in response.split("\n\n") if chunk.strip()]
    return [
        (chunk.splitlines()[0].removeprefix("event: "), json.loads(chunk.splitlines()[1].removeprefix("data: ")))
        for chunk in chunks
    ]


def test_electricity_chat_uses_store_and_returns_common_done(monkeypatch):
    with _client(monkeypatch) as client:
        response = client.post("/api/chat", json={"session_id": "electricity", "message": "전기요금 얼마야?"})

    events = _events(response.text)
    assert [event for event, _ in events][-1] == "done"
    done = events[-1][1]
    assert done["bill_cards"][0]["kind"] == "electricity"
    assert done["mode"] == "sample"
    assert any(event == "tool_call" and data["name"] == "list_bills" for event, data in events)


def test_rent_chat_creates_proposal_and_confirm_writes_store_once(monkeypatch):
    with _client(monkeypatch) as client:
        response = client.post(
            "/api/chat",
            json={"session_id": "rent", "message": "월세 50만원 매달 25일로 등록해줘"},
        )
        events = _events(response.text)
        proposal = next(data for event, data in events if event == "proposal")
        assert proposal["missing_fields"] == ["bank", "account_number", "account_holder"]

        confirmed = client.post(
            f"/api/proposals/{proposal['proposal_id']}/confirm",
            json={"session_id": "rent"},
        )
        assert confirmed.status_code == 422

        full = chat.create_proposal(
            "rent",
            "save_rent",
            RentConfig(
                amount_krw=500000,
                due_day=25,
                bank="샘플은행",
                account_number="000-0000",
                account_holder="홍길동",
                start_month="2026-11",
            ).model_dump(mode="json"),
        )
        saved = client.post(
            f"/api/proposals/{full.proposal_id}/confirm",
            json={"session_id": "rent"},
        )
        duplicate = client.post(
            f"/api/proposals/{full.proposal_id}/confirm",
            json={"session_id": "rent"},
        )

    assert saved.status_code == 200
    assert saved.json()["bills"][0]["kind"] == "rent"
    assert duplicate.json()["duplicate"] is True


def test_rate_limit_is_ten_requests_per_session(monkeypatch):
    with _client(monkeypatch) as client:
        responses = [
            client.post("/api/chat", json={"session_id": "limited", "message": "전기요금 얼마야?"})
            for _ in range(11)
        ]

    assert responses[-1].status_code == 200
    assert any(event == "error" and data["kind"] == "rate_limit" for event, data in _events(responses[-1].text))


def test_pasted_bill_proposal_is_not_saved_before_confirmation(monkeypatch):
    with _client(monkeypatch) as client:
        response = client.post(
            "/api/chat",
            json={
                "session_id": "paste",
                "message": "한국전력공사 전기요금 고지서\n청구월: 2026년 10월\n납부기한: 2026-11-20\n청구금액: 42,100원",
            },
        )
        proposal = next(data for event, data in _events(response.text) if event == "proposal")
        assert all(bill["amount_krw"] != 42100 for bill in client.get("/api/bills").json())
        confirmed = client.post(
            f"/api/proposals/{proposal['proposal_id']}/confirm",
            json={"session_id": "paste"},
        )

    assert confirmed.status_code == 200
    assert confirmed.json()["bill"]["amount_krw"] == 42100


def test_paid_request_from_frontend_creates_proposal_without_model(monkeypatch):
    with _client(monkeypatch) as client:
        bill = client.get("/api/bills").json()[0]
        message = f"납부 확인 요청: bill_id={bill['id']} ({bill['period']} 전기요금). confirm_paid 도구로 이 청구의 납부 확인 제안을 만들어 주세요."
        response = client.post("/api/chat", json={"session_id": "paid", "message": message})
        proposal = next(data for event, data in _events(response.text) if event == "proposal")
        assert proposal["action"] == "confirm_paid"
        assert proposal["payload"] == {"bill_id": bill["id"]}
        confirmed = client.post(f"/api/proposals/{proposal['proposal_id']}/confirm", json={"session_id": "paid"})

    assert confirmed.status_code == 200
    assert confirmed.json()["bill"]["status"] == "user_confirmed"


def test_reminder_request_creates_proposal_without_model(monkeypatch):
    with _client(monkeypatch) as client:
        message = "웹 납부 알림 전체를 꺼 주세요. set_reminder_enabled 도구로 enabled=false, bill_id 없이 제안을 만들어 주세요."
        response = client.post("/api/chat", json={"session_id": "remind", "message": message})

    proposal = next(data for event, data in _events(response.text) if event == "proposal")
    assert proposal["action"] == "set_reminder_enabled"
    assert proposal["payload"] == {"enabled": False, "bill_id": None}


def test_electricity_keyword_without_query_intent_goes_to_model(monkeypatch):
    called: list[str] = []

    async def fake_stream(_agent, message, _session):
        called.append(message)
        yield type("Update", (), {"text": "답변"})()

    monkeypatch.setattr(chat, "_stream_agent_response", fake_stream)
    monkeypatch.setattr(chat, "get_agent", lambda: type("Agent", (), {"create_session": lambda self, session_id: object()})())
    with _client(monkeypatch) as client:
        response = client.post("/api/chat", json={"session_id": "saving", "message": "전기 아끼는 방법 있어?"})

    assert called == ["전기 아끼는 방법 있어?"]
    assert _events(response.text)[-1][1]["message"] == "답변"


def test_deterministic_chat_does_not_wait_for_model_lock(monkeypatch):
    import asyncio

    async def run() -> list[str]:
        await chat.agent_lock.acquire()
        try:
            request = chat.ChatRequest(session_id="busy", message="전기요금 얼마야?")
            return await asyncio.wait_for(_collect(chat.chat_events(request)), timeout=1)
        finally:
            chat.agent_lock.release()

    async def _collect(stream) -> list[str]:
        return [chunk async for chunk in stream]

    with _client(monkeypatch):
        chunks = asyncio.run(run())
    assert chunks[-1].startswith("event: done")
