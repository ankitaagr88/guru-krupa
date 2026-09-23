from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.models.staff import Staff
from app.db import get_db
from app.models.patients import Patient
from app.routes import register
from app.schemas.history import PatientHistoryOut
from app.schemas.patients import PatientDetail, PatientIn, PatientOut, PatientPatch, check_dob
from app.services import patients as svc
from app.services.admin import AdminError, BadValue, NotFound
from app.services.queue import today

router = register(APIRouter(prefix="/patients", tags=["patients"], dependencies=[Depends(get_current_user)]))


def _get(db: Session, patient_id: int) -> Patient:
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    return patient


def _referral_422(exc: svc.UnknownReferralSource):
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown referralSource '{exc}'")


def _check_dob(data: PatientIn | PatientPatch) -> None:
    """422 with a plain sentence (not pydantic's error list) for a DOB in the future or >120 years back."""
    try:
        check_dob(data.dob)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@router.post("", response_model=PatientOut, status_code=status.HTTP_201_CREATED)
def create_patient(data: PatientIn, db: Session = Depends(get_db), user: Staff = Depends(get_current_user)):
    """With `familyOwnerId` (+ `relationKey`) the new patient joins that family ("Add as a family member")."""
    _check_dob(data)
    try:
        patient = svc.create_patient(db, data, by=user)
    except svc.UnknownReferralSource as exc:
        raise _referral_422(exc)
    except AdminError as exc:
        code = {NotFound: status.HTTP_404_NOT_FOUND, BadValue: status.HTTP_422_UNPROCESSABLE_ENTITY}.get(
            type(exc), status.HTTP_409_CONFLICT)
        raise HTTPException(code, str(exc))
    return svc.patients_out(db, [patient], today())[0]


@router.get("", response_model=list[PatientOut])
def search_patients(q: str = Query("", max_length=120), db: Session = Depends(get_db)):
    return svc.patients_out(db, svc.search_patients(db, q), today())


@router.get("/by-phone", response_model=list[PatientOut])
def patients_by_phone(phone: str = Query("", max_length=30), db: Session = Depends(get_db)):
    """Already registered with this number? (New-patient duplicate check; compares the last 10 digits.)"""
    return svc.patients_out(db, svc.patients_by_phone(db, phone), today())


@router.get("/{patient_id}", response_model=PatientDetail)
def get_patient(patient_id: int, db: Session = Depends(get_db)):
    return svc.patient_detail(db, _get(db, patient_id), today())


@router.get("/{patient_id}/history", response_model=PatientHistoryOut)
def get_patient_history(patient_id: int, db: Session = Depends(get_db)):
    """The patient screen: details + every visit (readings, prescription, bill, photos), surgeries, appointments."""
    return svc.patient_history(db, _get(db, patient_id), today())


@router.patch("/{patient_id}", response_model=PatientOut)
def patch_patient(patient_id: int, data: PatientPatch, db: Session = Depends(get_db)):
    patient = _get(db, patient_id)
    _check_dob(data)
    try:
        followed = svc.update_patient(db, patient, data)
    except svc.UnknownReferralSource as exc:
        raise _referral_422(exc)
    out = svc.patients_out(db, [patient], today())[0]
    out.family_phone_updated = followed  # the owner's new number went to this many family members too
    return out
