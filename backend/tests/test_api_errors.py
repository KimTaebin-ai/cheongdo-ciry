import asyncio

from app import chat


def test_model_failure_is_model_error(monkeypatch) -> None:
    class BrokenAgent:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        def create_session(self, *, session_id: str):
            return object()

        def run(self, *args, **kwargs):
            raise RuntimeError("model unavailable")

    monkeypatch.setattr(chat, "get_agent", lambda: BrokenAgent())
    chat.reset_chat_state()
    output = "".join(asyncio.run(collect(chat.chat_events(chat.ChatRequest(session_id="x", message="안녕")))))
    assert 'event: error' in output
    assert '"kind": "model"' in output


def test_stream_failure_after_token_finishes_with_done(monkeypatch) -> None:
    class Update:
        text = "응답 일부"

    async def broken_stream(*args, **kwargs):
        yield Update()
        raise RuntimeError("stream closed")

    class Agent:
        def create_session(self, *, session_id: str):
            return object()

    async def fake_stream(*args, **kwargs):
        async for item in broken_stream():
            yield item

    monkeypatch.setattr(chat, "get_agent", lambda: Agent())
    monkeypatch.setattr(chat, "_stream_agent_response", fake_stream)
    chat.reset_chat_state()
    output = "".join(asyncio.run(collect(chat.chat_events(chat.ChatRequest(session_id="x", message="안녕")))))
    events = [chunk.splitlines()[0] for chunk in output.split("\n\n") if chunk.strip()]
    assert "event: token" in events
    assert events[-1] == "event: done"


async def collect(iterator):
    return [chunk async for chunk in iterator]
