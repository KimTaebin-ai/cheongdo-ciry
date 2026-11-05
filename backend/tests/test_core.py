from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.adapters import SampleKepcoAdapter
from app.models import RentConfig
from app.store import Store
from app.timeutil import KST, clamp_due_date

NOW = [datetime(2026, 11, 5, 14, 0, tzinfo=KST)]


@pytest.fixture
def store():
    NOW[0] = datetime(2026, 11, 5, 14, 0, tzinfo=KST)
    s = Store(":memory:", clock=lambda: NOW[0])
    s.set_reminder_enabled(True)
    return s


def rent(day=25, start="2026-11"):
    return RentConfig(amount_krw=500000, due_day=day, bank="샘플은행", account_number="000-0000-0000",
                      account_holder="홍길동", start_month=start)


def pending(s, bid):
    return [r for r in s.reminders(bid) if r.state == "pending"]


def test_month_end_policy():
    assert clamp_due_date("2026-02", 31) == ("2026-02-28", True)
    assert clamp_due_date("2028-02", 31) == ("2028-02-29", True)
    assert clamp_due_date("2026-11", 30) == ("2026-11-30", False)


def test_rent_save_generates_bills_and_notice(store):
    res = store.save_rent(rent(31))
    assert [b.id for b in res.bills] == ["rent-2026-11", "rent-2026-12"]
    assert res.bills[0].due_date == "2026-11-30" and res.bills[0].due_date_adjusted
    assert res.notice and "말일" in res.notice


def test_reminders_scheduled_3d_and_1d_9am_kst(store):
    store.save_rent(rent(25))
    r = pending(store, "rent-2026-11")
    assert [x.scheduled_at_utc for x in r] == ["2026-11-22T00:00:00Z", "2026-11-24T00:00:00Z"]  # 09:00 KST


def test_no_duplicates_on_resave_and_refresh(store):
    store.save_rent(rent(25))
    store.save_rent(rent(25))
    assert len(store.reminders("rent-2026-11")) == 2
    a = SampleKepcoAdapter()
    store.refresh_electricity(a)
    store.refresh_electricity(a)
    assert len([b for b in store.list_bills() if b.kind == "electricity"]) == 1
    assert len(store.reminders("electricity-2026-11")) == 2


def test_recalc_on_due_change(store):
    store.save_rent(rent(25))
    store.save_rent(rent(28))
    states = {r.scheduled_at_utc: r.state for r in store.reminders("rent-2026-11")}
    assert states["2026-11-22T00:00:00Z"] == "cancelled"
    assert states["2026-11-25T00:00:00Z"] == "pending" and states["2026-11-27T00:00:00Z"] == "pending"


def test_no_retroactive_past(store):
    NOW[0] = datetime(2026, 11, 24, 10, 0, tzinfo=KST)
    store.save_rent(rent(25, "2026-11"))
    assert [r.scheduled_at_utc for r in pending(store, "rent-2026-11")] == []  # 11-24 09:00 지남, 11-22 지남


def test_deliver_due_and_notifications(store):
    store.save_rent(rent(25))
    NOW[0] = datetime(2026, 11, 22, 9, 1, tzinfo=KST)
    assert store.deliver_due() == 1
    assert store.deliver_due() == 0
    n = store.notifications()
    assert len(n) == 1 and "3일 전" in n[0].message


def test_confirm_cancels_and_is_separate_from_transfer_text(store):
    store.save_rent(rent(25))
    assert store.rent_transfer_text()
    assert store.get_bill("rent-2026-11").status == "pending"  # 복사 안내만으로 완료 아님
    store.confirm_paid("rent-2026-11")
    assert store.get_bill("rent-2026-11").status == "user_confirmed"
    assert pending(store, "rent-2026-11") == []
    store.save_rent(rent(26))  # 재저장해도 확인 상태·취소 유지
    assert store.get_bill("rent-2026-11").status == "user_confirmed"
    assert pending(store, "rent-2026-11") == []


def test_no_reminders_without_consent_and_disable_per_bill():
    s = Store(":memory:", clock=lambda: NOW[0])
    s.save_rent(rent(25))
    assert s.reminders() == []
    s.set_reminder_enabled(True)
    assert len(pending(s, "rent-2026-11")) == 2
    s.set_reminder_enabled(False, "rent-2026-11")
    assert pending(s, "rent-2026-11") == []


def test_transfer_text_requires_fields(store):
    store.save_rent(RentConfig(amount_krw=1000, due_day=5))
    assert store.rent_transfer_text() is None


def test_sample_marked_everywhere(monkeypatch, tmp_path):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setenv("DEMO_MODE", "1")
    from app import main
    main.store = Store(str(tmp_path / "t.db"))
    with TestClient(main.app) as c:
        bills = c.get("/api/bills").json()
        assert bills and all(b["source"] == "sample" for b in bills if b["kind"] == "electricity")
        assert c.get("/health").json()["kepco_mode"] == "sample"
        assert c.post("/api/reminder-settings", json={"enabled": True}).status_code == 200
        c.put("/api/rent", json=rent(31).model_dump())
        assert c.post("/api/bills/rent-2026-11/confirm-paid").json()["status"] == "user_confirmed"
        assert c.post("/api/bills/nope/confirm-paid").status_code == 404
        assert c.post("/api/demo/time-shift?hours=720").json()["demo_time_shift_hours"] == 720
        n = c.get("/api/notifications").json()
        assert all(x["demo_time_shift"] for x in n)
        main.set_demo_offset(0)
