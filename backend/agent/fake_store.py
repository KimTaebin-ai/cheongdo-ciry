"""In-memory bill store with a replaceable interface."""

from abc import ABC, abstractmethod
from threading import RLock

from .models import Bill, BillCategory


class BillStore(ABC):
    @abstractmethod
    def list_bills(self, category: BillCategory | None = None, month: str | None = None) -> list[Bill]:
        raise NotImplementedError

    @abstractmethod
    def get_bill(self, bill_id: str) -> Bill | None:
        raise NotImplementedError

    @abstractmethod
    def save_bill(self, bill: Bill) -> tuple[Bill, bool]:
        raise NotImplementedError


class InMemoryBillStore(BillStore):
    def __init__(self) -> None:
        self._bills: dict[str, Bill] = {}
        self._lock = RLock()

    def list_bills(self, category: BillCategory | None = None, month: str | None = None) -> list[Bill]:
        with self._lock:
            return [
                bill.model_copy(deep=True)
                for bill in self._bills.values()
                if (category is None or bill.category == category)
                and (month is None or bill.billing_month == month)
            ]

    def get_bill(self, bill_id: str) -> Bill | None:
        with self._lock:
            bill = self._bills.get(bill_id)
            return bill.model_copy(deep=True) if bill else None

    def save_bill(self, bill: Bill) -> tuple[Bill, bool]:
        with self._lock:
            duplicate = next(
                (existing for existing in self._bills.values() if existing.source.hash == bill.source.hash),
                None,
            )
            if duplicate:
                return duplicate.model_copy(deep=True), False
            self._bills[bill.id] = bill.model_copy(deep=True)
            return bill.model_copy(deep=True), True


def sample_store() -> InMemoryBillStore:
    store = InMemoryBillStore()
    samples = [
        Bill(
            id="sample-electricity-2026-10",
            category=BillCategory.electricity,
            provider="한국전력공사",
            billing_month="2026-10",
            amount_krw=42100,
            due_date="2026-11-20",
            autopay=False,
            status="scheduled",
            source={"type": "sample", "excerpt": "10월 전기요금", "hash": "sample-electricity-2026-10"},
            is_sample=True,
        ),
        Bill(
            id="sample-gas-2026-10",
            category=BillCategory.gas,
            provider="청도도시가스",
            billing_month="2026-10",
            amount_krw=18300,
            due_date="2026-11-25",
            autopay=False,
            status="scheduled",
            source={"type": "sample", "excerpt": "10월 가스요금", "hash": "sample-gas-2026-10"},
            is_sample=True,
        ),
        Bill(
            id="sample-rent-2026-11",
            category=BillCategory.rent,
            provider="임대인",
            billing_month="2026-11",
            amount_krw=500000,
            due_date="2026-11-25",
            autopay=False,
            status="scheduled",
            source={"type": "sample", "excerpt": "11월 월세", "hash": "sample-rent-2026-11"},
            is_sample=True,
        ),
    ]
    for bill in samples:
        store.save_bill(bill)
    return store
