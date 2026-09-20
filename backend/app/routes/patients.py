from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.models.patients import Patient
from app.routes import register
from app.schemas.history import PatientHistoryOut
from app.schemas.patients import PatientDetail, PatientIn, PatientOut, PatientPatch
from app.services import patients as svc
from app.services.queue import today

router = register(APIRouter(prefix="/patients", tags=["patients"], dependencies=[Depends(get_current_user)]))


def _get(db: Session, patient_id: int) -> Patient:
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    return patient


def _referral_422(exc: svc.UnknownReferralSource):
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown referralSource '{exc}'")


@router.post("", response_model=PatientOut, status_code=status.HTTP_201_CREATED)
def create_patient(data: PatientIn, db: Session = Depends(get_db)):
    try:
        return svc.patient_out(svc.create_patient(db, data))
    except svc.UnknownReferralSource as exc:
        raise _referral_422(exc)


@router.get("", response_model=list[PatientOut])
def search_patients(q: str = Query("", max_length=120), db: Session = Depends(get_db)):
    return svc.patients_out(db, svc.search_patients(db, q), today())


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
    try:
        svc.update_patient(db, patient, data)
    except svc.UnknownReferralSource as exc:
        raise _referral_422(exc)
    return svc.patients_out(db, [patient], today())[0]
