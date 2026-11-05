"""공통 계약 (TRD §3). A·B·C가 공유한다. 계약 변경 시 팀에 알린다."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

BillKind = Literal["electricity", "rent"]
BillStatus = Literal["pending", "user_confirmed"]
BillSource = Literal["real", "sample", "manual"]
ReminderState = Literal["pending", "delivered", "cancelled"]


class Bill(BaseModel):
    id: str  # "{kind}-{period}"
    kind: BillKind
    period: str  # YYYY-MM
    amount_krw: Optional[int] = None
    due_date: Optional[str] = None  # YYYY-MM-DD
    autopay: Optional[bool] = None
    status: BillStatus = "pending"
    source: BillSource
    checked_at: Optional[str] = None  # ISO8601 (KST)
    payment_url: Optional[str] = None  # 전기만, 서버 허용 목록의 값
    reminder_enabled: bool = True
    due_date_adjusted: bool = False  # 월말 정책으로 지정일이 조정됨


class RentConfig(BaseModel):
    amount_krw: Optional[int] = Field(default=None, ge=0)
    due_day: Optional[int] = Field(default=None, ge=1, le=31)
    bank: Optional[str] = None
    account_number: Optional[str] = None  # 문자열 유지
    account_holder: Optional[str] = None
    start_month: Optional[str] = Field(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$")


class Reminder(BaseModel):
    bill_id: str
    scheduled_at_utc: str
    state: ReminderState
    policy_version: int = 1


class Notification(BaseModel):
    id: str  # bill_id|scheduled_at_utc
    bill_id: str
    message: str
    scheduled_at_utc: str
    delivered_at: Optional[str] = None
    source: BillSource
    demo_time_shift: bool = False


class ChatResponse(BaseModel):
    message: str
    bill_cards: list[Bill] = []
    rent_transfer_text: Optional[str] = None
    pending_action: Optional[dict] = None
    mode: Literal["real", "sample"] = "sample"


class ReminderSettingsRequest(BaseModel):
    enabled: bool
    bill_id: Optional[str] = None  # 없으면 전체 동의 설정


class RentSaveResponse(BaseModel):
    rent: RentConfig
    bills: list[Bill]
    notice: Optional[str] = None  # 월말 정책 등 사용자 안내
