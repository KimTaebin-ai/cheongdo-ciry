from __future__ import annotations

import asyncio
import base64
import hmac
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from . import chat as chat_module
from .models import Bill, Notification, RentConfig, RentSaveResponse, ReminderSettingsRequest
from .store import Store
from .timeutil import demo_enabled, demo_offset_hours, set_demo_offset

adapter = chat_module.adapter
store = chat_module.store
TICK_SECONDS = int(os.environ.get("REMINDER_TICK_SECONDS", "30"))


async def _tick_loop() -> None:
    while True:
        store.deliver_due()
        await asyncio.sleep(TICK_SECONDS)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.environ.get("SEED_SAMPLE", "1") == "1":
        store.seed_demo(adapter)
    task = asyncio.create_task(_tick_loop())
    yield
    task.cancel()


app = FastAPI(title="1인 가구 독립 도우미 API", lifespan=lifespan)


@app.middleware("http")
async def demo_auth(request: Request, call_next):
    """보호된 단일 데모 사용자: DEMO_PASSWORD 설정 시 HTTP Basic 요구(/health 제외)."""
    password = os.environ.get("DEMO_PASSWORD")
    if password and request.url.path != "/health":
        ok = False
        header = request.headers.get("authorization", "")
        if header.lower().startswith("basic "):
            try:
                _, _, given = base64.b64decode(header[6:]).decode().partition(":")
                ok = hmac.compare_digest(given.encode(), password.encode())
            except Exception:
                ok = False
        if not ok:
            return JSONResponse({"detail": "unauthorized"}, status_code=401,
                                headers={"WWW-Authenticate": 'Basic realm="demo"'})
    return await call_next(request)


@app.get("/health")
def health():
    return {"status": "ok", "kepco_mode": "sample", "demo_time_shift_hours": demo_offset_hours()}


@app.get("/api/bills", response_model=list[Bill])
def get_bills(refresh: bool = False):
    if refresh:
        store.refresh_electricity(adapter)
    return store.list_bills()


@app.get("/api/notifications", response_model=list[Notification])
def get_notifications():
    store.deliver_due()
    return store.notifications()


@app.post("/api/reminder-settings")
def reminder_settings(req: ReminderSettingsRequest):
    if not store.set_reminder_enabled(req.enabled, req.bill_id):
        raise HTTPException(404, "bill not found")
    return {"enabled": req.enabled, "bill_id": req.bill_id, "reminders": store.reminders(req.bill_id)}


@app.get("/api/rent", response_model=RentConfig)
def get_rent():
    return store.get_rent()


@app.put("/api/rent", response_model=RentSaveResponse)
def put_rent(cfg: RentConfig):
    return store.save_rent(cfg)


@app.get("/api/rent/transfer-text")
def rent_transfer_text():
    text = store.rent_transfer_text()
    if text is None:
        raise HTTPException(409, "월세 정보(금액·은행·계좌번호·예금주)가 부족합니다")
    return {"rent_transfer_text": text}  # 상태를 바꾸지 않는다


@app.post("/api/bills/{bill_id}/confirm-paid", response_model=Bill)
def confirm_paid(bill_id: str):
    bill = store.confirm_paid(bill_id)
    if not bill:
        raise HTTPException(404, "bill not found")
    return bill


@app.post("/api/demo/time-shift")
def demo_time_shift(hours: int):
    """시연 전용. DEMO_MODE=1 에서만 동작하며 응답에 표시된다."""
    if not demo_enabled():
        raise HTTPException(403, "DEMO_MODE disabled")
    set_demo_offset(hours)
    store.deliver_due()
    return {"demo_time_shift_hours": demo_offset_hours()}


app.include_router(chat_module.router)

_static = Path(os.environ.get("STATIC_DIR", "/app/static"))
if _static.is_dir():
    app.mount("/", StaticFiles(directory=_static, html=True), name="static")
