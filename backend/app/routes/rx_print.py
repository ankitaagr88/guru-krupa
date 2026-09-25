"""Printed-prescription extras (lane R owns this module): a visit's examination findings and glasses
prescription, the lists behind them and the print settings. Shapes: `app.schemas.rx_print`.

Visit (read: any staff; write: doctor or admin):
  GET  /visits/{id}/exam-glasses     {visitId, exam:[{key,label,r,l}], glasses|null, fromReading|null, va:{r,l}}
  PUT  /visits/{id}/exam-glasses     {exam:[{key,r,l}], glasses|null} -> same as GET (values tidied)
Lists (any staff):
  GET  /rx-print/lists               {examFindings:[...], lensTypes:[...]} switched-on rows, in order
  GET  /rx-print/settings            {doctorName, degrees, regNo, footerNote:{english,hindi,gujarati}}
Admin only:
  PUT    /admin/rx-print/settings
  GET    /admin/exam-findings        all rows (switched-off too);  POST, PUT /order, PATCH /{key}
  GET    /admin/lens-types           all rows (switched-off too);  POST, PUT /order, PATCH /{key}
Rows are switched off rather than deleted: old visits keep printing them.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.roles import ADMIN_ONLY, DOCTOR_ONLY
from app.db import get_db
from app.models.config import ExamFinding, LensType
from app.models.patients import Visit
from app.models.staff import Staff
from app.routes import register
from app.schemas.rx_print import (ExamFindingIn, ExamFindingOut, ExamFindingPatch, ExamGlassesIn, ExamGlassesOut,
                                  KeyOrder, LensTypeIn, LensTypeOut, LensTypePatch, RxListsOut, RxPrintSettings)
from app.services import rx_print as svc
from app.services.admin import AdminError, BadValue, Conflict, NotFound

router = register(APIRouter(tags=["rx_print"], dependencies=[Depends(get_current_user)]))

admin_user = Depends(require_role(*ADMIN_ONLY))
WRITERS = tuple(dict.fromkeys(ADMIN_ONLY + DOCTOR_ONLY))


def _http(exc: AdminError) -> HTTPException:
    code = {NotFound: status.HTTP_404_NOT_FOUND, Conflict: status.HTTP_409_CONFLICT,
            BadValue: status.HTTP_422_UNPROCESSABLE_ENTITY}.get(type(exc), status.HTTP_400_BAD_REQUEST)
    return HTTPException(code, str(exc))


def _visit(db: Session, visit_id: int) -> Visit:
    visit = db.get(Visit, visit_id)
    if visit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Visit not found")
    return visit


# --------------------------------------------------------------------------- per visit
@router.get("/visits/{visit_id}/exam-glasses", response_model=ExamGlassesOut)
def get_exam_glasses(visit_id: int, db: Session = Depends(get_db)):
    return svc.exam_glasses_out(db, _visit(db, visit_id))


@router.put("/visits/{visit_id}/exam-glasses", response_model=ExamGlassesOut)
def put_exam_glasses(visit_id: int, data: ExamGlassesIn, db: Session = Depends(get_db),
                     user: Staff = Depends(require_role(*WRITERS))):
    visit = _visit(db, visit_id)
    try:
        svc.save_exam_glasses(db, visit, data.exam, data.glasses, user)
    except AdminError as exc:
        db.rollback()
        raise _http(exc)
    return svc.exam_glasses_out(db, visit)


# --------------------------------------------------------------------------- lists + settings
@router.get("/rx-print/lists", response_model=RxListsOut)
def lists(db: Session = Depends(get_db)):
    return RxListsOut(exam_findings=svc.exam_findings(db), lens_types=svc.lens_types(db))


@router.get("/rx-print/settings", response_model=RxPrintSettings)
def get_settings(db: Session = Depends(get_db)):
    return svc.get_settings(db)


@router.put("/admin/rx-print/settings", response_model=RxPrintSettings)
def put_settings(data: RxPrintSettings, db: Session = Depends(get_db), user: Staff = admin_user):
    return svc.save_settings(db, data, user)


# --------------------------------------------------------------------------- admin: exam findings
@router.get("/admin/exam-findings", response_model=list[ExamFindingOut])
def admin_exam_findings(db: Session = Depends(get_db), user: Staff = admin_user):
    return svc.exam_findings(db, include_inactive=True)


@router.post("/admin/exam-findings", response_model=ExamFindingOut, status_code=status.HTTP_201_CREATED)
def create_exam_finding(data: ExamFindingIn, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.create_row(db, ExamFinding, label=data.label, key=data.key, by=user, what="An exam finding",
                              entity="exam_finding", default_value=data.default_value.strip())
    except AdminError as exc:
        raise _http(exc)


@router.put("/admin/exam-findings/order", response_model=list[ExamFindingOut])
def reorder_exam_findings(data: KeyOrder, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.reorder_rows(db, ExamFinding, data.keys, user, "exam_finding")
    except AdminError as exc:
        raise _http(exc)


@router.patch("/admin/exam-findings/{key}", response_model=ExamFindingOut)
def patch_exam_finding(key: str, data: ExamFindingPatch, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        row = svc.get_row(db, ExamFinding, key, "Exam finding")
        return svc.update_row(db, row, data.model_dump(exclude_unset=True), user, "An exam finding", "exam_finding")
    except AdminError as exc:
        raise _http(exc)


# --------------------------------------------------------------------------- admin: lens types
@router.get("/admin/lens-types", response_model=list[LensTypeOut])
def admin_lens_types(db: Session = Depends(get_db), user: Staff = admin_user):
    return svc.lens_types(db, include_inactive=True)


@router.post("/admin/lens-types", response_model=LensTypeOut, status_code=status.HTTP_201_CREATED)
def create_lens_type(data: LensTypeIn, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.create_row(db, LensType, label=data.label, key=data.key, by=user, what="A lens type",
                              entity="lens_type")
    except AdminError as exc:
        raise _http(exc)


@router.put("/admin/lens-types/order", response_model=list[LensTypeOut])
def reorder_lens_types(data: KeyOrder, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.reorder_rows(db, LensType, data.keys, user, "lens_type")
    except AdminError as exc:
        raise _http(exc)


@router.patch("/admin/lens-types/{key}", response_model=LensTypeOut)
def patch_lens_type(key: str, data: LensTypePatch, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        row = svc.get_row(db, LensType, key, "Lens type")
        return svc.update_row(db, row, data.model_dump(exclude_unset=True), user, "A lens type", "lens_type")
    except AdminError as exc:
        raise _http(exc)
