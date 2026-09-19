from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.roles import FRONT_DESK
from app.db import get_db
from app.models.appointments import Appointment
from app.routes import register
from app.schemas.appointments import AppointmentIn, AppointmentOut, AppointmentPatch, CheckinOut, DayCount
from app.services import appointments as svc
from app.services import queue

router = register(APIRouter(prefix="/appointments", tags=["appointments"],
                            dependencies=[Depends(get_current_user)]))

front_desk = Depends(require_role(*FRONT_DESK))


def _get(db: Session, appointment_id: int) -> Appointment:
    appt = db.get(Appointment, appointment_id)
    if appt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Appointment not found")
    return appt


def _out(db: Session, appt: Appointment) -> AppointmentOut:
    return svc.appointments_out(db, [appt])[0]


def _translate(exc: svc.AppointmentError) -> HTTPException:
    if isinstance(exc, svc.PastDate):
        return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Appointment date must be today or later")
    if isinstance(exc, svc.BadChannel):
        return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown channel '{exc}'")
    if isinstance(exc, svc.UnknownPatient):
        return HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    if isinstance(exc, svc.AlreadyCheckedIn):
        return HTTPException(status.HTTP_409_CONFLICT, "Appointment already checked in")
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


@router.get("", response_model=list[AppointmentOut])
def list_appointments(date_: date | None = Query(None, alias="date"), db: Session = Depends(get_db)):
    return svc.appointments_out(db, svc.list_appointments(db, date_))


@router.get("/counts", response_model=dict[str, DayCount])
def appointment_counts(start: date = Query(..., alias="from"), end: date = Query(..., alias="to"),
                       db: Session = Depends(get_db)):
    try:
        return svc.counts(db, start, end)
    except svc.RangeTooLarge:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Range must be at most {svc.MAX_COUNT_DAYS} days")


@router.post("", response_model=AppointmentOut, status_code=status.HTTP_201_CREATED, dependencies=[front_desk])
def create_appointment(data: AppointmentIn, db: Session = Depends(get_db)):
    try:
        return _out(db, svc.create_appointment(db, data))
    except svc.AppointmentError as exc:
        raise _translate(exc)


@router.get("/{appointment_id}", response_model=AppointmentOut)
def get_appointment(appointment_id: int, db: Session = Depends(get_db)):
    return _out(db, _get(db, appointment_id))


@router.patch("/{appointment_id}", response_model=AppointmentOut, dependencies=[front_desk])
def patch_appointment(appointment_id: int, data: AppointmentPatch, db: Session = Depends(get_db)):
    appt = _get(db, appointment_id)
    try:
        return _out(db, svc.update_appointment(db, appt, data))
    except svc.AppointmentError as exc:
        db.rollback()
        raise _translate(exc)


@router.delete("/{appointment_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[front_desk])
def delete_appointment(appointment_id: int, db: Session = Depends(get_db)):
    try:
        svc.delete_appointment(db, _get(db, appointment_id))
    except svc.AppointmentError as exc:
        raise _translate(exc)


@router.post("/{appointment_id}/checkin", response_model=CheckinOut, dependencies=[front_desk])
def checkin_appointment(appointment_id: int, db: Session = Depends(get_db)):
    appt = _get(db, appointment_id)
    try:
        appt, visit = svc.checkin(db, appt)
    except queue.ActiveVisitExists:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Patient already has an active visit today")
    except svc.AppointmentError as exc:
        db.rollback()
        raise _translate(exc)
    return CheckinOut(appointment=_out(db, appt), visit=queue.visits_out(db, [visit])[0])
