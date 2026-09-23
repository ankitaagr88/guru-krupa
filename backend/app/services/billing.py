"""Per-visit bill, standard charges and receipts (lane B owns this module)."""
from sqlalchemy.orm import Session

from app.db import utcnow
from app.models.billing import PAYMENT_MODES, Bill, BillItem
from app.models.patients import Visit
from app.schemas.billing import BillItemOut, BillOut


class BadValue(ValueError):
    pass


def upsert_bill(db: Session, visit: Visit, items: list[tuple[str, int]], payment_mode: str | None) -> Bill:
    """`addBillItem`/`removeBillItem`/`selectPaymentMode`: replace the visit's bill items."""
    if payment_mode is not None and payment_mode not in PAYMENT_MODES:
        raise BadValue(f"paymentMode must be one of {PAYMENT_MODES}")
    bill = visit.bill
    if bill is None:
        bill = Bill(visit_id=visit.id)
        db.add(bill)
    for old in list(bill.items):
        db.delete(old)
    bill.items = [BillItem(label=label, amount=amount) for label, amount in items]
    if payment_mode is not None:
        bill.payment_mode = payment_mode
    db.commit()
    db.refresh(bill)
    return bill


def pay_bill(db: Session, bill: Bill, payment_mode: str) -> Bill:
    if payment_mode not in PAYMENT_MODES:
        raise BadValue(f"paymentMode must be one of {PAYMENT_MODES}")
    bill.payment_mode = payment_mode
    bill.paid_at = utcnow()
    db.commit()
    return bill


def bill_out(bill: Bill) -> BillOut:
    return BillOut(id=bill.id, visit_id=bill.visit_id,
                   items=[BillItemOut(id=i.id, label=i.label, amount=i.amount) for i in bill.items],
                   total=sum(i.amount for i in bill.items), payment_mode=bill.payment_mode, paid_at=bill.paid_at,
                   paid=bill.paid_at is not None)
