from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.roles import ANY_STAFF
from app.db import get_db
from app.models.patients import Patient, Visit
from app.models.staff import Staff
from app.routes import register
from app.schemas.visits import FollowUpIn, StageMove, VaIn, VisitCreate, VisitOut, VisitPatch
from app.services import doctor
from app.services import queue as svc

router = register(APIRouter(prefix="/visits", tags=["visits"], dependencies=[Depends(get_current_user)]))


def _get(db: Session, visit_id: int) -> Visit:
    visit = db.get(Visit, visit_id)
    if visit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Visit not found")
    return visit


def _out(db: Session, visit: Visit) -> VisitOut:
    return svc.visits_out(db, [visit])[0]


@router.post("", response_model=VisitOut, status_code=status.HTTP_201_CREATED)
def register_visit(data: VisitCreate, db: Session = Depends(get_db)):
    patient = db.get(Patient, data.patient_id)
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    try:
        visit = svc.register_visit(db, patient, note=data.note, elsewhere=data.elsewhere,
                                   elsewhere_note=data.elsewhere_note)
    except svc.ActiveVisitExists:
        raise HTTPException(status.HTTP_409_CONFLICT, "Patient already has an active visit today")
    return _out(db, visit)


@router.get("/today/counts")
def visits_today_counts(db: Session = Depends(get_db)) -> dict[str, int]:
    """Active visits per stage key for the rail badges (stages with 0 included)."""
    counts = {s.key: 0 for s in svc.stages(db)}
    for v in svc.todays_visits(db):
        counts[v.stage_key] = counts.get(v.stage_key, 0) + 1
    return counts


@router.get("/today", response_model=list[VisitOut])
def visits_today(stage: str | None = Query(None), db: Session = Depends(get_db)):
    return svc.visits_out(db, svc.todays_visits(db, stage))


@router.get("/{visit_id}", response_model=VisitOut)
def get_visit(visit_id: int, db: Session = Depends(get_db)):
    return _out(db, _get(db, visit_id))


@router.post("/{visit_id}/move", response_model=VisitOut)
def move_visit(visit_id: int, data: StageMove, db: Session = Depends(get_db),
               user: Staff = Depends(require_role(*ANY_STAFF))):
    visit = _get(db, visit_id)
    try:
        svc.move_stage(db, visit, data.stage, user)
    except svc.UnknownStage:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown stage '{data.stage}'")
    return _out(db, visit)


@router.post("/{visit_id}/complete", response_model=VisitOut)
def complete_visit(visit_id: int, db: Session = Depends(get_db), user: Staff = Depends(require_role(*ANY_STAFF))):
    visit = _get(db, visit_id)
    svc.complete_visit(db, visit, user)
    return _out(db, visit)


@router.patch("/{visit_id}/va", response_model=VisitOut)
def set_va(visit_id: int, data: VaIn, db: Session = Depends(get_db)):
    return _out(db, svc.set_va(db, _get(db, visit_id), data.R, data.L))


@router.patch("/{visit_id}", response_model=VisitOut)
def patch_visit(visit_id: int, data: VisitPatch, db: Session = Depends(get_db)):
    visit = _get(db, visit_id)
    values = data.model_dump(exclude_unset=True)
    if "diagnosis_id" in values:  # null clears it; the prescription's diagnosis follows
        try:
            doctor.set_diagnosis(db, visit, values.pop("diagnosis_id"))
        except doctor.UnknownDiagnosis:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown diagnosis")
    for k, v in values.items():
        if v is not None:
            setattr(visit, k, v)
    db.commit()
    return _out(db, visit)


@router.put("/{visit_id}/follow-up", response_model=VisitOut)
def set_follow_up(visit_id: int, data: FollowUpIn, db: Session = Depends(get_db),
                  _user: Staff = Depends(require_role(*ANY_STAFF))):
    """"Come back on…": stores the date and books (or moves) the patient's appointment for it."""
    try:
        return _out(db, doctor.set_follow_up(db, _get(db, visit_id), data.date, data.note))
    except doctor.BadFollowUp as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@router.delete("/{visit_id}/follow-up", response_model=VisitOut)
def clear_follow_up(visit_id: int, db: Session = Depends(get_db),
                    _user: Staff = Depends(require_role(*ANY_STAFF))):
    """"No follow-up": removes the booked appointment unless the patient already checked in on it."""
    return _out(db, doctor.clear_follow_up(db, _get(db, visit_id)))
