"""Machines / OCR (spec B6): machine list, scanned + manual readings, per-visit readings,
exam photos and the auth-protected upload file endpoint. Paths are explicit (no router prefix)
because the feature spans /machines, /readings, /visits/{id}/..., /exam-photos and /uploads."""
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.roles import ANY_STAFF
from app.config import settings
from app.db import get_db
from app.models.patients import ExamPhoto, Visit
from app.models.readings import Reading
from app.models.staff import Staff
from app.ocr.templates import MACHINES, Machine
from app.routes import register
from app.schemas.readings import (ExamPhotoOut, MachineOut, ManualReadingIn, ReadingApproveIn, ReadingOut,
                                  ReadingValuesPatch)
from app.services import readings as svc
from app.services import uploads

router = register(APIRouter(tags=["readings"], dependencies=[Depends(get_current_user)]))


def _visit(db: Session, visit_id: int) -> Visit:
    visit = db.get(Visit, visit_id)
    if visit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Visit not found")
    return visit


def _reading(db: Session, reading_id: int) -> Reading:
    reading = db.get(Reading, reading_id)
    if reading is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reading not found")
    return reading


def _machine(key: str) -> Machine:
    try:
        return svc.get_machine(key)
    except svc.UnknownMachine:
        raise HTTPException(422, f"Unknown machineKey '{key}'")


def _save(image: UploadFile) -> str:
    try:
        return uploads.save_upload(image)
    except uploads.UnsupportedType as exc:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                            f"Unsupported image type {exc}; use JPEG, PNG or WebP")
    except uploads.TooLarge:
        raise HTTPException(413, "Image larger than 25 MB")


# ---------------------------------------------------------------- machines

@router.get("/machines", response_model=list[MachineOut])
def list_machines():
    return [m.as_dict() for m in MACHINES.values()]


# ---------------------------------------------------------------- readings

@router.post("/readings", response_model=ReadingOut, status_code=status.HTTP_202_ACCEPTED,
             response_model_exclude_none=True)
def upload_reading(background: BackgroundTasks, response: Response,
                   visit_id: int = Form(alias="visitId"), machine_key: str = Form(alias="machineKey"),
                   image: UploadFile = File(...),
                   client_captured_at: datetime | None = Form(None, alias="clientCapturedAt"),
                   client_uuid: str | None = Form(None, alias="clientUuid", max_length=36),
                   db: Session = Depends(get_db)):
    """`captureMachineTest`: store the printout photo, return 202 `pending`, OCR in the background.
    Re-sending the same `clientUuid` (offline retry) returns the existing reading with 200."""
    existing = svc.find_by_client_uuid(db, client_uuid)
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return svc.reading_out(db, existing)
    visit = _visit(db, visit_id)
    machine = _machine(machine_key)
    if machine.manual_only:
        raise HTTPException(422, f"'{machine_key}' has no printout to scan; use POST /readings/manual")
    path = _save(image)
    try:
        reading = svc.create_scanned(db, visit, machine, path, captured_at=client_captured_at,
                                     client_uuid=client_uuid)
    except IntegrityError:  # two offline retries raced on the same client_uuid
        db.rollback()
        uploads.delete_upload(path)
        existing = svc.find_by_client_uuid(db, client_uuid)
        if existing is None:
            raise
        response.status_code = status.HTTP_200_OK
        return svc.reading_out(db, existing)
    background.add_task(svc.process_reading, reading.id)
    return svc.reading_out(db, reading)


@router.post("/readings/manual", response_model=ReadingOut, status_code=status.HTTP_201_CREATED,
             response_model_exclude_none=True)
def manual_reading(data: ManualReadingIn, db: Session = Depends(get_db)):
    visit = _visit(db, data.visit_id)
    machine = _machine(data.machine_key)
    return svc.reading_out(db, svc.create_manual(db, visit, machine, data.values, data.captured_at))


@router.get("/readings/{reading_id}", response_model=ReadingOut, response_model_exclude_none=True)
def get_reading(reading_id: int, db: Session = Depends(get_db)):
    return svc.reading_out(db, _reading(db, reading_id))


@router.get("/visits/{visit_id}/readings", response_model=list[ReadingOut], response_model_exclude_none=True)
def visit_readings(visit_id: int, db: Session = Depends(get_db)):
    _visit(db, visit_id)
    return [svc.reading_out(db, r) for r in svc.for_visit(db, visit_id)]


@router.patch("/readings/{reading_id}/values", response_model=ReadingOut, response_model_exclude_none=True)
def patch_values(reading_id: int, data: ReadingValuesPatch, db: Session = Depends(get_db),
                 user: Staff = Depends(require_role(*ANY_STAFF))):
    reading = _reading(db, reading_id)
    if reading.status == "processing":
        raise HTTPException(status.HTTP_409_CONFLICT, "Reading is still being processed")
    return svc.reading_out(db, svc.set_values(db, reading, data.values, user))


@router.post("/readings/{reading_id}/approve", response_model=ReadingOut, response_model_exclude_none=True)
def approve_reading(reading_id: int, data: ReadingApproveIn | None = None, db: Session = Depends(get_db),
                    user: Staff = Depends(require_role(*ANY_STAFF))):
    """A person approves the extracted values (optionally correcting them in the same call). The
    printout photo is deleted and `imagePath` / `imageUrl` become null. 409 while OCR is still running."""
    reading = _reading(db, reading_id)
    try:
        svc.approve_reading(db, reading, user, data.values if data else None)
    except svc.NotReady as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Reading is still {exc} - wait for OCR to finish")
    return svc.reading_out(db, reading)


@router.delete("/readings/{reading_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reading(reading_id: int, db: Session = Depends(get_db), user: Staff = Depends(require_role(*ANY_STAFF))):
    svc.delete_reading(db, _reading(db, reading_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- exam photos

@router.post("/visits/{visit_id}/exam-photos", response_model=ExamPhotoOut, status_code=status.HTTP_201_CREATED)
def add_exam_photo(visit_id: int, image: UploadFile = File(...),
                   captured_at: datetime | None = Form(None, alias="capturedAt"), db: Session = Depends(get_db)):
    visit = _visit(db, visit_id)
    return svc.exam_photo_out(svc.add_exam_photo(db, visit, _save(image), captured_at))


@router.get("/visits/{visit_id}/exam-photos", response_model=list[ExamPhotoOut])
def list_exam_photos(visit_id: int, db: Session = Depends(get_db)):
    _visit(db, visit_id)
    return [svc.exam_photo_out(p) for p in svc.exam_photos(db, visit_id)]


@router.delete("/exam-photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exam_photo(photo_id: int, db: Session = Depends(get_db)):
    photo = db.get(ExamPhoto, photo_id)
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam photo not found")
    svc.delete_exam_photo(db, photo)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- files

@router.get("/uploads/{path:path}", response_class=Response)
def get_upload(path: str):
    """Auth-protected file access. Dev: stream with FileResponse. Prod (USE_X_ACCEL): empty body +
    X-Accel-Redirect so Nginx's `internal` /uploads/ location streams it (deploy/nginx-gurukrupa.conf)."""
    try:
        full = uploads.abs_path(path)
    except uploads.UploadError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    if settings.USE_X_ACCEL:
        return Response(status_code=status.HTTP_200_OK, headers={"X-Accel-Redirect": f"/uploads/{path}"})
    if not full.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    return FileResponse(full, headers={"Cache-Control": "private, max-age=3600"})
