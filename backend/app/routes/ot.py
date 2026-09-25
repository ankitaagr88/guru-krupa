"""OT / surgery API (B7): slot-based scheduling, nested section updates, consent photos, lens tiers."""
from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.roles import ADMIN_ONLY, CLINICAL, DOCTOR_ONLY
from app.db import get_db
from app.models.ot import OtCase, OtConsentPhoto
from app.models.staff import Staff
from app.routes import register
from app.schemas.ot import (LensTierOut, OtBiometryScanOut, OtCaseCreate, OtCaseOut, OtCasePatch, OtSlotOut,
                            OtStatusIn)
from app.services import ot as svc
from app.services.admin import BadValue

router = register(APIRouter(prefix="/ot", tags=["ot"], dependencies=[Depends(get_current_user)]))
lens_router = register(APIRouter(tags=["ot"], dependencies=[Depends(get_current_user)]))

MAX_IMAGE_BYTES = 15 * 1024 * 1024
OPERATIVE_ROLES = set(CLINICAL) | set(ADMIN_ONLY)
CANCEL_ROLES = set(ADMIN_ONLY) | set(DOCTOR_ONLY)


def _get(db: Session, case_id: int) -> OtCase:
    case = svc.get_case(db, case_id)
    if case is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OT case not found")
    return case


def _conflict(slot: str) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, f"Time slot '{slot}' is already booked on that date")


@lens_router.get("/lens-tiers", response_model=list[LensTierOut])
def list_lens_tiers(db: Session = Depends(get_db)):
    return svc.lens_tiers_out(db)


@router.get("/slots", response_model=list[OtSlotOut])
def list_slots(date_: date | None = Query(None, alias="date"), db: Session = Depends(get_db)):
    return svc.slots_on(db, date_)


@router.get("/counts", response_model=dict[str, int])
def case_counts(from_: date = Query(alias="from"), to: date = Query(alias="to"), db: Session = Depends(get_db)):
    if to < from_:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "'to' must not be before 'from'")
    return svc.counts_between(db, from_, to)


@router.get("/cases", response_model=list[OtCaseOut])
def list_cases(date_: date | None = Query(None, alias="date"),
               from_: date | None = Query(None, alias="from"), to: date | None = Query(None, alias="to"),
               db: Session = Depends(get_db)):
    if from_ or to:
        if not (from_ and to):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Both 'from' and 'to' are required for a range")
        if to < from_:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "'to' must not be before 'from'")
        return svc.cases_out(db, svc.cases_between(db, from_, to))
    return svc.cases_out(db, svc.cases_on(db, date_))


@router.post("/cases", response_model=OtCaseOut, status_code=status.HTTP_201_CREATED)
def create_case(data: OtCaseCreate, db: Session = Depends(get_db)):
    if data.patient_id is None and not (data.patient_name or "").strip():
        raise HTTPException(422, "patientId or patientName is required")
    try:
        case = svc.create_case(db, patient_id=data.patient_id, patient_name=data.patient_name, age=data.age,
                               sex=data.sex, on=data.date, time_slot=data.time_slot, procedure=data.procedure,
                               pre_op_biometry=data.pre_op_biometry)
    except svc.PatientNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    except svc.SlotConflict:
        raise _conflict(data.time_slot)
    return svc.case_out(db, case)


@router.get("/cases/{case_id}", response_model=OtCaseOut)
def get_case(case_id: int, db: Session = Depends(get_db)):
    return svc.case_out(db, _get(db, case_id))


@router.patch("/cases/{case_id}", response_model=OtCaseOut)
def patch_case(case_id: int, data: OtCasePatch, db: Session = Depends(get_db),
               user: Staff = Depends(get_current_user)):
    case = _get(db, case_id)
    values = data.model_dump(exclude_unset=True)
    if any(values.get(k) is not None for k in svc.CLINICAL_SECTIONS) and user.role not in OPERATIVE_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Operative / post-op notes need a clinical role")
    # Scalars sent as null are ignored (nothing on an OT case is nullable-by-request except age/sex).
    values = {k: v for k, v in values.items() if v is not None or k in ("age", "sex")}
    try:
        svc.update_case(db, case, values)
    except svc.SlotConflict as e:
        raise _conflict(str(e))
    except svc.UnknownLensTier as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown lens tier '{e}'")
    except BadValue as e:  # the OT team (billing.team): the message names the row
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    return svc.case_out(db, case)


@router.post("/cases/{case_id}/status", response_model=OtCaseOut)
def set_case_status(case_id: int, data: OtStatusIn, db: Session = Depends(get_db)):
    case = _get(db, case_id)
    try:
        svc.set_status(db, case, data.status)
    except svc.UnknownStatus:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown status '{data.status}'")
    except svc.SlotConflict as e:
        raise _conflict(str(e))
    return svc.case_out(db, case)


@router.delete("/cases/{case_id}", response_model=OtCaseOut)
def cancel_case(case_id: int, db: Session = Depends(get_db), user: Staff = Depends(require_role(*CANCEL_ROLES))):
    case = _get(db, case_id)
    svc.cancel_case(db, case)
    return svc.case_out(db, case)


@router.post("/cases/{case_id}/consent-photos", response_model=OtCaseOut, status_code=status.HTTP_201_CREATED)
async def upload_consent_photo(case_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    case = _get(db, case_id)
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Only image uploads are accepted")
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image too large")
    svc.add_consent_photo(db, case, data, file.filename, file.content_type)
    return svc.case_out(db, case)


@router.post("/cases/{case_id}/biometry/scan", response_model=OtBiometryScanOut,
             response_model_exclude_none=True)
async def scan_biometry(case_id: int, image: UploadFile = File(...), db: Session = Depends(get_db)):
    """Photo of the HBM-1 IOL / biometry report -> OCR (synchronous, one page) -> plausible values
    deep-merged into `preOpBiometry`; every extracted value is returned, `ok: false` ones unmerged."""
    case = _get(db, case_id)
    if not (image.content_type or "").startswith("image/"):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Only image uploads are accepted")
    data = await image.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image too large")
    try:
        case, values, conf = svc.scan_biometry(db, case, data, image.filename, image.content_type)
    except Exception as exc:  # noqa: BLE001 - unreadable file / OCR engine missing -> a clear 422
        raise HTTPException(422, f"Could not read the report: {type(exc).__name__}: {exc}"[:300])
    return OtBiometryScanOut(case=svc.case_out(db, case), values=values, confidence=conf)


@router.delete("/consent-photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_consent_photo(photo_id: int, db: Session = Depends(get_db)):
    photo = db.get(OtConsentPhoto, photo_id)
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Consent photo not found")
    svc.remove_consent_photo(db, photo)
    return None
