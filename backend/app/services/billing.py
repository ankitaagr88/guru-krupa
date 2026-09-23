"""Per-visit bill, standard charges and receipts (lane B owns this module).

Bill lines have a `kind`: 'charge' (one tap from the Admin list of standard charges),
'medicine' (added by the front desk's "Bought here" — see `sync_medicine_line`) or 'other'
(typed by hand). A bill gets a receipt number the first time it is paid.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.db import utcnow
from app.models.audit import AuditLog
from app.models.billing import PAYMENT_MODES, Bill, BillItem, StandardCharge
from app.models.patients import Visit
from app.models.pharmacy import PrescriptionLine
from app.models.staff import Staff
from app.schemas.billing import BillItemIn, BillItemOut, BillOut

RECEIPT_PREFIX = "GK"
RECEIPT_RETRIES = 5


class BillingError(Exception):
    pass


class BadValue(BillingError, ValueError):
    pass


class NotFound(BillingError):
    pass


class Conflict(BillingError):
    pass


def _staff_id(by: Staff | int | None) -> int | None:
    return by.id if isinstance(by, Staff) else by


def _audit(db: Session, by, action: str, entity: str, entity_id: int | None, **detail) -> None:
    db.add(AuditLog(staff_id=_staff_id(by), action=action, entity=entity, entity_id=entity_id, detail=detail))


# --------------------------------------------------------------------------- standard charges
def standard_charges(db: Session, active_only: bool = False) -> list[StandardCharge]:
    stmt = select(StandardCharge).order_by(StandardCharge.sort_order, StandardCharge.id)
    if active_only:
        stmt = stmt.where(StandardCharge.active.is_(True))
    return list(db.scalars(stmt))


def get_standard_charge(db: Session, charge_id: int) -> StandardCharge:
    row = db.get(StandardCharge, charge_id)
    if row is None:
        raise NotFound("Charge not found")
    return row


def _charge_label(db: Session, label: str, except_id: int | None = None) -> str:
    label = " ".join((label or "").split())
    if not label:
        raise BadValue("Charge name is required")
    q = select(StandardCharge).where(func.lower(StandardCharge.label) == label.lower())
    if except_id is not None:
        q = q.where(StandardCharge.id != except_id)
    if db.scalar(q):
        raise Conflict(f"Charge '{label}' already exists")
    return label


def create_standard_charge(db: Session, label: str, amount: int, by) -> StandardCharge:
    label = _charge_label(db, label)
    order = (db.scalar(select(func.max(StandardCharge.sort_order))) or 0) + 1
    row = StandardCharge(label=label, amount=amount, active=True, sort_order=order)
    db.add(row)
    db.flush()
    _audit(db, by, "standard_charge.create", "standard_charge", row.id, label=label, amount=amount)
    db.commit()
    return row


def update_standard_charge(db: Session, row: StandardCharge, values: dict, by) -> StandardCharge:
    changed = {}
    if values.get("label") is not None:
        label = _charge_label(db, values["label"], row.id)
        if label != row.label:
            row.label = changed["label"] = label
    for k in ("amount", "active"):
        if values.get(k) is not None and values[k] != getattr(row, k):
            setattr(row, k, values[k])
            changed[k] = values[k]
    if changed:
        _audit(db, by, "standard_charge.update", "standard_charge", row.id, **changed)
        db.commit()
    return row


def delete_standard_charge(db: Session, row: StandardCharge, by) -> None:
    n = db.scalar(select(func.count()).select_from(BillItem).where(BillItem.standard_charge_id == row.id)) or 0
    if n:
        raise Conflict(f"'{row.label}' is on {n} bill{'' if n == 1 else 's'} — switch it off instead")
    _audit(db, by, "standard_charge.delete", "standard_charge", row.id, label=row.label)
    db.delete(row)
    db.commit()


def reorder_standard_charges(db: Session, ids: list[int], by) -> list[StandardCharge]:
    rows = {r.id: r for r in db.scalars(select(StandardCharge))}
    if set(ids) != set(rows) or len(ids) != len(rows):
        raise BadValue("order must list every existing charge exactly once")
    for i, key in enumerate(ids):
        rows[key].sort_order = i
    _audit(db, by, "standard_charge.reorder", "standard_charge", None, order=[str(k) for k in ids])
    db.commit()
    return standard_charges(db)


# --------------------------------------------------------------------------- bill
def _bill_for(db: Session, visit: Visit) -> Bill:
    bill = visit.bill
    if bill is None:
        bill = Bill(visit_id=visit.id)
        db.add(bill)
        visit.bill = bill
    return bill


def _item(it: BillItemIn | tuple) -> BillItem:
    if isinstance(it, tuple):  # (label, amount) — older callers
        label, amount = it
        return BillItem(label=label, amount=amount, kind="other", qty=1)
    return BillItem(label=it.label.strip(), amount=it.amount, kind=it.kind, qty=it.qty,
                    standard_charge_id=it.standard_charge_id, prescription_line_id=it.prescription_line_id)


def upsert_bill(db: Session, visit: Visit, items: list, payment_mode: str | None) -> Bill:
    """`addBillItem`/`removeBillItem`/`selectPaymentMode`: replace the visit's bill items."""
    if payment_mode is not None and payment_mode not in PAYMENT_MODES:
        raise BadValue(f"paymentMode must be one of {PAYMENT_MODES}")
    new_items = [_item(it) for it in items]
    for it in new_items:
        if it.standard_charge_id is not None and db.get(StandardCharge, it.standard_charge_id) is None:
            raise BadValue(f"Unknown standardChargeId {it.standard_charge_id}")
        if it.prescription_line_id is not None and db.get(PrescriptionLine, it.prescription_line_id) is None:
            it.prescription_line_id = None  # the prescription changed under us; keep the line as typed
    bill = _bill_for(db, visit)
    for old in list(bill.items):
        db.delete(old)
    bill.items = new_items
    if payment_mode is not None:
        bill.payment_mode = payment_mode
    db.commit()
    db.refresh(bill)
    return bill


def _clinic_year(at: datetime) -> int:
    return at.astimezone(ZoneInfo(settings.CLINIC_TZ)).year


def next_receipt_no(db: Session, year: int) -> str:
    """`GK-2026-00001`: sequential per calendar year (clinic time)."""
    prefix = f"{RECEIPT_PREFIX}-{year}-"
    last = db.scalar(select(func.max(Bill.receipt_no)).where(Bill.receipt_no.like(f"{prefix}%")))
    n = int(last[len(prefix):]) + 1 if last else 1
    return f"{prefix}{n:05d}"


def pay_bill(db: Session, bill: Bill, payment_mode: str) -> Bill:
    """Mark paid. The first payment gives the bill its receipt number; paying again (say the
    patient switched from cash to UPI) keeps the number and the original paid time's year."""
    if payment_mode not in PAYMENT_MODES:
        raise BadValue(f"paymentMode must be one of {PAYMENT_MODES}")
    bill.payment_mode = payment_mode
    bill.paid_at = utcnow()
    if bill.receipt_no:
        db.commit()
        return bill
    for attempt in range(RECEIPT_RETRIES):
        bill.receipt_no = next_receipt_no(db, _clinic_year(bill.paid_at))
        try:
            db.commit()
            return bill
        except IntegrityError:  # two desks paid at the same moment — take the next number
            db.rollback()
            bill.payment_mode, bill.paid_at = payment_mode, utcnow()
            if attempt == RECEIPT_RETRIES - 1:
                raise
    return bill


def bill_out(bill: Bill) -> BillOut:
    visit = bill.visit
    patient = visit.patient if visit is not None else None
    items = [BillItemOut(id=i.id, label=i.label, amount=i.amount, kind=i.kind or "other", qty=i.qty or 1,
                         standard_charge_id=i.standard_charge_id, prescription_line_id=i.prescription_line_id,
                         price_missing=(i.kind == "medicine" and i.amount == 0))
             for i in bill.items]
    return BillOut(id=bill.id, visit_id=bill.visit_id, items=items, total=sum(i.amount for i in bill.items),
                   payment_mode=bill.payment_mode, paid_at=bill.paid_at, paid=bill.paid_at is not None,
                   receipt_no=bill.receipt_no, patient_name=patient.name if patient else None,
                   token=visit.token if visit else None, visit_date=visit.date if visit else None)


# --------------------------------------------------------------------------- "Bought here" lines
def medicine_label(name: str, qty: int) -> str:
    return f"{name} × {qty}"[:120]


def sync_medicine_line(db: Session, visit: Visit, line: PrescriptionLine) -> BillItem:
    """"Bought here": put the medicine on the visit's bill (or refresh the line already there).
    Amount = qty × the medicine's price; 0 when Admin has not priced it yet, so the panel asks
    reception to type it. Never commits — the caller's transaction does."""
    bill = _bill_for(db, visit)
    price = line.medicine.price if line.medicine is not None else None
    amount = line.dispensed_qty * price if price is not None else 0
    item = next((i for i in bill.items if i.prescription_line_id == line.id), None)
    if item is None:
        item = BillItem(kind="medicine", prescription_line_id=line.id, label="", amount=0, qty=1)
        bill.items.append(item)
    item.kind = "medicine"
    item.qty = line.dispensed_qty
    item.label = medicine_label(line.name, line.dispensed_qty)
    item.amount = amount
    return item


def drop_medicine_line(db: Session, visit: Visit, line_id: int) -> None:
    """Undo of "Bought here": take the medicine off the bill. Never commits."""
    bill = visit.bill
    if bill is None:
        return
    for item in [i for i in bill.items if i.prescription_line_id == line_id]:
        bill.items.remove(item)
        db.delete(item)


def detach_medicine_lines(db: Session, visit: Visit, old_lines: list[PrescriptionLine]) -> list[tuple[BillItem, str]]:
    """The prescription is about to be replaced (its lines get new ids). Unhook the bill's
    medicine lines from the old ids and remember which medicine each was for; call
    `reattach_medicine_lines` once the new lines exist."""
    bill = visit.bill
    if bill is None:
        return []
    names = {ln.id: ln.name.lower() for ln in old_lines}
    pending = []
    for item in bill.items:
        if item.prescription_line_id in names:
            pending.append((item, names[item.prescription_line_id]))
            item.prescription_line_id = None
    db.flush()
    return pending


def reattach_medicine_lines(db: Session, visit: Visit, pending: list[tuple[BillItem, str]],
                            new_lines: list[PrescriptionLine]) -> None:
    """Point each remembered bill line at the new prescription line for the same medicine when that
    medicine is still bought here; drop it when the doctor took the medicine off."""
    kept = {ln.name.lower(): ln for ln in new_lines if ln.dispensed_qty > 0}
    for item, name in pending:
        line = kept.get(name)
        if line is not None:
            item.prescription_line_id = line.id
        else:
            visit.bill.items.remove(item)
            db.delete(item)
