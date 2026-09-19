"""OT / surgery cases: scheduling with real time slots, nested section updates, consent photos,
surgical bill (lens tier price). Mirrors the mockup's `otCases` functions."""
import copy
import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.db import utcnow
from app.models.config import LensTier
from app.models.ot import (OT_STATUSES, OtCase, OtConsentPhoto, empty_billing, empty_biometry,
                           empty_operative, empty_post_op)
from app.models.patients import Patient
from app.schemas.ot import LensTierOut, OtCaseOut, OtConsentPhotoOut, OtSlotOut
from app.services.queue import today

SLOT_STEP_MIN = 45
SLOT_START = time(9, 0)
SLOT_END = time(17, 0)


def _build_slots(start: time, end: time, step_min: int) -> list[str]:
    slots, t = [], datetime.combine(date(2000, 1, 1), start)
    end_dt = datetime.combine(date(2000, 1, 1), end)
    while t <= end_dt:
        slots.append(t.strftime("%I:%M %p").lstrip("0"))
        t += timedelta(minutes=step_min)
    return slots


# "9:00 AM", "9:45 AM", ..., "4:30 PM" (last slot <= 5:00 PM). Admin-configurable later.
OT_SLOTS: list[str] = _build_slots(SLOT_START, SLOT_END, SLOT_STEP_MIN)

ACTIVE_STATUSES = tuple(s for s in OT_STATUSES if s != "cancelled")
SECTION_FIELDS = ("pre_op_biometry", "operative", "post_op", "billing")
CLINICAL_SECTIONS = ("operative", "post_op")


class OtError(Exception):
    pass


class SlotConflict(OtError):
    pass


class UnknownStatus(OtError):
    pass


class UnknownLensTier(OtError):
    pass


class PatientNotFound(OtError):
    pass


# --- helpers ---------------------------------------------------------------------------------

def slot_sort_key(slot: str) -> tuple[int, str]:
    """Order "9:00 AM" < "11:00 AM" < "2:00 PM"; unparseable free text sorts last, alphabetically."""
    try:
        return (0, datetime.strptime(slot.strip().upper(), "%I:%M %p").strftime("%H:%M"))
    except ValueError:
        return (1, slot)


def deep_merge(base: dict, patch: dict) -> dict:
    """Return a copy of `base` with `patch` merged in recursively (dict values merge, others replace)."""
    out = copy.deepcopy(base) if isinstance(base, dict) else {}
    for k, v in (patch or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)  # SQLite drops tzinfo


# --- lens tiers ------------------------------------------------------------------------------

def lens_tiers(db: Session) -> list[LensTier]:
    return list(db.scalars(select(LensTier).order_by(LensTier.sort_order, LensTier.id)))


def lens_tiers_out(db: Session) -> list[LensTierOut]:
    return [LensTierOut(key=t.key, label=t.label, price=t.price) for t in lens_tiers(db)]


def _lens_price(db: Session, key: str | None) -> int:
    if not key:
        return 0
    tier = db.scalar(select(LensTier).filter_by(key=key))
    return tier.price if tier else 0


def _validate_billing(db: Session, billing: dict) -> None:
    key = billing.get("lensTier")
    if key and db.scalar(select(LensTier).filter_by(key=key)) is None:
        raise UnknownLensTier(key)


# --- queries -----------------------------------------------------------------------------------

def _base_query():
    return select(OtCase).options(selectinload(OtCase.consent_photos))


def get_case(db: Session, case_id: int) -> OtCase | None:
    return db.scalar(_base_query().where(OtCase.id == case_id))


def cases_on(db: Session, on: date | None = None) -> list[OtCase]:
    rows = list(db.scalars(_base_query().where(OtCase.date == (on or today()))))
    return sorted(rows, key=lambda c: (slot_sort_key(c.time_slot), c.id))


def cases_between(db: Session, start: date, end: date) -> list[OtCase]:
    rows = list(db.scalars(_base_query().where(OtCase.date >= start, OtCase.date <= end)))
    return sorted(rows, key=lambda c: (c.date, slot_sort_key(c.time_slot), c.id))


def counts_between(db: Session, start: date, end: date) -> dict[str, int]:
    """Non-cancelled cases per day for the date strip (`buildOtDateStrip`)."""
    stmt = (select(OtCase.date, func.count(OtCase.id))
            .where(OtCase.date >= start, OtCase.date <= end, OtCase.status.in_(ACTIVE_STATUSES))
            .group_by(OtCase.date))
    return {d.isoformat(): n for d, n in db.execute(stmt)}


def slots_on(db: Session, on: date | None = None) -> list[OtSlotOut]:
    """Occupancy of each configured slot; slots holding cancelled cases show as free."""
    taken = {c.time_slot: c for c in cases_on(db, on) if c.status != "cancelled"}
    return [OtSlotOut(time_slot=s, case_id=taken[s].id if s in taken else None,
                      patient_name=taken[s].patient_name if s in taken else None) for s in OT_SLOTS]


def _conflict(db: Session, on: date, slot: str, exclude_id: int | None = None) -> OtCase | None:
    stmt = select(OtCase).where(OtCase.date == on, OtCase.time_slot == slot,
                                OtCase.status.in_(ACTIVE_STATUSES))
    if exclude_id is not None:
        stmt = stmt.where(OtCase.id != exclude_id)
    return db.scalar(stmt)


# --- mutations -------------------------------------------------------------------------------

def create_case(db: Session, *, patient_id: int | None, patient_name: str | None, age: int | None,
                sex: str | None, on: date, time_slot: str, procedure: str,
                pre_op_biometry: dict | None = None) -> OtCase:
    if patient_id is not None:
        patient = db.get(Patient, patient_id)
        if patient is None:
            raise PatientNotFound(patient_id)
        patient_name, age, sex = patient.name, patient.age, patient.sex
    if not patient_name:
        raise ValueError("patientName required when patientId is not given")
    if _conflict(db, on, time_slot):
        raise SlotConflict(time_slot)
    case = OtCase(patient_id=patient_id, patient_name=patient_name, age=age, sex=sex, date=on,
                  time_slot=time_slot, procedure=procedure, status="scheduled",
                  pre_op_biometry=deep_merge(empty_biometry(), pre_op_biometry or {}),
                  operative=empty_operative(), post_op=empty_post_op(), billing=empty_billing())
    db.add(case)
    db.commit()
    return get_case(db, case.id)


def update_case(db: Session, case: OtCase, values: dict) -> OtCase:
    """Apply a partial update: scalar fields set, section dicts deep-merged. Re-checks slot conflicts."""
    new_date = values.get("date", case.date)
    new_slot = values.get("time_slot", case.time_slot)
    if (new_date != case.date or new_slot != case.time_slot) and case.status != "cancelled":
        if _conflict(db, new_date, new_slot, exclude_id=case.id):
            raise SlotConflict(new_slot)
    for k, v in values.items():
        if k in SECTION_FIELDS:
            if v is None:
                continue
            merged = deep_merge(getattr(case, k) or {}, v)
            if k == "billing":
                _validate_billing(db, merged)
            setattr(case, k, merged)  # new dict so SQLAlchemy sees the change
        else:
            setattr(case, k, v)
    db.commit()
    return case


def set_status(db: Session, case: OtCase, status: str) -> OtCase:
    if status not in OT_STATUSES:
        raise UnknownStatus(status)
    if status != "cancelled" and case.status == "cancelled" and _conflict(db, case.date, case.time_slot,
                                                                            exclude_id=case.id):
        raise SlotConflict(case.time_slot)  # un-cancelling into a slot someone else took
    case.status = status
    # OtCase has no completed_at column (model change requested); nothing else to stamp.
    db.commit()
    return case


def cancel_case(db: Session, case: OtCase) -> OtCase:
    return set_status(db, case, "cancelled")


# --- consent photos ----------------------------------------------------------------------------

_EXT_BY_TYPE = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic"}


def save_consent_image(data: bytes, filename: str | None, content_type: str | None) -> str:
    """Write bytes to UPLOAD_DIR/ot/<yyyy>/<mm>/<uuid>.<ext>; return the path relative to UPLOAD_DIR."""
    ext = Path(filename or "").suffix.lstrip(".").lower() or _EXT_BY_TYPE.get(content_type or "", "jpg")
    now = utcnow()
    rel = Path("ot") / f"{now:%Y}" / f"{now:%m}" / f"{uuid.uuid4().hex}.{ext}"
    full = Path(settings.UPLOAD_DIR) / rel
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(data)
    return rel.as_posix()


def add_consent_photo(db: Session, case: OtCase, data: bytes, filename: str | None,
                      content_type: str | None) -> OtConsentPhoto:
    photo = OtConsentPhoto(image_path=save_consent_image(data, filename, content_type))
    case.consent_photos.append(photo)  # via the relationship so the loaded collection stays current
    db.commit()
    return photo


def remove_consent_photo(db: Session, photo: OtConsentPhoto) -> None:
    full = Path(settings.UPLOAD_DIR) / photo.image_path
    db.delete(photo)
    db.commit()
    try:
        full.unlink(missing_ok=True)
    except OSError:
        pass


# --- output ------------------------------------------------------------------------------------

def billing_out(db: Session, billing: dict) -> dict:
    """Stored billing keys + computed `lensPrice` / `total` (surgeon/OT fees out of scope for now)."""
    b = dict(empty_billing())
    b.update(billing or {})
    price = _lens_price(db, b.get("lensTier"))
    b["lensPrice"] = price
    b["total"] = price
    return b


def case_out(db: Session, case: OtCase) -> OtCaseOut:
    return OtCaseOut(
        id=case.id, patient_id=case.patient_id, patient_name=case.patient_name, age=case.age, sex=case.sex,
        date=case.date, time_slot=case.time_slot, procedure=case.procedure, status=case.status,
        pre_op_biometry=case.pre_op_biometry or empty_biometry(),
        operative=case.operative or empty_operative(),
        consent_photos=[OtConsentPhotoOut(id=p.id, image_path=p.image_path, captured_at=_aware(p.captured_at))
                        for p in case.consent_photos],
        post_op=case.post_op or empty_post_op(),
        billing=billing_out(db, case.billing),
        created_at=_aware(case.created_at),
        updated_at=_aware(case.updated_at or case.created_at),
    )


def cases_out(db: Session, cases: list[OtCase]) -> list[OtCaseOut]:
    return [case_out(db, c) for c in cases]
