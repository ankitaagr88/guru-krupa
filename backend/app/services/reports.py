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
from app.models.billing import PAYMENT_MODES, BillItem, BillPayment
from app.models.config import Stage
from app.models.patients import Visit
from app.models.pharmacy import PrescriptionLine
from app.schemas.reports import (Collections, KindCount, MedicineSold, ModeTotal, PatientCounts, ReceiptRow,
                                 StageTime, TodayReport, UnpaidBill, VisitKindCounts)
from app.services import billing
from app.services.fees import visit_kinds as all_visit_kinds

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
        # A move logged before the visit existed belongs to something else (e.g. a reused id).
        rows = [r for r in moves.get(v.id, []) if _aware(r.at) >= _aware(v.created_at)]
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


def visit_kind_counts(db: Session, visits: list[Visit]) -> VisitKindCounts:
    counts: dict[str, int] = defaultdict(int)
    for v in visits:
        counts[v.visit_kind_key or ""] += 1
    kinds = [KindCount(key=k.key, label=k.label, count=counts.get(k.key, 0))
             for k in all_visit_kinds(db) if k.active or counts.get(k.key)]
    return VisitKindCounts(kinds=kinds, emergencies=sum(1 for v in visits if v.emergency), not_set=counts.get("", 0))


def payments_on(db: Session, bounds) -> list[BillPayment]:
    """Payments received within [start, end), in time order."""
    lo, hi = bounds
    rows = db.scalars(select(BillPayment).where(BillPayment.at >= lo - timedelta(days=1),
                                                BillPayment.at < hi + timedelta(days=1)))
    return sorted((p for p in rows if _within(p.at, bounds)), key=lambda p: (_aware(p.at), p.id))


def collections(db: Session, day: date, visits: list[Visit], bounds) -> tuple[Collections, list[ReceiptRow]]:
    # Received that day (by payment time, whatever day the visit was).
    payments = payments_on(db, bounds)
    by_mode = {m: [0, 0] for m in PAYMENT_MODES}
    receipts = []
    for p in payments:
        b = p.bill
        slot = by_mode.setdefault(p.mode or "cash", [0, 0])
        slot[0] += 1
        slot[1] += p.amount
        receipts.append(ReceiptRow(receipt_no=b.receipt_no, visit_id=b.visit_id, payment_id=p.id,
                                   name=b.visit.patient.name, token=b.visit.token, total=p.amount,
                                   bill_total=billing.bill_total(b), balance=billing.bill_balance(b),
                                   payment_mode=p.mode, paid_at=_aware(p.at)))
    unpaid = [UnpaidBill(visit_id=b.visit_id, patient_id=b.visit.patient_id, name=b.visit.patient.name,
                         token=b.visit.token, visit_date=b.visit.date, total=billing.bill_total(b),
                         paid_amount=billing.paid_amount(b), balance=billing.bill_balance(b))
              for b in billing.owed_bills(db, on_or_before=day)]
    out = Collections(by_mode=[ModeTotal(mode=m, bills=n, amount=a) for m, (n, a) in by_mode.items()],
                      total=sum(a for _, a in by_mode.values()), bills_paid=len({p.bill_id for p in payments}),
                      unpaid=unpaid, unpaid_total=sum(u.balance for u in unpaid))
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
        avg_visit_minutes=_avg(visit_minutes), stages=stage_times(db, visits),
        visit_kinds=visit_kind_counts(db, visits), collections=money,
        medicines=meds, medicines_qty=sum(m.qty for m in meds), medicines_amount=sum(m.amount for m in meds),
        receipts=receipts)
