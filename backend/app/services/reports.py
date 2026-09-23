"""The "Today" summary: patients seen, time per stage, money collected, medicines sold.

A clinic day is the clinic's local calendar date (settings.CLINIC_TZ), like the queue.

Time per stage comes from the `stage_move` audit rows: a visit enters its first stage when it is
registered (`Visit.created_at`), and every move closes the stage it left. A visit's minutes in a
stage are summed if it went through it twice; the average is over the visits that left the
stage. Visits still sitting in a stage are not averaged — they are counted as `waitingNow`.
"""
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.audit import AuditLog
from app.models.billing import PAYMENT_MODES, Bill, BillItem
from app.models.config import Stage
from app.models.patients import Visit
from app.models.pharmacy import PrescriptionLine
from app.schemas.reports import (Collections, MedicineSold, ModeTotal, PatientCounts, ReceiptRow, StageTime,
                                 TodayReport, UnpaidBill)

DONE_STAGE = "done"


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)  # SQLite drops tzinfo


def clinic_today() -> date:
    return datetime.now(ZoneInfo(settings.CLINIC_TZ)).date()


def day_bounds(day: date) -> tuple[datetime, datetime]:
    """[start, end) of the clinic day, in UTC."""
    tz = ZoneInfo(settings.CLINIC_TZ)
    start = datetime.combine(day, time.min, tzinfo=tz).astimezone(timezone.utc)
    return start, start + timedelta(days=1)


def _within(dt: datetime | None, bounds: tuple[datetime, datetime]) -> bool:
    return dt is not None and bounds[0] <= _aware(dt) < bounds[1]


def _minutes(a: datetime, b: datetime) -> float:
    return max(0.0, (_aware(b) - _aware(a)).total_seconds() / 60)


def _avg(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def stage_times(db: Session, visits: list[Visit]) -> list[StageTime]:
    stages = list(db.scalars(select(Stage).order_by(Stage.sort_order, Stage.id)))
    ids = [v.id for v in visits]
    moves: dict[int, list[AuditLog]] = defaultdict(list)
    if ids:
        for row in db.scalars(select(AuditLog).where(AuditLog.action == "stage_move", AuditLog.entity == "visit",
                                                     AuditLog.entity_id.in_(ids))
                              .order_by(AuditLog.at, AuditLog.id)):
            moves[row.entity_id].append(row)

    spent: dict[str, list[float]] = defaultdict(list)  # stage key -> minutes per visit
    waiting: dict[str, int] = defaultdict(int)
    for v in visits:
        per_stage: dict[str, float] = defaultdict(float)
        rows = moves.get(v.id, [])
        current = (rows[0].detail or {}).get("from") if rows else v.stage_key
        entered = v.created_at
        for row in rows:
            detail = row.detail or {}
            left = detail.get("from") or current
            if left and left != DONE_STAGE:
                per_stage[left] += _minutes(entered, row.at)
            current, entered = detail.get("to"), row.at
        for key, mins in per_stage.items():
            spent[key].append(mins)
        if current and current != DONE_STAGE and v.status != "completed":
            waiting[current] += 1

    return [StageTime(key=s.key, label=s.label, avg_minutes=_avg(spent.get(s.key, [])),
                      visits=len(spent.get(s.key, [])), waiting_now=waiting.get(s.key, 0))
            for s in stages if s.key != DONE_STAGE]


def _bill_total(bill: Bill) -> int:
    return sum(i.amount for i in bill.items)


def collections(db: Session, day: date, visits: list[Visit], bounds) -> tuple[Collections, list[ReceiptRow]]:
    # Paid that day (by paid time, whatever day the visit was).
    lo, hi = bounds
    candidates = db.scalars(select(Bill).where(Bill.paid_at.is_not(None), Bill.paid_at >= lo - timedelta(days=1),
                                               Bill.paid_at < hi + timedelta(days=1)))
    paid = sorted((b for b in candidates if _within(b.paid_at, bounds)), key=lambda b: _aware(b.paid_at))
    by_mode = {m: [0, 0] for m in PAYMENT_MODES}
    receipts = []
    for b in paid:
        total = _bill_total(b)
        slot = by_mode.setdefault(b.payment_mode or "cash", [0, 0])
        slot[0] += 1
        slot[1] += total
        receipts.append(ReceiptRow(receipt_no=b.receipt_no, visit_id=b.visit_id, name=b.visit.patient.name,
                                   token=b.visit.token, total=total, payment_mode=b.payment_mode, paid_at=b.paid_at))
    unpaid = [UnpaidBill(visit_id=v.id, name=v.patient.name, token=v.token, total=_bill_total(v.bill))
              for v in visits if v.bill is not None and v.bill.paid_at is None and v.bill.items]
    out = Collections(by_mode=[ModeTotal(mode=m, bills=n, amount=a) for m, (n, a) in by_mode.items()],
                      total=sum(a for _, a in by_mode.values()), bills_paid=len(paid), unpaid=unpaid,
                      unpaid_total=sum(u.total for u in unpaid))
    return out, receipts


def medicines_sold(db: Session, bounds) -> list[MedicineSold]:
    lo, hi = bounds
    lines = [ln for ln in db.scalars(select(PrescriptionLine).where(
        PrescriptionLine.dispensed_qty > 0, PrescriptionLine.dispensed_at >= lo - timedelta(days=1),
        PrescriptionLine.dispensed_at < hi + timedelta(days=1))) if _within(ln.dispensed_at, bounds)]
    billed = {}
    if lines:
        billed = {i.prescription_line_id: i.amount for i in db.scalars(
            select(BillItem).where(BillItem.prescription_line_id.in_([ln.id for ln in lines])))}
    sold: dict[str, list[int]] = {}
    for ln in lines:
        price = ln.medicine.price if ln.medicine is not None else None
        amount = billed.get(ln.id, ln.dispensed_qty * price if price is not None else 0)
        row = sold.setdefault(ln.name, [0, 0])
        row[0] += ln.dispensed_qty
        row[1] += amount
    return [MedicineSold(name=n, qty=q, amount=a) for n, (q, a) in sorted(sold.items(), key=lambda kv: (-kv[1][0], kv[0]))]


def today_report(db: Session, day: date | None = None) -> TodayReport:
    day = day or clinic_today()
    bounds = day_bounds(day)
    visits = list(db.scalars(select(Visit).where(Visit.date == day).order_by(Visit.id)))
    completed = [v for v in visits if v.status == "completed"]
    visit_minutes = [_minutes(v.created_at, v.completed_at) for v in completed if v.completed_at is not None]
    money, receipts = collections(db, day, visits, bounds)
    meds = medicines_sold(db, bounds)
    return TodayReport(
        date=day,
        patients=PatientCounts(registered=len(visits), seen=len(completed), in_progress=len(visits) - len(completed)),
        avg_visit_minutes=_avg(visit_minutes), stages=stage_times(db, visits), collections=money,
        medicines=meds, medicines_qty=sum(m.qty for m in meds), medicines_amount=sum(m.amount for m in meds),
        receipts=receipts)
