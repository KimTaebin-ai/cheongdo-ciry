from datetime import datetime

from app.adapters import SampleKepcoAdapter
from app.models import Bill, RentConfig
from app.store import Store
from app.timeutil import KST


def test_registered_electricity_query() -> None:
    store = Store(":memory:")
    bill = store.refresh_electricity(SampleKepcoAdapter())
    assert bill.kind == "electricity"
    assert bill.amount_krw == 48320


def test_unregistered_item_query() -> None:
    assert Store(":memory:").get_bill("missing") is None


def test_sample_electricity_is_marked() -> None:
    bill = Store(":memory:").refresh_electricity(SampleKepcoAdapter())
    assert bill.source == "sample"


def test_pasted_bill_is_not_saved_before_confirmation() -> None:
    from app.chat import _extract_pasted_bill

    store = Store(":memory:")
    bill = _extract_pasted_bill(
        "한국전력공사 전기요금 고지서\n청구월: 2026년 10월\n납부기한: 2026-11-20\n청구금액: 42,100원"
    )
    assert bill is not None
    assert store.list_bills() == []


def test_resaving_bill_updates_same_id() -> None:
    store = Store(":memory:")
    bill = Bill(id="electricity-2026-11", kind="electricity", period="2026-11",
                amount_krw=42000, source="manual")
    store.save_bill(bill)
    updated = store.save_bill(bill.model_copy(update={"amount_krw": 43000}))
    assert updated.amount_krw == 43000
    assert len(store.list_bills()) == 1


def test_reminder_calculation() -> None:
    now = datetime(2026, 11, 5, 14, tzinfo=KST)
    store = Store(":memory:", clock=lambda: now)
    store.set_reminder_enabled(True)
    store.save_rent(RentConfig(amount_krw=500000, due_day=25, start_month="2026-11"))
    reminders = store.reminders("rent-2026-11")
    assert [item.scheduled_at_utc for item in reminders] == [
        "2026-11-22T00:00:00Z", "2026-11-24T00:00:00Z"
    ]
