"""Agent Framework tools backed by the in-memory store."""

from __future__ import annotations

import hashlib
import re
from contextvars import ContextVar
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from .fake_store import BillStore
from .models import Bill, BillCategory, BillStatus, ExtractedBill, Reminder

TOOL_EVENTS: ContextVar[list[dict[str, object]] | None] = ContextVar("tool_events", default=None)
SEOUL = ZoneInfo("Asia/Seoul")


def _record(event: dict[str, object]) -> None:
    events = TOOL_EVENTS.get()
    if events is not None:
        events.append(event)


def make_tools(store: BillStore) -> list[object]:
    def list_bills(category: str | None = None, month: str | None = None) -> list[dict]:
        """청구 목록을 category와 month 조건으로 조회한다."""
        _record({"type": "tool_call", "name": "list_bills", "arguments": {"category": category, "month": month}})
        try:
            parsed = BillCategory(category) if category else None
            result = store.list_bills(parsed, month)
            payload = [bill.model_dump(mode="json") for bill in result]
            _record({"type": "tool_result", "name": "list_bills", "summary": f"{len(payload)}건 조회"})
            return payload
        except Exception as exc:
            _record({"type": "tool_result", "name": "list_bills", "summary": "조회 실패"})
            raise RuntimeError("조회 실패") from exc

    def get_bill(bill_id: str) -> dict | None:
        """청구 id 하나를 조회한다."""
        try:
            _record({"type": "tool_call", "name": "get_bill", "arguments": {"bill_id": bill_id}})
            bill = store.get_bill(bill_id)
            payload = bill.model_dump(mode="json") if bill else None
            _record({"type": "tool_result", "name": "get_bill", "summary": "조회 성공" if bill else "등록된 자료 없음"})
            return payload
        except Exception as exc:
            _record({"type": "tool_result", "name": "get_bill", "summary": "조회 실패"})
            raise RuntimeError("조회 실패") from exc

    def extract_bill(text: str) -> dict:
        """붙여넣은 고지서 텍스트에서 청구 필드를 추출하며 저장하지 않는다."""
        amount_match = re.search(r"(?:청구금액|납부하실 금액|금액|요금)\s*[:：]?\s*([\d,]+)\s*원", text)
        date_match = re.search(r"(?:납부기한|납기일|납부일)\s*[:：]?\s*(20\d{2}-\d{2}-\d{2})", text)
        month_match = re.search(r"(?:청구월|사용월|귀하의 사용기간)\s*[:：]?\s*(20\d{2})[년./-]\s*(\d{1,2})", text)
        provider_patterns = (
            (r"한국전력공사", "한국전력공사", BillCategory.electricity),
            (r"청도도시가스", "청도도시가스", BillCategory.gas),
            (r"청도아파트", "청도아파트", BillCategory.maintenance),
        )
        provider, category = next(
            ((name, value) for pattern, name, value in provider_patterns if re.search(pattern, text)),
            (None, None),
        )
        excerpt = text[:200]
        payload = ExtractedBill.model_validate({
            "id": None,
            "category": category.value if category else None,
            "provider": provider,
            "billing_month": (
                f"{month_match.group(1)}-{int(month_match.group(2)):02d}" if month_match else None
            ),
            "amount_krw": int(amount_match.group(1).replace(",", "")) if amount_match else None,
            "due_date": date_match.group(1) if date_match else None,
            "autopay": None,
            "status": BillStatus.needs_review.value,
            "source": {"type": "paste", "excerpt": excerpt, "hash": hashlib.sha256(text.encode()).hexdigest()},
            "reminders": [],
            "is_sample": False,
        }).model_dump(mode="json")
        _record({"type": "tool_call", "name": "extract_bill", "arguments": {"text": "[redacted]"}})
        _record({"type": "tool_result", "name": "extract_bill", "summary": "필드 추출 완료"})
        return payload

    def save_bill(bill: dict) -> dict:
        """사용자가 저장을 명시적으로 확인한 청구를 저장한다."""
        parsed = Bill.model_validate(bill)
        saved, created = store.save_bill(parsed)
        _record({"type": "tool_call", "name": "save_bill", "arguments": {"bill_id": parsed.id}})
        _record({"type": "tool_result", "name": "save_bill", "summary": "저장됨" if created else "duplicate"})
        return {"bill": saved.model_dump(mode="json"), "created": created, "duplicate": not created}

    def get_reminders(bill_id: str | None = None) -> list[dict]:
        """기한 3일 전과 1일 전 오전 9시 서울 시간의 예정 알림을 조회한다."""
        now = datetime.now(SEOUL)
        bills = [store.get_bill(bill_id)] if bill_id else store.list_bills()
        reminders: list[dict] = []
        for bill in bills:
            if bill is None or not bill.due_date:
                continue
            due = date.fromisoformat(bill.due_date)
            for days_before in (3, 1):
                scheduled = datetime.combine(due - timedelta(days=days_before), time(9), SEOUL)
                if scheduled <= now:
                    continue
                reminders.append(Reminder(at=scheduled, status="scheduled").model_dump(mode="json") | {"bill_id": bill.id})
        _record({"type": "tool_call", "name": "get_reminders", "arguments": {"bill_id": bill_id}})
        _record({"type": "tool_result", "name": "get_reminders", "summary": f"{len(reminders)}건 조회"})
        return reminders

    return [list_bills, get_bill, extract_bill, save_bill, get_reminders]
