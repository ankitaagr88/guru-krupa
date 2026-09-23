"""Per-visit bill (`/visits/{id}/bill`), standard charges and receipts (lane B owns this module)."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.roles import ANY_STAFF
from app.db import get_db
from app.models.patients import Visit
from app.models.staff import Staff
from app.routes import register
from app.schemas.billing import BillIn, BillOut, BillPayIn
from app.services import billing as svc

router = register(APIRouter(tags=["billing"], dependencies=[Depends(get_current_user)]))


def _visit(db: Session, visit_id: int) -> Visit:
    visit = db.get(Visit, visit_id)
    if visit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Visit not found")
    return visit


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
        bill = svc.upsert_bill(db, visit, [(i.label, i.amount) for i in data.items], data.payment_mode)
    except svc.BadValue as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    return svc.bill_out(bill)


@router.post("/visits/{visit_id}/bill/pay", response_model=BillOut)
def pay_bill(visit_id: int, data: BillPayIn, db: Session = Depends(get_db),
             user: Staff = Depends(require_role(*ANY_STAFF))):
    visit = _visit(db, visit_id)
    if visit.bill is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No bill for this visit")
    try:
        return svc.bill_out(svc.pay_bill(db, visit.bill, data.payment_mode))
    except svc.BadValue as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
