"""The "Today" summary (lane B owns this module). Money is whole rupees, times are minutes."""
from datetime import date, datetime

from app.schemas.common import CamelModel


class PatientCounts(CamelModel):
    registered: int  # visits opened that day
    seen: int  # visits completed (moved to Done)
    in_progress: int  # still somewhere in the queue


class KindCount(CamelModel):
    key: str
    label: str
    count: int


class VisitKindCounts(CamelModel):
    """The day's visits by visit kind (Admin › Visit types & fee rules), in the admin's order."""

    kinds: list[KindCount]  # every active kind (0 included), plus any switched-off kind used that day
    emergencies: int  # visits with the emergency fee
    not_set: int = 0  # visits without a kind (e.g. registered before visit kinds existed)


class StageTime(CamelModel):
    key: str
    label: str
    avg_minutes: float | None  # None when no visit has left this stage yet
    visits: int  # visits that passed through (entered and left) the stage
    waiting_now: int  # visits still sitting in it — not counted in the average


class ModeTotal(CamelModel):
    mode: str  # cash | upi | card | mediclaim
    bills: int  # payments received in this mode that day
    amount: int


class UnpaidBill(CamelModel):
    """A bill with money still owed (as of now), from this day or an earlier one."""

    visit_id: int
    patient_id: int | None = None
    name: str
    token: str
    visit_date: date | None = None
    total: int
    paid_amount: int = 0
    balance: int = 0


class Collections(CamelModel):
    """Money received that day — counted by the day each payment was received, whatever day the
    visit was (a balance paid a week later counts on the day it came in)."""

    by_mode: list[ModeTotal]
    total: int
    bills_paid: int  # bills that received money that day
    unpaid: list[UnpaidBill]  # "Money still owed": every bill still owing, visits on or before the day
    unpaid_total: int  # sum of their balances


class MedicineSold(CamelModel):
    name: str
    qty: int
    amount: int


class ReceiptRow(CamelModel):
    """One payment received that day (a bill paid in two parts on one day has two rows)."""

    receipt_no: str | None
    visit_id: int
    payment_id: int | None = None
    name: str
    token: str
    total: int  # this payment's amount
    bill_total: int = 0
    balance: int = 0  # still owed on the bill now
    payment_mode: str | None
    paid_at: datetime  # when this payment was received


class TodayReport(CamelModel):
    date: date
    patients: PatientCounts
    avg_visit_minutes: float | None  # registration → Done, completed visits only
    stages: list[StageTime]
    visit_kinds: VisitKindCounts | None = None  # new patients, follow-ups, new cases, emergencies
    collections: Collections
    medicines: list[MedicineSold]
    medicines_qty: int
    medicines_amount: int
    receipts: list[ReceiptRow]
