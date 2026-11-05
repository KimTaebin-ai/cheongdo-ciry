"""SQLite 저장·월세·청구·자동 알림. 모든 금액·날짜는 코드로 계산한다."""
from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

from .adapters import KepcoAdapter
from .models import Bill, Notification, Reminder, RentConfig, RentSaveResponse
from .timeutil import KST, add_months, clamp_due_date, demo_offset_hours, now_kst

POLICY_VERSION = 1
REMINDER_DAYS_BEFORE = (3, 1)
REMINDER_HOUR_KST = 9

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS rent_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  amount_krw INTEGER, due_day INTEGER, bank TEXT, account_number TEXT,
  account_holder TEXT, start_month TEXT);
CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, period TEXT NOT NULL,
  amount_krw INTEGER, due_date TEXT, autopay INTEGER, status TEXT NOT NULL,
  source TEXT NOT NULL, checked_at TEXT, payment_url TEXT,
  reminder_enabled INTEGER NOT NULL DEFAULT 1, due_date_adjusted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS reminders (
  bill_id TEXT NOT NULL, scheduled_at_utc TEXT NOT NULL, state TEXT NOT NULL,
  policy_version INTEGER NOT NULL, delivered_at TEXT,
  PRIMARY KEY (bill_id, scheduled_at_utc));
"""


def _fmt_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Store:
    def __init__(self, path: str = ":memory:", clock: Callable[[], datetime] = now_kst):
        self.clock = clock
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.lock:
            self.conn.executescript(SCHEMA)
            self.conn.commit()

    # ---- 설정 ----
    def _get(self, key: str, default: str = "") -> str:
        r = self.conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return r["value"] if r else default

    def _set(self, key: str, value: str) -> None:
        self.conn.execute("INSERT OR REPLACE INTO settings VALUES (?,?)", (key, value))

    def consent(self) -> bool:
        return self._get("reminder_consent") == "1"

    # ---- 청구 ----
    @staticmethod
    def _bill(r: sqlite3.Row) -> Bill:
        d = dict(r)
        d["autopay"] = None if d["autopay"] is None else bool(d["autopay"])
        d["reminder_enabled"] = bool(d["reminder_enabled"])
        d["due_date_adjusted"] = bool(d["due_date_adjusted"])
        return Bill(**d)

    def get_bill(self, bill_id: str) -> Optional[Bill]:
        r = self.conn.execute("SELECT * FROM bills WHERE id=?", (bill_id,)).fetchone()
        return self._bill(r) if r else None

    def list_bills(self) -> list[Bill]:
        with self.lock:
            rows = self.conn.execute("SELECT * FROM bills ORDER BY due_date, kind").fetchall()
        return [self._bill(r) for r in rows]

    def _upsert_bill(self, b: Bill) -> Bill:
        """ID 기반 갱신. 사용자 확인 상태와 알림 해제 설정은 보존한다."""
        old = self.get_bill(b.id)
        if old:
            b = b.model_copy(update={"status": old.status, "reminder_enabled": old.reminder_enabled})
        self.conn.execute(
            """INSERT INTO bills (id,kind,period,amount_krw,due_date,autopay,status,source,checked_at,
               payment_url,reminder_enabled,due_date_adjusted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET amount_krw=excluded.amount_krw, due_date=excluded.due_date,
               autopay=excluded.autopay, source=excluded.source, checked_at=excluded.checked_at,
               payment_url=excluded.payment_url, due_date_adjusted=excluded.due_date_adjusted""",
            (b.id, b.kind, b.period, b.amount_krw, b.due_date,
             None if b.autopay is None else int(b.autopay), b.status, b.source, b.checked_at,
             b.payment_url, int(b.reminder_enabled), int(b.due_date_adjusted)),
        )
        self._reschedule(b.id)
        return self.get_bill(b.id)  # type: ignore[return-value]

    def refresh_electricity(self, adapter: KepcoAdapter) -> Bill:
        with self.lock:
            bill = self._upsert_bill(adapter.fetch_bill())
            self.conn.commit()
            return bill

    # ---- 월세 ----
    def get_rent(self) -> RentConfig:
        r = self.conn.execute("SELECT * FROM rent_config WHERE id=1").fetchone()
        return RentConfig(**{k: r[k] for k in RentConfig.model_fields}) if r else RentConfig()

    def save_rent(self, cfg: RentConfig) -> RentSaveResponse:
        with self.lock:
            self.conn.execute(
                "INSERT OR REPLACE INTO rent_config VALUES (1,?,?,?,?,?,?)",
                (cfg.amount_krw, cfg.due_day, cfg.bank, cfg.account_number, cfg.account_holder, cfg.start_month),
            )
            bills, notice = self._generate_rent_bills(cfg)
            self.conn.commit()
        return RentSaveResponse(rent=cfg, bills=bills, notice=notice)

    def _generate_rent_bills(self, cfg: RentConfig) -> tuple[list[Bill], Optional[str]]:
        if cfg.amount_krw is None or cfg.due_day is None:
            return [], None
        current = self.clock().strftime("%Y-%m")
        first = max(cfg.start_month or current, current)
        out, adjusted = [], []
        for i in range(2):  # 이번 달·다음 달
            period = add_months(first, i)
            due, adj = clamp_due_date(period, cfg.due_day)
            if adj:
                adjusted.append(f"{period} → {due}")
            old = self.get_bill(f"rent-{period}")
            if old and old.status == "user_confirmed":
                out.append(old)
                continue
            out.append(self._upsert_bill(Bill(
                id=f"rent-{period}", kind="rent", period=period, amount_krw=cfg.amount_krw,
                due_date=due, source="manual", checked_at=self.clock().isoformat(),
                due_date_adjusted=adj)))
        notice = None
        if adjusted:
            notice = (f"{cfg.due_day}일이 없는 달은 말일로 조정합니다: " + ", ".join(adjusted)
                      + ". 맞는지 확인해 주세요.")
        return out, notice

    def rent_transfer_text(self) -> Optional[str]:
        c = self.get_rent()
        if None in (c.amount_krw, c.bank, c.account_number, c.account_holder):
            return None
        return (f"월세 {c.amount_krw:,}원을 {c.bank} {c.account_number} "
                f"(예금주 {c.account_holder})로 송금해 주세요. (안내 문구이며 실제 송금은 하지 않습니다)")

    # ---- 납부 확인 ----
    def confirm_paid(self, bill_id: str) -> Optional[Bill]:
        """사용자 확인만 기록한다. 남은 알림은 취소한다."""
        with self.lock:
            if not self.get_bill(bill_id):
                return None
            self.conn.execute("UPDATE bills SET status='user_confirmed' WHERE id=?", (bill_id,))
            self._reschedule(bill_id)
            self.conn.commit()
            return self.get_bill(bill_id)

    # ---- 알림 ----
    def set_reminder_enabled(self, enabled: bool, bill_id: Optional[str] = None) -> bool:
        with self.lock:
            if bill_id is None:
                self._set("reminder_consent", "1" if enabled else "0")
                ids = [r["id"] for r in self.conn.execute("SELECT id FROM bills")]
            else:
                if not self.get_bill(bill_id):
                    return False
                self.conn.execute("UPDATE bills SET reminder_enabled=? WHERE id=?", (int(enabled), bill_id))
                ids = [bill_id]
            for i in ids:
                self._reschedule(i)
            self.conn.commit()
            return True

    def _targets(self, b: Bill) -> set[str]:
        if not (self.consent() and b.reminder_enabled and b.status == "pending" and b.due_date):
            return set()
        due = datetime.strptime(b.due_date, "%Y-%m-%d").date()
        now = self.clock()
        out = set()
        for d in REMINDER_DAYS_BEFORE:
            at = datetime.combine(due - timedelta(days=d), datetime.min.time(), tzinfo=KST).replace(hour=REMINDER_HOUR_KST)
            if at > now:  # 지난 시점은 소급하지 않는다
                out.add(_fmt_utc(at))
        return out

    def _reschedule(self, bill_id: str) -> None:
        b = self.get_bill(bill_id)
        if not b:
            return
        target = self._targets(b)
        rows = self.conn.execute("SELECT scheduled_at_utc, state FROM reminders WHERE bill_id=?", (bill_id,)).fetchall()
        existing = {r["scheduled_at_utc"]: r["state"] for r in rows}
        for at, state in existing.items():
            if state == "pending" and at not in target:
                self.conn.execute("UPDATE reminders SET state='cancelled' WHERE bill_id=? AND scheduled_at_utc=?", (bill_id, at))
        for at in target:
            if existing.get(at) == "delivered":
                continue
            self.conn.execute(
                """INSERT INTO reminders (bill_id, scheduled_at_utc, state, policy_version) VALUES (?,?, 'pending', ?)
                   ON CONFLICT(bill_id, scheduled_at_utc) DO UPDATE SET state='pending', policy_version=excluded.policy_version""",
                (bill_id, at, POLICY_VERSION))

    def reminders(self, bill_id: Optional[str] = None) -> list[Reminder]:
        q, args = "SELECT * FROM reminders", ()
        if bill_id:
            q, args = q + " WHERE bill_id=?", (bill_id,)
        with self.lock:
            rows = self.conn.execute(q + " ORDER BY scheduled_at_utc", args).fetchall()
        return [Reminder(bill_id=r["bill_id"], scheduled_at_utc=r["scheduled_at_utc"], state=r["state"],
                         policy_version=r["policy_version"]) for r in rows]

    def deliver_due(self) -> int:
        """내부 주기 작업: 예약 시각이 지난 pending을 delivered로 바꾼다."""
        now = _fmt_utc(self.clock())
        with self.lock:
            cur = self.conn.execute(
                "UPDATE reminders SET state='delivered', delivered_at=? WHERE state='pending' AND scheduled_at_utc<=?",
                (now, now))
            self.conn.commit()
            return cur.rowcount

    def notifications(self) -> list[Notification]:
        with self.lock:
            rows = self.conn.execute(
                """SELECT r.bill_id, r.scheduled_at_utc, r.delivered_at, b.kind, b.amount_krw, b.due_date, b.source
                   FROM reminders r JOIN bills b ON b.id=r.bill_id
                   WHERE r.state='delivered' ORDER BY r.scheduled_at_utc DESC""").fetchall()
        out = []
        for r in rows:
            sched = datetime.strptime(r["scheduled_at_utc"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            days = (datetime.strptime(r["due_date"], "%Y-%m-%d").date() - sched.astimezone(KST).date()).days
            label = "월세" if r["kind"] == "rent" else "전기요금"
            amount = f" {r['amount_krw']:,}원," if r["amount_krw"] is not None else ""
            tag = " (샘플 데이터)" if r["source"] == "sample" else ""
            out.append(Notification(
                id=f"{r['bill_id']}|{r['scheduled_at_utc']}", bill_id=r["bill_id"],
                message=f"{label} 납부 {days}일 전입니다.{amount} 납부일 {r['due_date']}{tag}",
                scheduled_at_utc=r["scheduled_at_utc"], delivered_at=r["delivered_at"],
                source=r["source"], demo_time_shift=demo_offset_hours() != 0))
        return out

    def seed_demo(self, adapter: KepcoAdapter) -> None:
        """합성 데이터 시드. 이미 있으면 건너뛴다."""
        with self.lock:
            if self.list_bills():
                return
        self.refresh_electricity(adapter)
