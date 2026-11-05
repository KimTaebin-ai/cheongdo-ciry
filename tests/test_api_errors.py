import asyncio

from backend.api import app as api


def test_model_failure_is_model_error(monkeypatch) -> None:
    class BrokenAgent:
        def create_session(self, *, session_id: str):
            return object()

        def run(self, *args, **kwargs):
            raise RuntimeError("model unavailable")

    monkeypatch.setattr(api, "get_agent", lambda: BrokenAgent())
    output = "".join(asyncio.run(collect(api.chat_events(api.ChatRequest(session_id="x", message="안녕")))))
    assert 'event: error' in output
    assert '"kind": "model"' in output


async def collect(iterator):
    return [chunk async for chunk in iterator]
