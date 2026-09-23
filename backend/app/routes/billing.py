"""Per-visit bill (`/visits/{id}/bill`), standard charges and receipts (lane B owns this module).

Standard charges: `GET /standard-charges` (any staff: the active ones, in order, for the one-tap
chips) and `/admin/standard-charges` (admin: list incl. switched-off, create, patch, delete —
409 once a bill uses it, so switch it off instead — and reorder).
"""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.roles import ADMIN_ONLY, ANY_STAFF
from app.db import get_db
from app.models.patients import Visit
from app.models.staff import Staff
from app.routes import register
from app.schemas.admin import IdOrder
from app.schemas.billing import (BillIn, BillOut, BillPayIn, StandardChargeIn, StandardChargeOut,
                                 StandardChargePatch)
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


@router.post("/visits/{visit_id}/bill/pay", response_model=BillOut)
def pay_bill(visit_id: int, data: BillPayIn, db: Session = Depends(get_db),
             user: Staff = Depends(require_role(*ANY_STAFF))):
    """Mark paid; the first payment gives the bill its receipt number (`receiptNo`)."""
    visit = _visit(db, visit_id)
    if visit.bill is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No bill for this visit")
    try:
        return svc.bill_out(svc.pay_bill(db, visit.bill, data.payment_mode))
    except svc.BillingError as exc:
        raise _http(exc)


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
        return svc.create_standard_charge(db, data.label, data.amount, user)
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
