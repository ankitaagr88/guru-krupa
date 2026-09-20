"""Patient CRUD + the computed bits the mockup shows next to a patient (token/stage/last visit)."""
from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.config import ReferralSource
from app.models.patients import Patient, Visit
from app.schemas.patients import PatientDetail, PatientIn, PatientOut, PatientPatch, VisitHistoryItem


_NULLABLE = {"age", "sex", "phone", "address", "occupation", "screen_hours", "language"}
_COMPUTED = {"referral_source", "last_visit_date", "visit_id", "token", "stage"}


class UnknownReferralSource(ValueError):
    pass


def _referral_id(db: Session, key: str | None) -> int | None:
    if not key:
        return None
    src = db.scalar(select(ReferralSource).filter_by(key=key))
    if src is None:
        raise UnknownReferralSource(key)
    return src.id


def create_patient(db: Session, data: PatientIn) -> Patient:
    values = data.model_dump(exclude={"referral_source"})
    patient = Patient(**values, referral_source_id=_referral_id(db, data.referral_source))
    db.add(patient)
    db.commit()
    return patient


def update_patient(db: Session, patient: Patient, data: PatientPatch) -> Patient:
    values = data.model_dump(exclude_unset=True)
    if "referral_source" in values:
        patient.referral_source_id = _referral_id(db, values.pop("referral_source"))
    for k, v in values.items():
        if v is not None or k in _NULLABLE:
            setattr(patient, k, v)
    db.commit()
    return patient


def search_patients(db: Session, q: str, limit: int = 20) -> list[Patient]:
    q = (q or "").strip()
    if not q:
        return []
    like = f"%{q.lower()}%"
    stmt = (select(Patient)
            .where(or_(func.lower(Patient.name).like(like), func.lower(Patient.phone).like(like)))
            .order_by(Patient.name).limit(limit))
    return list(db.scalars(stmt))


def last_visit_dates(db: Session, patient_ids: list[int], before: date | None = None) -> dict[int, date]:
    """patient_id -> latest completed visit date (`lookupLastVisit`). `before` excludes visits on/after
    that day, so today's own (already completed) visit does not read as "Last visit: Today"."""
    if not patient_ids:
        return {}
    q = (select(Visit.patient_id, func.max(Visit.date))
         .where(Visit.patient_id.in_(patient_ids), Visit.status == "completed"))
    if before is not None:
        q = q.where(Visit.date < before)
    rows = db.execute(q.group_by(Visit.patient_id))
    return {pid: d for pid, d in rows}


def today_active_visits(db: Session, patient_ids: list[int], today: date) -> dict[int, Visit]:
    if not patient_ids:
        return {}
    rows = db.scalars(select(Visit).where(Visit.patient_id.in_(patient_ids), Visit.date == today,
                                          Visit.status == "active"))
    return {v.patient_id: v for v in rows}


def patient_out(patient: Patient, last_visit: date | None = None, today_visit: Visit | None = None) -> PatientOut:
    cols = {k: getattr(patient, k) for k in PatientOut.model_fields if k not in _COMPUTED}
    tv = today_visit
    return PatientOut(**cols, referral_source=patient.referral_source.key if patient.referral_source else None,
                      last_visit_date=last_visit, visit_id=tv and tv.id, token=tv and tv.token,
                      stage=tv and tv.stage_key)


def patients_out(db: Session, patients: list[Patient], today: date) -> list[PatientOut]:
    ids = [p.id for p in patients]
    last, active = last_visit_dates(db, ids), today_active_visits(db, ids, today)
    return [patient_out(p, last.get(p.id), active.get(p.id)) for p in patients]


def patient_detail(db: Session, patient: Patient, today: date) -> PatientDetail:
    base = patients_out(db, [patient], today)[0]
    visits = db.scalars(select(Visit).where(Visit.patient_id == patient.id)
                        .order_by(Visit.date.desc(), Visit.id.desc()))
    history = [VisitHistoryItem(id=v.id, date=v.date, token=v.token, stage=v.stage_key, status=v.status,
                                va={"R": v.va_r, "L": v.va_l}, readings_count=len(v.readings),
                                has_prescription=bool(v.prescriptions), has_bill=v.bill is not None,
                                completed_at=v.completed_at) for v in visits]
    return PatientDetail(**base.model_dump(), visits=history)


def patient_history(db: Session, patient: Patient, today: date):
    """Everything on one patient, for the patient screen (`GET /patients/{id}/history`)."""
    from app.models.appointments import Appointment
    from app.models.ot import OtCase
    from app.schemas.history import PatientHistoryOut, VisitHistoryOut
    from app.services import appointments as appt_svc
    from app.services import ot as ot_svc
    from app.services import pharmacy as pharmacy_svc
    from app.services import readings as readings_svc

    base = patients_out(db, [patient], today)[0]
    visits = list(db.scalars(select(Visit).where(Visit.patient_id == patient.id)
                             .order_by(Visit.date.desc(), Visit.id.desc())))
    out_visits = []
    n_readings = n_rx = 0
    for v in visits:
        rx = v.prescriptions[0] if v.prescriptions else None
        n_readings += len(v.readings)
        n_rx += 1 if rx else 0
        out_visits.append(VisitHistoryOut(
            id=v.id, date=v.date, token=v.token, stage=v.stage_key, status=v.status,
            va={"R": v.va_r, "L": v.va_l}, note=v.note or "", doctor_notes=v.doctor_notes or "",
            elsewhere=v.elsewhere, elsewhere_note=v.elsewhere_note or "", completed_at=v.completed_at,
            imported=(v.note or "").startswith("Imported from"),
            readings=[readings_svc.reading_out(db, r) for r in v.readings],
            prescription=pharmacy_svc.prescription_out(db, rx) if rx else None,
            bill=pharmacy_svc.bill_out(v.bill) if v.bill is not None else None,
            exam_photos=[readings_svc.exam_photo_out(p) for p in v.exam_photos]))
    cases = list(db.scalars(select(OtCase).where(OtCase.patient_id == patient.id)
                            .order_by(OtCase.date.desc(), OtCase.id.desc())))
    appts = list(db.scalars(select(Appointment).where(Appointment.patient_id == patient.id)))
    upcoming = sorted([a for a in appts if a.date >= today], key=lambda a: a.date)
    past = sorted([a for a in appts if a.date < today], key=lambda a: a.date, reverse=True)
    return PatientHistoryOut(
        patient=base, visits=out_visits, ot_cases=[ot_svc.case_out(db, c) for c in cases],
        appointments=[appt_svc.appointment_out(a) for a in upcoming + past],
        totals={"visits": len(visits), "prescriptions": n_rx, "surgeries": len(cases), "readings": n_readings})
