from fastapi.testclient import TestClient

from app import chat, main
from app.store import Store


def test_chat_rate_limit_is_ten_requests_per_session(monkeypatch) -> None:
    store = Store(":memory:")
    monkeypatch.setattr(chat, "store", store)
    monkeypatch.setattr(main, "store", store)
    chat.reset_chat_state()
    with TestClient(main.app) as client:
        responses = [
            client.post("/api/chat", json={"session_id": "limited", "message": "전기요금 얼마야?"})
            for _ in range(11)
        ]
    assert '"kind": "rate_limit"' in responses[-1].text
