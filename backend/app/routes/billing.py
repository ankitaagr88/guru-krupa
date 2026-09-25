"""Per-visit bill (`/visits/{id}/bill`), standard charges, part payments and receipts (lane B;
payments: lane M).

Money: `POST /visits/{id}/bill/payments` {amount, mode, note?} receives part or all of the balance,
`DELETE /visits/{id}/bill/payments/{pid}` undoes one, `POST /visits/{id}/bill/pay` {paymentMode}
receives the whole balance, `POST /visits/{id}/bill/no-charge` closes a ₹0 bill, and
`GET /patients/{id}/owing` lists a patient's bills with money still to collect.

Standard charges: `GET /standard-charges` (any staff: the active ones, in order, for the one-tap
chips) and `/admin/standard-charges` (admin: list incl. switched-off, create, patch, delete —
409 once a bill uses it, so switch it off instead — and reorder).
"""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.roles import ADMIN_ONLY, ANY_STAFF
from app.db import get_db
from app.models.patients import Patient, Visit
from app.models.staff import Staff
from app.routes import register
from app.schemas.admin import IdOrder
from app.schemas.billing import (BillIn, BillOut, BillPayIn, OwedBill, PaymentIn, StandardChargeIn,
                                 StandardChargeOut, StandardChargePatch)
from app.services import billing as svc

router = register(APIRouter(tags=["billing"], dependencies=[Depends(get_current_user)]))

admin_user = Depends(require_role(*ADMIN_ONLY))


def _http(exc: svc.BillingError) -> HTTPException:
    code = {svc.NotFound: status.HTTP_404_NOT_FOUND, svc.Conflict: status.HTTP_409_CONFLICT,
            svc.BadValue: status.HTTP_422_UNPROCESSABLE_ENTITY}.get(type(exc), status.HTTP_400_BAD_REQUEST)
    return HTTPException(code, str(exc))


def _visit(db: Session, visit_id: int) -> Visit:
    visit = db.get(Visit, visit_id)
    if visit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Visit not found")
    return visit


# --------------------------------------------------------------------------- bill
@router.get("/visits/{visit_id}/bill", response_model=BillOut)
def get_bill(visit_id: int, db: Session = Depends(get_db)):
    visit = _visit(db, visit_id)
    if visit.bill is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No bill for this visit")
    return svc.bill_out(visit.bill)


@router.put("/visits/{visit_id}/bill", response_model=BillOut)
def put_bill(visit_id: int, data: BillIn, db: Session = Depends(get_db),
             user: Staff = Depends(require_role(*ANY_STAFF))):
    """`renderBilling`: upsert — the items list replaces whatever was there."""
    visit = _visit(db, visit_id)
    try:
        bill = svc.upsert_bill(db, visit, data.items, data.payment_mode)
    except svc.BillingError as exc:
        raise _http(exc)
    return svc.bill_out(bill)


@router.post("/visits/{visit_id}/bill/start", response_model=BillOut)
def start_bill(visit_id: int, db: Session = Depends(get_db), user: Staff = Depends(require_role(*ANY_STAFF))):
    """The billing panel found no bill: create it with the visit's suggested fee lines (its visit
    kind's charge, and Emergency when flagged). An existing bill comes back unchanged."""
    return svc.bill_out(svc.start_bill(db, _visit(db, visit_id)))


def _bill(visit: Visit):
    if visit.bill is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No bill for this visit")
    return visit.bill


@router.post("/visits/{visit_id}/bill/pay", response_model=BillOut)
def pay_bill(visit_id: int, data: BillPayIn, db: Session = Depends(get_db),
             user: Staff = Depends(require_role(*ANY_STAFF))):
    """Receive the whole balance in one mode (older callers). The first payment gives the bill its
    receipt number (`receiptNo`); a ₹0 bill is closed as "No charge"; on a bill already paid in full,
    another mode corrects the mode of its latest payment."""
    bill = _bill(_visit(db, visit_id))
    try:
        return svc.bill_out(svc.pay_bill(db, bill, data.payment_mode, user))
    except svc.BillingError as exc:
        raise _http(exc)


@router.post("/visits/{visit_id}/bill/payments", response_model=BillOut, status_code=status.HTTP_201_CREATED)
def add_payment(visit_id: int, data: PaymentIn, db: Session = Depends(get_db),
                user: Staff = Depends(require_role(*ANY_STAFF))):
    """Receive part (or all) of the balance: {amount, mode, note?}. 422 when more than the balance,
    409 when nothing is owed."""
    bill = _bill(_visit(db, visit_id))
    try:
        return svc.bill_out(svc.add_payment(db, bill, data.amount, data.mode, user, data.note))
    except svc.BillingError as exc:
        raise _http(exc)


@router.delete("/visits/{visit_id}/bill/payments/{payment_id}", response_model=BillOut)
def remove_payment(visit_id: int, payment_id: int, db: Session = Depends(get_db),
                   user: Staff = Depends(require_role(*ANY_STAFF))):
    """Undo a payment entered by mistake (audited). The bill owes that amount again."""
    bill = _bill(_visit(db, visit_id))
    try:
        return svc.bill_out(svc.remove_payment(db, bill, svc.get_payment(bill, payment_id), user))
    except svc.BillingError as exc:
        raise _http(exc)


@router.post("/visits/{visit_id}/bill/no-charge", response_model=BillOut)
def no_charge(visit_id: int, db: Session = Depends(get_db), user: Staff = Depends(require_role(*ANY_STAFF))):
    """Close a ₹0 bill (free follow-up) as "No charge" — created if the visit has none yet. 409 when
    the bill has an amount."""
    try:
        return svc.bill_out(svc.close_no_charge(db, _visit(db, visit_id), user))
    except svc.BillingError as exc:
        raise _http(exc)


@router.get("/patients/{patient_id}/owing", response_model=list[OwedBill])
def patient_owing(patient_id: int, db: Session = Depends(get_db)):
    """The patient's bills with money still to collect, oldest first (patient page, billing drawer)."""
    if db.get(Patient, patient_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    return [svc.owed_out(b) for b in svc.owed_bills(db, patient_id=patient_id)]


# --------------------------------------------------------------------------- standard charges
@router.get("/standard-charges", response_model=list[StandardChargeOut])
def active_standard_charges(db: Session = Depends(get_db)):
    return svc.standard_charges(db, active_only=True)


@router.get("/admin/standard-charges", response_model=list[StandardChargeOut])
def list_standard_charges(db: Session = Depends(get_db), user: Staff = admin_user):
    return svc.standard_charges(db)


@router.post("/admin/standard-charges", response_model=StandardChargeOut, status_code=status.HTTP_201_CREATED)
def create_standard_charge(data: StandardChargeIn, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.create_standard_charge(db, data.label, data.amount, user, data.amount_both_eyes, data.group_label,
                                          data.account_head_key)
    except svc.BillingError as exc:
        raise _http(exc)


@router.put("/admin/standard-charges/order", response_model=list[StandardChargeOut])
def reorder_standard_charges(data: IdOrder, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.reorder_standard_charges(db, data.ids, user)
    except svc.BillingError as exc:
        raise _http(exc)


@router.patch("/admin/standard-charges/{charge_id}", response_model=StandardChargeOut)
def patch_standard_charge(charge_id: int, data: StandardChargePatch, db: Session = Depends(get_db),
                          user: Staff = admin_user):
    try:
        return svc.update_standard_charge(db, svc.get_standard_charge(db, charge_id),
                                          data.model_dump(exclude_unset=True), user)
    except svc.BillingError as exc:
        raise _http(exc)


@router.delete("/admin/standard-charges/{charge_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_standard_charge(charge_id: int, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        svc.delete_standard_charge(db, svc.get_standard_charge(db, charge_id), user)
    except svc.BillingError as exc:
        raise _http(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
