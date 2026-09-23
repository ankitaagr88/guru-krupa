"""Doctor's panel: the diagnosis on the visit and the follow-up date that books an appointment.

Diagnosis: the visit's diagnosis and its prescription's diagnosis are kept equal. Setting it on
the visit copies it to the prescription (`set_diagnosis`); saving a prescription with a diagnosis
(the prescription screen, the import) copies it back to the visit (the `before_flush` hook below),
so the treatment-standard counting, which reads `Prescription.diagnosis_id`, always agrees with
what the doctor picked.

Follow-up: `visit.follow_up_date` plus one appointment for that day carrying
`source_visit_id = visit.id`. Moving the date moves that appointment; clearing it deletes the
appointment unless the patient has already checked in on it.
"""
from datetime import date

from sqlalchemy import event, select
from sqlalchemy.orm import Session, attributes

from app.models.appointments import Appointment
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


class BadFollowUp(DoctorError):
    pass


# --------------------------------------------------------------------------- diagnosis
def _latest_prescription(db: Session, visit: Visit) -> Prescription | None:
    return db.scalar(select(Prescription).where(Prescription.visit_id == visit.id)
                     .order_by(Prescription.id.desc()))


def set_diagnosis(db: Session, visit: Visit, diagnosis_id: int | None) -> Visit:
    """Pick (or clear, with None) the visit's diagnosis; the prescription's follows."""
    if diagnosis_id is not None and db.get(Diagnosis, diagnosis_id) is None:
        raise UnknownDiagnosis(diagnosis_id)
    visit.diagnosis_id = diagnosis_id
    rx = _latest_prescription(db, visit)
    if rx is not None:
        rx.diagnosis_id = diagnosis_id
    db.commit()
    return visit


@event.listens_for(Session, "before_flush")
def _prescription_diagnosis_to_visit(session: Session, _ctx, _instances) -> None:
    """A prescription saved with a (changed) diagnosis sets the same diagnosis on its visit."""
    for obj in list(session.new) + list(session.dirty):
        if not isinstance(obj, Prescription) or obj.visit_id is None:
            continue
        hist = attributes.get_history(obj, "diagnosis_id")
        if obj in session.new:
            if obj.diagnosis_id is None:
                continue  # a new prescription without a diagnosis leaves the visit's alone
        elif not hist.has_changes():
            continue
        visit = session.get(Visit, obj.visit_id)
        if visit is not None and visit.diagnosis_id != obj.diagnosis_id:
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
