"""Medicines master list, per-visit prescription (+ print payload) and per-visit bill.

Paths are explicit (`/visits/{id}/prescription`, `/visits/{id}/bill`) so this module owns the
pharmacy/billing sub-resources of a visit without touching `app.routes.visits`.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.roles import ADMIN_ONLY, ANY_STAFF, DOCTOR_ONLY
from app.db import get_db
from app.models.patients import Visit
from app.models.staff import Staff
from app.routes import register
from app.schemas.pharmacy import (BillIn, BillOut, BillPayIn, MedicineOut, PrescriptionIn, PrescriptionOut,
                                  PrintPayload)
from app.services import pharmacy as svc

router = register(APIRouter(tags=["prescriptions"], dependencies=[Depends(get_current_user)]))

PRESCRIBERS = tuple(dict.fromkeys(ADMIN_ONLY + DOCTOR_ONLY))


def _visit(db: Session, visit_id: int) -> Visit:
    visit = db.get(Visit, visit_id)
    if visit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Visit not found")
    return visit


def _prescription(db: Session, visit_id: int):
    rx = svc.get_prescription(db, _visit(db, visit_id))
    if rx is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No prescription for this visit")
    return rx


@router.get("/medicines", response_model=list[MedicineOut])
def medicines(q: str = Query("", max_length=160), db: Session = Depends(get_db)):
    """`buildMedDatalist`: active master list; `q` matches name, brand or composition (brand hits first)."""
    labels = svc.form_labels(db)
    return [svc.medicine_out(m, labels) for m in svc.search_medicines(db, q)]


@router.post("/visits/{visit_id}/prescription", response_model=PrescriptionOut,
             status_code=status.HTTP_201_CREATED)
def save_prescription(visit_id: int, data: PrescriptionIn, db: Session = Depends(get_db),
                      user: Staff = Depends(require_role(*PRESCRIBERS))):
    visit = _visit(db, visit_id)
    try:
        rx, low = svc.save_prescription(db, visit, data.lines, data.print_language, user, data.diagnosis_id)
    except svc.InsufficientStock as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"Insufficient stock for '{exc.item_name}': {exc.available} available, "
                            f"{exc.needed} requested")
    except svc.BadValue as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    return svc.prescription_out(db, rx, low)


@router.get("/visits/{visit_id}/prescription", response_model=PrescriptionOut)
def get_prescription(visit_id: int, db: Session = Depends(get_db)):
    return svc.prescription_out(db, _prescription(db, visit_id))


@router.get("/visits/{visit_id}/prescription/print", response_model=PrintPayload)
def print_prescription(visit_id: int, lang: str | None = Query(None), db: Session = Depends(get_db)):
    """`openPrescriptionModal` + `setLanguage`: JSON the client renders as the printed sheet."""
    try:
        return svc.print_payload(db, _prescription(db, visit_id), lang)
    except svc.BadValue as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


# --------------------------------------------------------------------------- billing
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
