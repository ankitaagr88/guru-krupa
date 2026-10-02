"""Doctor's panel: the diagnoses on the visit and the follow-up date that books an appointment.

Diagnoses: a visit can have several (up to ClinicSetting "diagnoses".maxPerVisit, default 3), in the
order picked; `diagnosis_id` is always the first of `diagnosis_ids`. The visit's diagnoses and its
prescription's are kept equal. Setting them on the visit copies them to the prescription
(`set_diagnoses`); saving a prescription with diagnoses (the prescription screen, the import) copies
them back to the visit (the `before_flush` hook below), so the treatment-standard counting, which
reads the prescriptions, always agrees with what the doctor picked. Code that still sets only
`diagnosis_id` gets a one-item list.

Follow-up: `visit.follow_up_date` plus one appointment for that day carrying
`source_visit_id = visit.id`. Moving the date moves that appointment; clearing it deletes the
appointment unless the patient has already checked in on it.
"""
from datetime import date

from sqlalchemy import event, select
from sqlalchemy.orm import Session, attributes

from app.models.appointments import Appointment
from app.models.config import ClinicSetting
from app.models.patients import Visit
from app.models.pharmacy import Diagnosis, Prescription
from app.services import queue

# How a follow-up was booked: in person, at the visit. The appointment book shows these as
# "Follow-up" (from source_visit_id), so no extra channel value is needed.
FOLLOW_UP_CHANNEL = "walkin"


class DoctorError(Exception):
    pass


class UnknownDiagnosis(DoctorError):
    pass


class TooManyDiagnoses(DoctorError):
    pass


DIAGNOSIS_SETTINGS_KEY = "diagnoses"
DEFAULT_MAX_DIAGNOSES = 3
MAX_DIAGNOSES_LIMIT = 10  # what Admin may set at most


class BadFollowUp(DoctorError):
    pass


# --------------------------------------------------------------------------- diagnosis
def _latest_prescription(db: Session, visit: Visit) -> Prescription | None:
    return db.scalar(select(Prescription).where(Prescription.visit_id == visit.id)
                     .order_by(Prescription.id.desc()))


def max_diagnoses(db: Session) -> int:
    row = db.get(ClinicSetting, DIAGNOSIS_SETTINGS_KEY)
    try:
        n = int((row.value or {}).get("maxPerVisit", DEFAULT_MAX_DIAGNOSES)) if row is not None else DEFAULT_MAX_DIAGNOSES
    except (TypeError, ValueError):
        n = DEFAULT_MAX_DIAGNOSES
    return min(max(n, 1), MAX_DIAGNOSES_LIMIT)


def save_max_diagnoses(db: Session, n: int) -> int:
    """Admin: how many diagnoses a visit may have (1 = one, as before). Visits that already have
    more keep them."""
    row = db.get(ClinicSetting, DIAGNOSIS_SETTINGS_KEY)
    if row is None:
        row = ClinicSetting(key=DIAGNOSIS_SETTINGS_KEY, value={})
        db.add(row)
    row.value = {**(row.value or {}), "maxPerVisit": min(max(int(n), 1), MAX_DIAGNOSES_LIMIT)}
    db.commit()
    return max_diagnoses(db)


def clean_diagnosis_ids(db: Session, ids: list[int] | None) -> list[int]:
    """The ids in order, repeats dropped; each must exist, and no more than the clinic's limit."""
    out: list[int] = []
    for i in ids or []:
        if i not in out:
            out.append(i)
    for i in out:
        if db.get(Diagnosis, i) is None:
            raise UnknownDiagnosis(i)
    limit = max_diagnoses(db)
    if len(out) > limit:
        raise TooManyDiagnoses(f"At most {limit} diagnoses per visit")
    return out


def set_diagnoses(db: Session, visit: Visit, ids: list[int] | None) -> Visit:
    """Pick the visit's diagnoses (an empty list clears them); the prescription's follow."""
    ids = clean_diagnosis_ids(db, ids)
    visit.diagnosis_ids = list(ids)
    visit.diagnosis_id = ids[0] if ids else None
    rx = _latest_prescription(db, visit)
    if rx is not None:
        rx.diagnosis_ids = list(ids)
        rx.diagnosis_id = visit.diagnosis_id
    db.commit()
    return visit


def set_diagnosis(db: Session, visit: Visit, diagnosis_id: int | None) -> Visit:
    """One diagnosis (or none): kept for callers that send a single `diagnosisId`."""
    return set_diagnoses(db, visit, [diagnosis_id] if diagnosis_id is not None else [])


def ids_of(obj) -> list[int]:
    """A visit's or prescription's diagnoses, in order (older rows may have only `diagnosis_id`)."""
    ids = list(obj.diagnosis_ids or [])
    if not ids and obj.diagnosis_id is not None:
        ids = [obj.diagnosis_id]
    return ids


def _normalise(obj, is_new: bool) -> bool:
    """Keep `diagnosis_id` == first of `diagnosis_ids`. Returns True when the diagnoses changed."""
    ids_changed = attributes.get_history(obj, "diagnosis_ids").has_changes()
    id_changed = attributes.get_history(obj, "diagnosis_id").has_changes()
    ids = list(obj.diagnosis_ids or [])
    if ids_changed or (is_new and ids):
        first = ids[0] if ids else None
        if obj.diagnosis_id != first:
            obj.diagnosis_id = first
        return True
    if id_changed or (is_new and obj.diagnosis_id is not None):
        if ids[:1] != ([obj.diagnosis_id] if obj.diagnosis_id is not None else []):
            obj.diagnosis_ids = [obj.diagnosis_id] if obj.diagnosis_id is not None else []
        return True
    return False


@event.listens_for(Session, "before_flush")
def _prescription_diagnosis_to_visit(session: Session, _ctx, _instances) -> None:
    """A prescription saved with (changed) diagnoses sets the same diagnoses on its visit."""
    for obj in list(session.new) + list(session.dirty):
        if isinstance(obj, Visit):
            _normalise(obj, obj in session.new)
            continue
        if not isinstance(obj, Prescription) or obj.visit_id is None:
            continue
        is_new = obj in session.new
        if not _normalise(obj, is_new):
            continue
        if is_new and obj.diagnosis_id is None:
            continue  # a new prescription without a diagnosis leaves the visit's alone
        visit = session.get(Visit, obj.visit_id)
        if visit is not None and ids_of(visit) != ids_of(obj):
            visit.diagnosis_ids = ids_of(obj)
            visit.diagnosis_id = obj.diagnosis_id


# --------------------------------------------------------------------------- follow-up
def follow_up_appointment(db: Session, visit: Visit, *, open_only: bool = False) -> Appointment | None:
    """The appointment this visit's follow-up booked (the latest one)."""
    q = select(Appointment).where(Appointment.source_visit_id == visit.id)
    if open_only:
        q = q.where(Appointment.checked_in.is_(False))
    return db.scalar(q.order_by(Appointment.id.desc()))


def set_follow_up(db: Session, visit: Visit, on: date, note: str = "") -> Visit:
    """Store "come back on `on`" and book (or move) the appointment for that day."""
    if on <= visit.date:
        raise BadFollowUp("The follow-up date must be after this visit")
    if on < queue.today():
        raise BadFollowUp("The follow-up date must be today or later")
    note = " ".join((note or "").split())
    patient = visit.patient
    visit.follow_up_date = on
    appt = follow_up_appointment(db, visit, open_only=True)
    if appt is None:
        appt = Appointment(source_visit_id=visit.id, channel=FOLLOW_UP_CHANNEL, checked_in=False)
        db.add(appt)
    appt.date = on
    appt.note = note
    appt.name = patient.name
    appt.phone = patient.phone
    appt.patient_id = patient.id
    db.commit()
    return visit


def clear_follow_up(db: Session, visit: Visit) -> Visit:
    """"No follow-up": forget the date and drop the booked appointment unless already checked in."""
    visit.follow_up_date = None
    for appt in db.scalars(select(Appointment).where(Appointment.source_visit_id == visit.id,
                                                     Appointment.checked_in.is_(False))):
        db.delete(appt)
    db.commit()
    return visit
