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


async def collect(iterator):
    return [chunk async for chunk in iterator]
