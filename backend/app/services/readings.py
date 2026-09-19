"""Machine readings (`captureMachineTest` / `applyExtractedReading`) and exam photos (`attachExamPhoto`).

Scanned flow: POST /readings saves the photo and a `pending` Reading, then `process_reading`
runs in a background task with its own DB session: preprocess -> Tesseract -> template parser ->
sanity flags -> `done` (or `failed` with `error`). Nothing here can leave a row in `processing`."""
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal, utcnow
from app.models.audit import AuditLog
from app.models.patients import ExamPhoto, Visit
from app.models.readings import READING_SOURCES, Reading
from app.models.staff import Staff
from app.ocr.templates import MACHINES, Machine
from app.schemas.readings import ExamPhotoOut, ReadingOut, ReadingValue
from app.services import uploads

log = logging.getLogger(__name__)

CORRECTED_SOURCE = "corrected"
CORRECTED_ACTION = "reading.correct"
NO_FIELDS_ERROR = "No readable fields found - retake the photo (flat, well lit, printout filling the frame)"


class ReadingError(Exception):
    pass


class ManualOnly(ReadingError):
    pass


class UnknownMachine(ReadingError):
    pass


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)  # SQLite drops tzinfo


def _utc(dt: datetime | None) -> datetime:
    """Client timestamps arrive in any offset; store them as UTC like every other column."""
    return _aware(dt).astimezone(timezone.utc) if dt else utcnow()


def get_machine(key: str) -> Machine:
    m = MACHINES.get(key)
    if m is None:
        raise UnknownMachine(key)
    return m


def _clean_values(values: list[ReadingValue] | list[dict]) -> list[dict]:
    out = []
    for v in values:
        if isinstance(v, ReadingValue):
            out.append(v.model_dump(exclude_none=True))
        else:
            out.append({k: x for k, x in v.items() if x is not None})
    return out


# ---------------------------------------------------------------- create

def find_by_client_uuid(db: Session, client_uuid: str | None) -> Reading | None:
    if not client_uuid:
        return None
    return db.scalar(select(Reading).where(Reading.client_uuid == client_uuid))


def create_scanned(db: Session, visit: Visit, machine: Machine, image_path: str, *,
                   captured_at: datetime | None = None, client_uuid: str | None = None) -> Reading:
    if machine.manual_only:
        raise ManualOnly(machine.key)
    reading = Reading(visit_id=visit.id, machine_key=machine.key, source="scanned", status="pending",
                      image_path=image_path, captured_at=_utc(captured_at), values=[],
                      client_uuid=client_uuid or None)
    db.add(reading)
    db.commit()
    return reading


def create_manual(db: Session, visit: Visit, machine: Machine, values: list[ReadingValue],
                  captured_at: datetime | None = None) -> Reading:
    reading = Reading(visit_id=visit.id, machine_key=machine.key, source="manual", status="done",
                      captured_at=_utc(captured_at), values=_clean_values(values), confidence=None)
    db.add(reading)
    db.commit()
    return reading


# ---------------------------------------------------------------- background OCR

def process_reading(reading_id: int) -> None:
    """Background task entry point. Opens its own session; never raises."""
    with SessionLocal() as db:
        reading = db.get(Reading, reading_id)
        if reading is None or reading.status == "done":
            return
        reading.status = "processing"
        reading.error = None
        db.commit()
        try:
            _run_ocr(reading)
        except Exception as exc:  # noqa: BLE001 - any failure must land in `failed`, never stay `processing`
            log.exception("OCR failed for reading %s", reading_id)
            db.rollback()
            reading = db.get(Reading, reading_id)
            if reading is not None:
                reading.status = "failed"
                reading.error = f"{type(exc).__name__}: {exc}"[:255]
        db.commit()


def _run_ocr(reading: Reading) -> None:
    # Imported lazily so the API can start (and manual readings work) without cv2/tesseract.
    from app.ocr.engine import recognise
    from app.ocr.preprocess import preprocess

    machine = get_machine(reading.machine_key)
    if not reading.image_path:
        raise ReadingError("reading has no image")
    img = preprocess(uploads.abs_path(reading.image_path))
    result = recognise(img, machine)
    reading.values = result.values
    reading.confidence = result.confidence
    if result.values:
        reading.status, reading.error = "done", None
    else:
        reading.status, reading.error = "failed", NO_FIELDS_ERROR


# ---------------------------------------------------------------- correction / delete

def is_corrected(db: Session, reading: Reading) -> bool:
    if reading.source == CORRECTED_SOURCE:
        return True
    return db.scalar(select(AuditLog.id).where(AuditLog.entity == "reading", AuditLog.entity_id == reading.id,
                                               AuditLog.action == CORRECTED_ACTION).limit(1)) is not None


def set_values(db: Session, reading: Reading, values: list[ReadingValue], by_staff: Staff | int | None) -> Reading:
    """`applyExtractedReading` with staff edits: store the values, mark the reading done."""
    staff_id = by_staff.id if isinstance(by_staff, Staff) else by_staff
    before = reading.values
    reading.values = _clean_values(values)
    reading.status = "done"
    reading.error = None
    if CORRECTED_SOURCE in READING_SOURCES:
        reading.source = CORRECTED_SOURCE
    # READING_SOURCES has no "corrected" today: the source stays and the audit row carries the flag.
    db.add(AuditLog(staff_id=staff_id, action=CORRECTED_ACTION, entity="reading", entity_id=reading.id,
                    detail={"corrected": True, "from": before, "to": reading.values}))
    db.commit()
    return reading


def delete_reading(db: Session, reading: Reading) -> None:
    path = reading.image_path
    db.delete(reading)
    db.commit()
    uploads.delete_upload(path)


def for_visit(db: Session, visit_id: int) -> list[Reading]:
    return list(db.scalars(select(Reading).where(Reading.visit_id == visit_id).order_by(Reading.id)))


def reading_out(db: Session, reading: Reading) -> ReadingOut:
    machine = MACHINES.get(reading.machine_key)
    return ReadingOut(
        id=reading.id, visit_id=reading.visit_id, machine_key=reading.machine_key,
        machine=machine.label if machine else reading.machine_key,
        source=reading.source, corrected=is_corrected(db, reading), captured_at=_aware(reading.captured_at),
        image_path=reading.image_path, image_url=uploads.public_url(reading.image_path), status=reading.status,
        values=[ReadingValue(**v) for v in (reading.values or [])], confidence=reading.confidence,
        client_uuid=reading.client_uuid, error=reading.error)


# ---------------------------------------------------------------- exam photos

def add_exam_photo(db: Session, visit: Visit, image_path: str, captured_at: datetime | None = None) -> ExamPhoto:
    photo = ExamPhoto(visit_id=visit.id, image_path=image_path, captured_at=_utc(captured_at))
    db.add(photo)
    db.commit()
    return photo


def exam_photos(db: Session, visit_id: int) -> list[ExamPhoto]:
    return list(db.scalars(select(ExamPhoto).where(ExamPhoto.visit_id == visit_id).order_by(ExamPhoto.id)))


def delete_exam_photo(db: Session, photo: ExamPhoto) -> None:
    path = photo.image_path
    db.delete(photo)
    db.commit()
    uploads.delete_upload(path)


def exam_photo_out(photo: ExamPhoto) -> ExamPhotoOut:
    return ExamPhotoOut(id=photo.id, visit_id=photo.visit_id, image_path=photo.image_path,
                        captured_at=_aware(photo.captured_at), url=uploads.public_url(photo.image_path))
