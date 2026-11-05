from app.adapters import KEPCO_PAYMENT_URL, KepcoAdapter, SampleKepcoAdapter
from app.models import Bill


def test_sample_adapter_returns_common_bill_schema_marked_sample():
    bill = SampleKepcoAdapter().fetch_bill()
    assert isinstance(bill, Bill)
    assert bill.kind == "electricity" and bill.source == "sample"
    assert bill.id == f"electricity-{bill.period}"
    assert isinstance(bill.amount_krw, int) and bill.due_date.startswith(bill.period)
    assert bill.status == "pending" and bill.payment_url == KEPCO_PAYMENT_URL


def test_adapter_interface_swappable():
    class Fake:
        def fetch_bill(self) -> Bill:
            return Bill(id="electricity-2026-11", kind="electricity", period="2026-11", source="real")

    adapters: list[KepcoAdapter] = [SampleKepcoAdapter(), Fake()]
    assert [a.fetch_bill().source for a in adapters] == ["sample", "real"]
