"""앱 읽기 전용 MCP 서버 (stdio).

Copilot CLI가 이 프로세스를 직접 띄워 stdin/stdout으로 연결한다. 외부 HTTP로 노출하지 않는다.
메인 프로세스와 같은 DB_PATH의 SQLite 파일을 `Store`로 열어 읽기만 한다. 저장·알림 로직은 Store에 있다.

실행: 저장소 루트에서 `python -m backend.mcp_server`
"""
from __future__ import annotations

import os
from typing import Optional

from mcp.server.fastmcp import FastMCP

from backend.app.adapters import KEPCO_PAYMENT_URL
from backend.app.store import Store

TOOL_NAMES = [
    "list_due_bills", "get_bill", "get_rent", "get_rent_transfer_text", "list_reminders", "get_payment_guide",
]

server = FastMCP("cheongdo-app", instructions="1인 가구 청구 앱의 읽기 전용 도구. 저장·납부 확인·알림 변경은 하지 않는다.")
_store: Optional[Store] = None


def store() -> Store:
    global _store
    if _store is None:
        _store = Store(os.environ.get("DB_PATH", "data.db"))
    return _store


@server.tool(description="납부 확인 전이고 납부일이 정해진 청구 목록. kind는 electricity 또는 rent.")
def list_due_bills(kind: Optional[str] = None) -> list[dict]:
    bills = [b for b in store().list_bills() if b.status == "pending" and b.due_date and (not kind or b.kind == kind)]
    return [b.model_dump(mode="json") for b in bills]


@server.tool(description="ID로 청구 1건 조회. 없으면 null.")
def get_bill(bill_id: str) -> Optional[dict]:
    bill = store().get_bill(bill_id)
    return bill.model_dump(mode="json") if bill else None


@server.tool(description="등록된 월세 설정(금액·납부일·은행·계좌·예금주).")
def get_rent() -> dict:
    return store().get_rent().model_dump(mode="json")


@server.tool(description="월세 송금 안내 문구. 정보가 부족하면 null. 복사는 납부 완료가 아니다.")
def get_rent_transfer_text() -> dict:
    return {"rent_transfer_text": store().rent_transfer_text()}


@server.tool(description="알림 예약 목록. bill_id를 주면 그 청구만.")
def list_reminders(bill_id: Optional[str] = None) -> list[dict]:
    return [r.model_dump(mode="json") for r in store().reminders(bill_id)]


@server.tool(description="전기요금 공식 납부 안내 링크(한전ON). 링크 방문은 납부 완료가 아니다.")
def get_payment_guide() -> dict:
    return {"name": "한전ON", "url": KEPCO_PAYMENT_URL, "note": "공식 사이트에서 직접 조회·납부하세요. 링크 방문은 납부 완료가 아닙니다."}


if __name__ == "__main__":
    server.run("stdio")
