from __future__ import annotations

import calendar
import os
from datetime import date, datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))

# 시연용 시간 이동(시간 단위). DEMO_MODE=1 일 때만 DB 설정을 반영한다.
_demo_offset_hours = 0


def demo_enabled() -> bool:
    return os.environ.get("DEMO_MODE") == "1"


def set_demo_offset(hours: int) -> None:
    global _demo_offset_hours
    _demo_offset_hours = hours if demo_enabled() else 0


def demo_offset_hours() -> int:
    return _demo_offset_hours if demo_enabled() else 0


def now_kst() -> datetime:
    return datetime.now(KST) + timedelta(hours=demo_offset_hours())


def clamp_due_date(period: str, due_day: int) -> tuple[str, bool]:
    """없는 지정일은 월말로 조정한다. (날짜, 조정 여부)"""
    year, month = int(period[:4]), int(period[5:7])
    last = calendar.monthrange(year, month)[1]
    day = min(due_day, last)
    return date(year, month, day).isoformat(), day != due_day


def add_months(period: str, n: int) -> str:
    y, m = int(period[:4]), int(period[5:7])
    idx = y * 12 + (m - 1) + n
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"
