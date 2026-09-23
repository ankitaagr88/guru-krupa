"""The "Today" summary (lane B owns this module). Money is whole rupees, times are minutes."""
from datetime import date, datetime

from app.schemas.common import CamelModel


class PatientCounts(CamelModel):
    registered: int  # visits opened that day
    seen: int  # visits completed (moved to Done)
    in_progress: int  # still somewhere in the queue


class StageTime(CamelModel):
    key: str
    label: str
    avg_minutes: float | None  # None when no visit has left this stage yet
    visits: int  # visits that passed through (entered and left) the stage
    waiting_now: int  # visits still sitting in it — not counted in the average


class ModeTotal(CamelModel):
    mode: str  # cash | upi | card | mediclaim
    bills: int
    amount: int


class UnpaidBill(CamelModel):
    visit_id: int
    name: str
    token: str
    total: int


class Collections(CamelModel):
    by_mode: list[ModeTotal]
    total: int
    bills_paid: int
    unpaid: list[UnpaidBill]
    unpaid_total: int


class MedicineSold(CamelModel):
    name: str
    qty: int
    amount: int


class ReceiptRow(CamelModel):
    receipt_no: str | None
    visit_id: int
    name: str
    token: str
    total: int
    payment_mode: str | None
    paid_at: datetime


class TodayReport(CamelModel):
    date: date
    patients: PatientCounts
    avg_visit_minutes: float | None  # registration → Done, completed visits only
    stages: list[StageTime]
    collections: Collections
    medicines: list[MedicineSold]
    medicines_qty: int
    medicines_amount: int
    receipts: list[ReceiptRow]
