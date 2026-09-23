"""Day-based appointment book (`appointments`, `addAppointment`, `checkInAppointment`, `buildDateStrip`)."""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import Integer, cast, func, select
from sqlalchemy.orm import Session

from app.models.appointments import CHANNELS, Appointment
from app.models.patients import Patient, Visit
from app.schemas.appointments import AppointmentIn, AppointmentOut, AppointmentPatch, DayCount
from app.services import queue

MAX_COUNT_DAYS = 31
CHANNEL_LABEL = {"whatsapp": "WhatsApp", "call": "phone call", "walkin": "walk-in"}


class AppointmentError(Exception):
    pass


class PastDate(AppointmentError):
    pass


class BadChannel(AppointmentError):
    pass


class AlreadyCheckedIn(AppointmentError):
    pass


class UnknownPatient(AppointmentError):
    pass


class RangeTooLarge(AppointmentError):
    pass


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)  # SQLite drops tzinfo


def _check_date(on: date) -> date:
    if on < queue.today():
        raise PastDate(on)
    return on


def _check_channel(channel: str) -> str:
    if channel not in CHANNELS:
        raise BadChannel(channel)
    return channel


def _check_patient(db: Session, patient_id: int | None) -> Patient | None:
    if patient_id is None:
        return None
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise UnknownPatient(patient_id)
    return patient


def list_appointments(db: Session, on: date | None = None) -> list[Appointment]:
    stmt = select(Appointment).where(Appointment.date == (on or queue.today())).order_by(Appointment.id)
    return list(db.scalars(stmt))


def create_appointment(db: Session, data: AppointmentIn) -> Appointment:
    _check_patient(db, data.patient_id)
    appt = Appointment(name=data.name.strip(), phone=(data.phone or "").strip() or None,
                       date=_check_date(data.date or queue.today()), channel=_check_channel(data.channel),
                       checked_in=False, patient_id=data.patient_id, note=(data.note or "").strip())
    db.add(appt)
    db.commit()
    return appt


def _source_visit(db: Session, appt: Appointment) -> Visit | None:
    return db.get(Visit, appt.source_visit_id) if appt.source_visit_id else None


def update_appointment(db: Session, appt: Appointment, data: AppointmentPatch) -> Appointment:
    values = data.model_dump(exclude_unset=True)
    if values.get("date") is not None:
        appt.date = _check_date(values["date"])
        # A follow-up moved on the appointment book moves the visit's "come back on" too.
        source = _source_visit(db, appt)
        if source is not None and not appt.checked_in:
            source.follow_up_date = appt.date
    if values.get("note") is not None:
        appt.note = values["note"].strip()
    if values.get("channel") is not None:
        appt.channel = _check_channel(values["channel"])
    if values.get("name"):
        appt.name = values["name"].strip()
    if "phone" in values:
        appt.phone = (values["phone"] or "").strip() or None
    if "patient_id" in values:
        _check_patient(db, values["patient_id"])
        appt.patient_id = values["patient_id"]
    db.commit()
    return appt


def delete_appointment(db: Session, appt: Appointment) -> None:
    if appt.checked_in:
        raise AlreadyCheckedIn(appt.id)
    source = _source_visit(db, appt)
    if source is not None and source.follow_up_date == appt.date:
        source.follow_up_date = None  # the follow-up was cancelled from the appointment book
    db.delete(appt)
    db.commit()


def find_patient_for(db: Session, appt: Appointment) -> Patient | None:
    """Linked patient, else an exact phone match (oldest record wins), else None."""
    if appt.patient_id:
        return _check_patient(db, appt.patient_id)
    phone = (appt.phone or "").strip()
    if not phone:
        return None
    return db.scalar(select(Patient).where(Patient.phone == phone).order_by(Patient.id).limit(1))


def checkin(db: Session, appt: Appointment) -> tuple[Appointment, Visit]:
    """`checkInAppointment`: link/create the patient and put them on today's queue at the first stage.
    Raises AlreadyCheckedIn, UnknownPatient, queue.ActiveVisitExists."""
    if appt.checked_in:
        raise AlreadyCheckedIn(appt.id)
    patient = find_patient_for(db, appt)
    if patient is None:
        patient = Patient(name=appt.name, phone=appt.phone, referral_source_id=None)
        db.add(patient)
        db.flush()
    if appt.source_visit_id:
        note = "Follow-up visit" + (f" — {appt.note}" if appt.note else "")
    else:
        note = f"Appointment booked via {CHANNEL_LABEL.get(appt.channel, appt.channel)}"
    visit = queue.register_visit(db, patient, note=note)
    appt.checked_in = True
    appt.visit_id = visit.id
    appt.patient_id = patient.id
    db.commit()
    return appt, visit


def _visit_ids(db: Session, appts: list[Appointment]) -> dict[int, int]:
    """appointment id -> visit id: the latest visit of the linked patient on the appointment's day.
    (The Appointment table has no visit_id column, so this is derived.)"""
    linked = [a for a in appts if a.checked_in and a.patient_id and not a.visit_id]
    if not linked:
        return {}
    rows = db.execute(select(Visit.patient_id, Visit.date, func.max(Visit.id))
                      .where(Visit.patient_id.in_({a.patient_id for a in linked}),
                             Visit.date.in_({a.date for a in linked}))
                      .group_by(Visit.patient_id, Visit.date))
    by_key = {(pid, d): vid for pid, d, vid in rows}
    return {a.id: by_key[(a.patient_id, a.date)] for a in linked if (a.patient_id, a.date) in by_key}


def appointment_out(appt: Appointment, visit_id: int | None = None) -> AppointmentOut:
    return AppointmentOut(id=appt.id, name=appt.name, phone=appt.phone, date=appt.date, channel=appt.channel,
                          checked_in=appt.checked_in, patient_id=appt.patient_id, visit_id=visit_id,
                          created_at=_aware(appt.created_at), note=appt.note or "",
                          source_visit_id=appt.source_visit_id)


def appointments_out(db: Session, appts: list[Appointment]) -> list[AppointmentOut]:
    vids = _visit_ids(db, appts)
    return [appointment_out(a, a.visit_id or vids.get(a.id)) for a in appts]


def counts(db: Session, start: date, end: date) -> dict[str, DayCount]:
    """`buildDateStrip`: per-day totals for an inclusive range (every day present, zeros included)."""
    if end < start:
        start, end = end, start
    days = (end - start).days + 1
    if days > MAX_COUNT_DAYS:
        raise RangeTooLarge(days)
    rows = db.execute(select(Appointment.date, func.count(Appointment.id),
                             func.sum(cast(Appointment.checked_in, Integer)))
                      .where(Appointment.date >= start, Appointment.date <= end).group_by(Appointment.date))
    by_day = {d: (int(total), int(done or 0)) for d, total, done in rows}
    out: dict[str, DayCount] = {}
    for i in range(days):
        d = start + timedelta(days=i)
        total, done = by_day.get(d, (0, 0))
        out[d.isoformat()] = DayCount(total=total, checked_in=done)
    return out
