from backend.agent.fake_store import sample_store
from backend.agent.tools import make_tools


def test_registered_electricity_query() -> None:
    tools = make_tools(sample_store())
    bills = tools[0](category="electricity")
    assert bills[0]["amount_krw"] == 42100


def test_unregistered_item_query() -> None:
    tools = make_tools(sample_store())
    assert tools[1]("missing") is None


def test_duplicate_save() -> None:
    store = sample_store()
    tools = make_tools(store)
    bill = store.get_bill("sample-electricity-2026-10")
    result = tools[3](bill.model_dump(mode="json"))
    assert result["duplicate"] is True
    assert result["created"] is False


def test_reminder_calculation() -> None:
    store = sample_store()
    tools = make_tools(store)
    reminders = tools[4]("sample-electricity-2026-10")
    assert {item["at"][-14:] for item in reminders} == {"09:00:00+09:00"}
