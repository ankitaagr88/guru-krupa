"""Today's queue: register a visit (daily token), move stages, complete (`moveTo`, `recordVisitCompletion`)."""
from zoneinfo import ZoneInfo
from datetime import date, datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.db import utcnow
from app.models.audit import AuditLog
from app.models.config import Stage
from app.models.patients import Patient, Visit
from app.models.staff import Staff
from app.schemas.visits import DilationOut, VisitOut
from app.services.patients import last_visit_dates, patient_out

DONE_STAGE = "done"
TOKEN_RETRIES = 5


class QueueError(Exception):
    pass


class ActiveVisitExists(QueueError):
    pass


class UnknownStage(QueueError):
    pass


def today() -> date:
    return datetime.now(ZoneInfo(settings.CLINIC_TZ)).date()


def stages(db: Session) -> list[Stage]:
    return list(db.scalars(select(Stage).order_by(Stage.sort_order, Stage.id)))


def get_stage(db: Session, key: str) -> Stage:
    stage = db.scalar(select(Stage).filter_by(key=key))
    if stage is None:
        raise UnknownStage(key)
    return stage


def active_visit(db: Session, patient_id: int, on: date | None = None) -> Visit | None:
    return db.scalar(select(Visit).where(Visit.patient_id == patient_id, Visit.date == (on or today()),
                                         Visit.status == "active"))


def _next_token(db: Session, on: date) -> str:
    if db.bind.dialect.name == "postgresql":
        # Serialise token allocation per day; the lock is released at commit/rollback.
        db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": on.toordinal()})
    last = db.scalar(select(func.max(Visit.token)).where(Visit.date == on))
    n = int(last.lstrip("#")) + 1 if last else 1
    return f"#{n:03d}"


def register_visit(db: Session, patient: Patient, *, note: str | None = None, elsewhere: bool | None = None,
                   elsewhere_note: str | None = None, on: date | None = None) -> Visit:
    """Put `patient` on the day's queue at the first stage with the next `#NNN` token.
    Raises ActiveVisitExists if they already have an active visit that day."""
    on = on or today()
    if active_visit(db, patient.id, on):
        raise ActiveVisitExists(patient.id)
    first = stages(db)
    if not first:
        raise UnknownStage("<no stages seeded>")
    for attempt in range(TOKEN_RETRIES):
        visit = Visit(patient_id=patient.id, date=on, token=_next_token(db, on), stage_key=first[0].key,
                      stage_entered_at=utcnow(),
                      note=patient.note if note is None else note,
                      elsewhere=patient.elsewhere if elsewhere is None else elsewhere,
                      elsewhere_note=patient.elsewhere_note if elsewhere_note is None else elsewhere_note)
        db.add(visit)
        try:
            db.commit()
            return visit
        except IntegrityError:  # (date, token) collision under concurrency -> retry
            db.rollback()
            if attempt == TOKEN_RETRIES - 1:
                raise
    raise AssertionError("unreachable")


def move_stage(db: Session, visit: Visit, stage_key: str, by_staff: Staff | int | None) -> Visit:
    """`moveTo`: set stage, reset stage_entered_at, audit. Moving to `done` completes the visit."""
    stage = get_stage(db, stage_key)
    staff_id = by_staff.id if isinstance(by_staff, Staff) else by_staff
    old = visit.stage_key
    visit.stage_key = stage.key
    visit.stage_entered_at = utcnow()
    if stage.key == DONE_STAGE:
        visit.status = "completed"
        visit.completed_at = visit.completed_at or visit.stage_entered_at
    elif visit.status == "completed":
        visit.status, visit.completed_at = "active", None  # reopened from done
    db.add(AuditLog(staff_id=staff_id, action="stage_move", entity="visit", entity_id=visit.id,
                    detail={"from": old, "to": stage.key}))
    db.commit()
    return visit


def complete_visit(db: Session, visit: Visit, by_staff: Staff | int | None) -> Visit:
    return move_stage(db, visit, DONE_STAGE, by_staff)


def set_va(db: Session, visit: Visit, r: str, l: str) -> Visit:  # noqa: E741
    visit.va_r, visit.va_l = r, l
    db.commit()
    return visit


def todays_visits(db: Session, stage_key: str | None = None, on: date | None = None) -> list[Visit]:
    stmt = select(Visit).where(Visit.date == (on or today())).order_by(Visit.stage_entered_at, Visit.id)
    if stage_key:
        stmt = stmt.where(Visit.stage_key == stage_key)
    return list(db.scalars(stmt))


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)  # SQLite drops tzinfo


def visit_out(visit: Visit, *, last_visit: date | None = None, now: datetime | None = None) -> VisitOut:
    now = now or utcnow()
    run = visit.dilation_run
    return VisitOut(
        id=visit.id, patient_id=visit.patient_id, date=visit.date, token=visit.token, stage=visit.stage_key,
        stage_entered_at=_aware(visit.stage_entered_at),
        waiting_seconds=max(0, int((now - _aware(visit.stage_entered_at)).total_seconds())),
        status=visit.status, va={"R": visit.va_r, "L": visit.va_l},
        elsewhere=visit.elsewhere, elsewhere_note=visit.elsewhere_note, note=visit.note,
        doctor_notes=visit.doctor_notes, created_at=_aware(visit.created_at),
        completed_at=_aware(visit.completed_at) if visit.completed_at else None,
        patient=patient_out(visit.patient, last_visit, visit if visit.status == "active" else None),
        dilation=DilationOut.model_validate(run) if run else None,
        has_bill=visit.bill is not None, has_prescription=bool(visit.prescriptions),
        readings_count=len(visit.readings))


def visits_out(db: Session, visits: list[Visit]) -> list[VisitOut]:
    # "Last visit" = the most recent completed visit BEFORE the one on the board.
    by_patient: dict[int, list[Visit]] = {}
    for v in visits:
        by_patient.setdefault(v.patient_id, []).append(v)
    last: dict[int, date] = {}
    for on in {v.date for v in visits}:
        ids = [pid for pid, vs in by_patient.items() if any(x.date == on for x in vs)]
        last.update(last_visit_dates(db, ids, before=on))
    now = utcnow()
    return [visit_out(v, last_visit=last.get(v.patient_id), now=now) for v in visits]
