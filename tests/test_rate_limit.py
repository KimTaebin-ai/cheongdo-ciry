import asyncio

from backend.api import app


def test_chat_rate_limit_is_ten_requests_per_session_per_minute(monkeypatch) -> None:
    app.rate_limiter.clear()
    monkeypatch.setattr(app, "get_agent", lambda: None)
    outputs = [
        "".join(asyncio.run(collect(app.chat_events(app.ChatRequest(session_id="limited", message="안녕")))))
        for _ in range(11)
    ]
    assert '"kind": "rate_limit"' in outputs[-1]


async def collect(iterator):
    return [chunk async for chunk in iterator]
