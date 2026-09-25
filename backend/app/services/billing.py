"""Per-visit bill, standard charges, part payments and receipts (lane B; payments and day-book
columns: lane M).

Bill lines have a `kind`: 'charge' (one tap from the Admin list of standard charges),
'medicine' (added by the front desk's "Bought here" — see `sync_medicine_line`) or 'other'
(typed by hand). Every line is counted under a day-book column (`account_head_key`, see
`line_head`).

Money comes in as payments (`BillPayment`): a bill may be paid in parts and in different modes
(₹500 cash now, ₹60 UPI next week). balance = total − payments. The first payment gives the bill its
receipt number. Two older fields are kept in step for older readers (`settle`):
  - `Bill.paid_at` = when the balance reached 0 (None while money is owed);
  - `Bill.payment_mode` = the mode of the latest payment. PAYMENT_MODES has no "mixed", so a bill
    paid partly in cash and partly by UPI reads as its last mode; `payments` has the split.
A ₹0 bill (free follow-up) owes nothing; reception closes it with "No charge" (`close_no_charge`),
which sets `paid_at` with no payment and no receipt number.
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, object_session

from app.config import settings
from app.db import utcnow
from app.models.audit import AuditLog
from app.models.billing import PAYMENT_MODES, AccountHead, Bill, BillItem, BillPayment, StandardCharge
from app.models.config import ClinicSetting
from app.models.patients import Visit
from app.models.pharmacy import PrescriptionLine
from app.models.staff import Staff
from app.schemas.billing import BillItemIn, BillItemOut, BillOut, OwedBill, PaymentOut
from app.schemas.daybook import DayBookSettings
from app.services import fees

RECEIPT_PREFIX = "GK"
RECEIPT_RETRIES = 5
DAYBOOK_SETTINGS_KEY = "daybook"


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


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)  # SQLite drops tzinfo


# --------------------------------------------------------------------------- day-book columns on lines
def daybook_settings(db: Session) -> DayBookSettings:
    """ClinicSetting "daybook": the column medicines / hand-typed lines / OT payments go under."""
    row = db.get(ClinicSetting, DAYBOOK_SETTINGS_KEY)
    try:
        return DayBookSettings.model_validate(row.value if row is not None and row.value else {})
    except ValueError:  # a hand-edited row went bad — fall back to the defaults
        return DayBookSettings()


def check_head(db: Session, key: str | None) -> str | None:
    """None / "" = none picked. Otherwise the key of an existing column (else BadValue)."""
    if not key:
        return None
    if db.scalar(select(AccountHead).filter_by(key=key)) is None:
        raise BadValue(f"Unknown day-book column '{key}'")
    return key


def line_head(db: Session, item: BillItem, cfg: DayBookSettings | None = None) -> str:
    """The day-book column a bill line is counted under: its own (stored when saved), else its
    standard charge's, else the settings' medicine column for "Bought here" lines and the "other"
    column for anything typed by hand (older lines saved before columns existed)."""
    if item.account_head_key:
        return item.account_head_key
    if item.standard_charge_id is not None:
        charge = db.get(StandardCharge, item.standard_charge_id)
        if charge is not None and charge.account_head_key:
            return charge.account_head_key
    cfg = cfg or daybook_settings(db)
    return cfg.medicine_head if item.kind == "medicine" else cfg.other_head


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


def create_standard_charge(db: Session, label: str, amount: int, by, amount_both_eyes: int | None = None,
                           group_label: str = "", account_head_key: str | None = None) -> StandardCharge:
    label = _charge_label(db, label)
    head = check_head(db, account_head_key)
    order = (db.scalar(select(func.max(StandardCharge.sort_order))) or 0) + 1
    row = StandardCharge(label=label, amount=amount, amount_both_eyes=amount_both_eyes,
                         group_label=" ".join((group_label or "").split()), account_head_key=head,
                         active=True, sort_order=order)
    db.add(row)
    db.flush()
    _audit(db, by, "standard_charge.create", "standard_charge", row.id, label=label, amount=amount,
           amount_both_eyes=amount_both_eyes, group_label=row.group_label, account_head_key=head)
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
    if "amount_both_eyes" in values and values["amount_both_eyes"] != row.amount_both_eyes:  # null clears
        row.amount_both_eyes = changed["amount_both_eyes"] = values["amount_both_eyes"]
    if values.get("group_label") is not None:
        group = " ".join(values["group_label"].split())
        if group != (row.group_label or ""):
            row.group_label = changed["group_label"] = group
    if values.get("account_head_key") is not None:
        head = check_head(db, values["account_head_key"])
        if head != row.account_head_key:
            row.account_head_key = changed["account_head_key"] = head
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
def _bill_for(db: Session, visit: Visit, suggest: bool = False) -> Bill:
    """The visit's bill, created if missing. `suggest`: a new bill starts with the visit's fee
    (from its visit kind) and the emergency fee when flagged — see app.services.fees."""
    bill = visit.bill
    if bill is None:
        bill = Bill(visit_id=visit.id)
        db.add(bill)
        visit.bill = bill
        if suggest:
            bill.items.extend(fees.suggested_items(db, visit))
    return bill


def start_bill(db: Session, visit: Visit) -> Bill:
    """`POST /visits/{id}/bill/start`: the billing panel opens a visit with no bill yet — create it
    with the suggested fee lines already on it. A bill that exists is returned untouched (reception
    may have removed the suggestion on purpose)."""
    if visit.bill is not None:
        return visit.bill
    bill = _bill_for(db, visit, suggest=True)
    db.commit()
    db.refresh(bill)
    return bill


def _item(it: BillItemIn | tuple) -> BillItem:
    if isinstance(it, tuple):  # (label, amount) — older callers
        label, amount = it
        return BillItem(label=label, amount=amount, kind="other", qty=1)
    return BillItem(label=it.label.strip(), amount=it.amount, kind=it.kind, qty=it.qty, eyes=it.eyes,
                    standard_charge_id=it.standard_charge_id, prescription_line_id=it.prescription_line_id,
                    account_head_key=it.account_head_key or None)


def upsert_bill(db: Session, visit: Visit, items: list, payment_mode: str | None) -> Bill:
    """`addBillItem`/`removeBillItem`/`selectPaymentMode`: replace the visit's bill items. Every line
    is stored with its day-book column. Payments stay: the balance is worked out again (a paid bill
    whose lines grew owes the difference)."""
    if payment_mode is not None and payment_mode not in PAYMENT_MODES:
        raise BadValue(f"paymentMode must be one of {PAYMENT_MODES}")
    new_items = [_item(it) for it in items]
    cfg = daybook_settings(db)
    for it in new_items:
        if it.standard_charge_id is not None and db.get(StandardCharge, it.standard_charge_id) is None:
            raise BadValue(f"Unknown standardChargeId {it.standard_charge_id}")
        if it.prescription_line_id is not None and db.get(PrescriptionLine, it.prescription_line_id) is None:
            it.prescription_line_id = None  # the prescription changed under us; keep the line as typed
        check_head(db, it.account_head_key)
        it.account_head_key = line_head(db, it, cfg)
    bill = _bill_for(db, visit)
    for old in list(bill.items):
        db.delete(old)
    bill.items = new_items
    if payment_mode is not None and not bill.payments:
        bill.payment_mode = payment_mode  # a planned mode; once money came in, payments decide it
    settle(bill)
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


# --------------------------------------------------------------------------- money on a bill
def bill_total(bill: Bill) -> int:
    return sum(i.amount for i in bill.items)


def paid_amount(bill: Bill) -> int:
    return sum(p.amount for p in bill.payments)


def bill_balance(bill: Bill) -> int:
    return bill_total(bill) - paid_amount(bill)


def bill_status(bill: Bill) -> str:
    """unpaid | part_paid | paid | no_charge | overpaid."""
    total, paid = bill_total(bill), paid_amount(bill)
    if total == 0 and paid == 0:
        return "no_charge" if bill.paid_at is not None else "unpaid"
    if paid > total:
        return "overpaid"
    if paid == total:
        return "paid"
    return "part_paid" if paid > 0 else "unpaid"


def settle(bill: Bill) -> None:
    """Keep `paid_at` / `payment_mode` in step with the payments (see the module doc). No commit."""
    total, paid = bill_total(bill), paid_amount(bill)
    if bill.payments:
        bill.payment_mode = bill.payments[-1].mode
    if paid > 0 and paid >= total:
        if bill.paid_at is None:
            bill.paid_at = max((_aware(p.at) for p in bill.payments if p.at is not None), default=None) or utcnow()
    elif total > 0 or paid > 0:
        bill.paid_at = None  # money owed again (a line added after paying, or a payment undone)
    # total == 0 and nothing paid: an open ₹0 bill stays open; one closed as "No charge" stays closed


def add_payment(db: Session, bill: Bill, amount: int, mode: str, by, note: str = "") -> Bill:
    """Money received against the bill: any amount up to the balance, in one mode. The first payment
    gives the bill its receipt number."""
    if mode not in PAYMENT_MODES:
        raise BadValue(f"mode must be one of {PAYMENT_MODES}")
    if amount <= 0:
        raise BadValue("The amount must be more than ₹0")
    for attempt in range(RECEIPT_RETRIES):
        balance = bill_balance(bill)
        if balance <= 0:
            raise Conflict("Nothing is owed on this bill")
        if amount > balance:
            raise BadValue(f"₹{amount} is more than the ₹{balance} still owed")
        at = utcnow()
        payment = BillPayment(amount=amount, mode=mode, at=at, by_staff_id=_staff_id(by),
                              note=(note or "").strip())
        bill.payments.append(payment)
        settle(bill)
        if not bill.receipt_no:
            bill.receipt_no = next_receipt_no(db, _clinic_year(at))
        try:
            db.flush()
            _audit(db, by, "bill.payment", "bill", bill.id, payment_id=payment.id, visit_id=bill.visit_id,
                   amount=amount, mode=mode, balance=bill_balance(bill))
            db.commit()
            return bill
        except IntegrityError:  # two desks took the same receipt number at once — try the next one
            db.rollback()
            if attempt == RECEIPT_RETRIES - 1:
                raise
    return bill


def get_payment(bill: Bill, payment_id: int) -> BillPayment:
    payment = next((p for p in bill.payments if p.id == payment_id), None)
    if payment is None:
        raise NotFound("Payment not found")
    return payment


def remove_payment(db: Session, bill: Bill, payment: BillPayment, by) -> Bill:
    """Undo a payment entered by mistake. The receipt number stays with the bill (numbers are
    never handed out twice)."""
    _audit(db, by, "bill.payment_undo", "bill", bill.id, payment_id=payment.id, visit_id=bill.visit_id,
           amount=payment.amount, mode=payment.mode, at=_aware(payment.at).isoformat() if payment.at else None)
    bill.payments.remove(payment)
    db.delete(payment)
    settle(bill)
    db.commit()
    db.refresh(bill)
    return bill


def close_no_charge(db: Session, visit: Visit, by) -> Bill:
    """A ₹0 bill (free follow-up): close it as "No charge" so it is done and never owing."""
    bill = _bill_for(db, visit, suggest=True)
    total = bill_total(bill)
    if total > 0:
        raise Conflict(f"This bill is ₹{total} — receive the payment instead")
    if bill.paid_at is None:
        bill.paid_at = utcnow()
        db.flush()
        _audit(db, by, "bill.no_charge", "bill", bill.id, visit_id=visit.id)
    db.commit()
    db.refresh(bill)
    return bill


def pay_bill(db: Session, bill: Bill, payment_mode: str, by=None) -> Bill:
    """`POST /bill/pay` (older callers, and the one-tap mode buttons): receive the whole balance in
    this mode. A ₹0 bill is closed as "No charge". A bill already paid in full keeps its payments;
    tapping another mode then corrects the mode of its latest payment (the old "switched from cash
    to UPI" fix)."""
    if payment_mode not in PAYMENT_MODES:
        raise BadValue(f"paymentMode must be one of {PAYMENT_MODES}")
    balance = bill_balance(bill)
    if balance > 0:
        return add_payment(db, bill, balance, payment_mode, by)
    if not bill.payments:  # ₹0 bill
        return close_no_charge(db, bill.visit, by)
    last = bill.payments[-1]
    if last.mode != payment_mode:
        _audit(db, by, "bill.payment_mode", "bill", bill.id, payment_id=last.id, old=last.mode, new=payment_mode)
        last.mode = payment_mode
        settle(bill)
    db.commit()
    return bill


def owed_bills(db: Session, patient_id: int | None = None, on_or_before=None) -> list[Bill]:
    """Bills with money still to collect (balance > 0), oldest visit first. Only bills not settled
    (`paid_at` is None) can owe, so the scan stays small."""
    stmt = select(Bill).join(Visit, Bill.visit_id == Visit.id).where(Bill.paid_at.is_(None))
    if patient_id is not None:
        stmt = stmt.where(Visit.patient_id == patient_id)
    if on_or_before is not None:
        stmt = stmt.where(Visit.date <= on_or_before)
    rows = [b for b in db.scalars(stmt.order_by(Visit.date, Visit.id)) if bill_balance(b) > 0]
    return rows


def owed_out(bill: Bill) -> OwedBill:
    v = bill.visit
    return OwedBill(visit_id=bill.visit_id, patient_id=v.patient_id, name=v.patient.name, token=v.token,
                    visit_date=v.date, total=bill_total(bill), paid_amount=paid_amount(bill),
                    balance=bill_balance(bill))


def _staff_names(db: Session, ids: set[int | None]) -> dict[int, str]:
    ids = {i for i in ids if i is not None}
    if not ids:
        return {}
    return {i: n for i, n in db.execute(select(Staff.id, Staff.name).where(Staff.id.in_(ids)))}


def payments_out(db: Session, payments: list[BillPayment]) -> list[PaymentOut]:
    names = _staff_names(db, {p.by_staff_id for p in payments})
    return [PaymentOut(id=p.id, amount=p.amount, mode=p.mode, at=_aware(p.at), by_name=names.get(p.by_staff_id),
                       note=p.note or "") for p in payments]


def bill_out(bill: Bill) -> BillOut:
    visit = bill.visit
    patient = visit.patient if visit is not None else None
    db = object_session(bill)
    rules = fees.get_rules(db)
    kind_ids, emergency_id = fees.fee_charge_ids(db, rules)
    fee_ids = kind_ids | ({emergency_id} if emergency_id is not None else set())
    cfg = daybook_settings(db)
    items = [BillItemOut(id=i.id, label=i.label, amount=i.amount, kind=i.kind or "other", qty=i.qty or 1,
                         standard_charge_id=i.standard_charge_id, prescription_line_id=i.prescription_line_id,
                         price_missing=(i.kind == "medicine" and i.amount == 0), eyes=i.eyes,
                         suggested=(i.kind == "charge" and i.standard_charge_id in fee_ids),
                         account_head_key=line_head(db, i, cfg))
             for i in bill.items]
    kind = fees.visit_kinds_by_key(db).get(visit.visit_kind_key or "") if visit is not None else None
    status = bill_status(bill)
    return BillOut(id=bill.id, visit_id=bill.visit_id, items=items, total=bill_total(bill),
                   payment_mode=bill.payment_mode, paid_at=bill.paid_at,
                   paid=status in ("paid", "no_charge", "overpaid"),
                   receipt_no=bill.receipt_no, payments=payments_out(db, list(bill.payments)),
                   paid_amount=paid_amount(bill), balance=bill_balance(bill), status=status,
                   patient_id=visit.patient_id if visit else None,
                   patient_name=patient.name if patient else None,
                   token=visit.token if visit else None, visit_date=visit.date if visit else None,
                   visit_kind_key=visit.visit_kind_key if visit else None,
                   visit_kind_label=kind.label if kind else None, emergency=bool(visit and visit.emergency),
                   fee_note=fees.fee_note(db, visit, rules) if visit is not None else "")


# --------------------------------------------------------------------------- "Bought here" lines
def medicine_label(name: str, qty: int) -> str:
    return f"{name} × {qty}"[:120]


def sync_medicine_line(db: Session, visit: Visit, line: PrescriptionLine) -> BillItem:
    """"Bought here": put the medicine on the visit's bill (or refresh the line already there).
    Amount = qty × the medicine's price; 0 when Admin has not priced it yet, so the panel asks
    reception to type it. Never commits — the caller's transaction does."""
    bill = _bill_for(db, visit, suggest=True)
    price = line.medicine.price if line.medicine is not None else None
    amount = line.dispensed_qty * price if price is not None else 0
    item = next((i for i in bill.items if i.prescription_line_id == line.id), None)
    if item is None:
        item = BillItem(kind="medicine", prescription_line_id=line.id, label="", amount=0, qty=1,
                        account_head_key=daybook_settings(db).medicine_head)
        bill.items.append(item)
    item.kind = "medicine"
    item.qty = line.dispensed_qty
    item.label = medicine_label(line.name, line.dispensed_qty)
    item.amount = amount
    settle(bill)
    return item


def drop_medicine_line(db: Session, visit: Visit, line_id: int) -> None:
    """Undo of "Bought here": take the medicine off the bill. Never commits."""
    bill = visit.bill
    if bill is None:
        return
    for item in [i for i in bill.items if i.prescription_line_id == line_id]:
        bill.items.remove(item)
        db.delete(item)
    settle(bill)


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
    if pending and visit.bill is not None:
        settle(visit.bill)
