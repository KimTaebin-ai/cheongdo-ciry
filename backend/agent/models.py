"""Typed contracts for bills and reminders."""

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class BillCategory(StrEnum):
    electricity = "electricity"
    gas = "gas"
    water = "water"
    rent = "rent"
    insurance = "insurance"
    maintenance = "maintenance"


class BillStatus(StrEnum):
    needs_review = "needs_review"
    scheduled = "scheduled"
    paid_confirmed = "paid_confirmed"
    overdue_unconfirmed = "overdue_unconfirmed"


class BillSource(BaseModel):
    type: Literal["sample", "paste"]
    excerpt: str
    hash: str


class Reminder(BaseModel):
    at: datetime
    status: str


class Bill(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    category: BillCategory
    provider: str
    billing_month: str = Field(pattern=r"^\d{4}-\d{2}$")
    amount_krw: int
    due_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    autopay: bool
    status: BillStatus
    source: BillSource
    reminders: list[Reminder] = Field(default_factory=list)
    is_sample: bool


class ExtractedBill(BaseModel):
    id: str | None = None
    category: BillCategory | None = None
    provider: str | None = None
    billing_month: str | None = None
    amount_krw: int | None = None
    due_date: str | None = None
    autopay: bool | None = None
    status: BillStatus
    source: BillSource
    reminders: list[Reminder] = Field(default_factory=list)
    is_sample: bool = False


class BillQuery(BaseModel):
    category: BillCategory | None = None
    month: str | None = None
