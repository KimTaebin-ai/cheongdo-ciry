"""한전 조회 어댑터. 실제 개인 청구 조회 수단이 확인되지 않아 샘플만 제공한다(source=sample)."""
from __future__ import annotations

from typing import Protocol

from .models import Bill
from .timeutil import clamp_due_date, now_kst

# 서버 허용 목록의 공식 납부 URL
KEPCO_PAYMENT_URL = "https://cyber.kepco.co.kr"


class KepcoAdapter(Protocol):
    def fetch_bill(self) -> Bill: ...


class SampleKepcoAdapter:
    """합성 청구. 실연동이 아니다."""

    def fetch_bill(self) -> Bill:
        now = now_kst()
        period = now.strftime("%Y-%m")
        due, _ = clamp_due_date(period, 25)
        return Bill(
            id=f"electricity-{period}",
            kind="electricity",
            period=period,
            amount_krw=48320,
            due_date=due,
            autopay=False,
            source="sample",
            checked_at=now.isoformat(),
            payment_url=KEPCO_PAYMENT_URL,
        )
