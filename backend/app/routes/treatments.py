"""Diagnoses + treatment standards (B15/F17).

Reads for any staff (the prescription screen needs them); writes admin-only.
  GET  /diagnoses                       active list (?includeInactive=1 for Admin)
  GET  /diagnoses/{id}/standard         what auto-fills: admin standard, else history-derived
  POST /admin/diagnoses  PATCH/DELETE /admin/diagnoses/{id}  PUT /admin/diagnoses/order
  PUT  /admin/diagnoses/{id}/standard   save Dr Anu's standard   DELETE ... revert to history
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.roles import ADMIN_ONLY
from app.db import get_db
from app.models.staff import Staff
from app.routes import register
from app.schemas.admin import IdOrder
from app.schemas.treatments import DiagnosisIn, DiagnosisOut, DiagnosisPatch, StandardIn, StandardOut
from app.services import treatments as svc

router = register(APIRouter(tags=["treatments"], dependencies=[Depends(get_current_user)]))
admin_router = register(APIRouter(prefix="/admin", tags=["treatments"], dependencies=[Depends(get_current_user)]))
admin_user = Depends(require_role(*ADMIN_ONLY))


def _http(exc: svc.BadValue | svc.Conflict | svc.NotFound) -> HTTPException:
    code = {svc.NotFound: status.HTTP_404_NOT_FOUND, svc.Conflict: status.HTTP_409_CONFLICT,
            svc.BadValue: status.HTTP_422_UNPROCESSABLE_ENTITY}.get(type(exc), status.HTTP_400_BAD_REQUEST)
    return HTTPException(code, str(exc))


def _diag(db: Session, diagnosis_id: int):
    try:
        return svc.get_diagnosis(db, diagnosis_id)
    except svc.NotFound as exc:
        raise _http(exc) from exc


@router.get("/diagnoses", response_model=list[DiagnosisOut])
def list_diagnoses(include_inactive: bool = Query(False, alias="includeInactive"), db: Session = Depends(get_db)):
    return svc.diagnoses(db, include_inactive)


@router.get("/diagnoses/{diagnosis_id}/standard", response_model=StandardOut)
def get_standard(diagnosis_id: int, db: Session = Depends(get_db)):
    return svc.standard(db, _diag(db, diagnosis_id))


@admin_router.post("/diagnoses", response_model=DiagnosisOut, status_code=status.HTTP_201_CREATED)
def create_diagnosis(data: DiagnosisIn, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.create_diagnosis(db, data.name, user)
    except (svc.BadValue, svc.Conflict) as exc:
        raise _http(exc) from exc


@admin_router.put("/diagnoses/order", response_model=list[DiagnosisOut])
def reorder_diagnoses(data: IdOrder, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.reorder_diagnoses(db, data.ids, user)
    except svc.BadValue as exc:
        raise _http(exc) from exc


@admin_router.patch("/diagnoses/{diagnosis_id}", response_model=DiagnosisOut)
def patch_diagnosis(diagnosis_id: int, data: DiagnosisPatch, db: Session = Depends(get_db),
                    user: Staff = admin_user):
    try:
        return svc.update_diagnosis(db, _diag(db, diagnosis_id), data.model_dump(exclude_unset=True), user)
    except (svc.BadValue, svc.Conflict) as exc:
        raise _http(exc) from exc


@admin_router.delete("/diagnoses/{diagnosis_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_diagnosis(diagnosis_id: int, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        svc.delete_diagnosis(db, _diag(db, diagnosis_id), user)
    except svc.Conflict as exc:
        raise _http(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@admin_router.put("/diagnoses/{diagnosis_id}/standard", response_model=StandardOut)
def save_standard(diagnosis_id: int, data: StandardIn, db: Session = Depends(get_db), user: Staff = admin_user):
    return svc.save_standard(db, _diag(db, diagnosis_id), data.lines, user)


@admin_router.delete("/diagnoses/{diagnosis_id}/standard", response_model=StandardOut)
def clear_standard(diagnosis_id: int, db: Session = Depends(get_db), user: Staff = admin_user):
    return svc.clear_standard(db, _diag(db, diagnosis_id), user)
