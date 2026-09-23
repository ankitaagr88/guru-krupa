"""Patient CRUD + the computed bits the mockup shows next to a patient (token/stage/last visit)."""
import re
from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.config import ReferralSource
from app.models.patients import Patient, Visit
from app.schemas.patients import PatientDetail, PatientIn, PatientOut, PatientPatch, VisitHistoryItem


_NULLABLE = {"dob", "age", "sex", "phone", "address", "occupation", "screen_hours", "language"}
_COMPUTED = {"referral_source", "last_visit_date", "visit_id", "token", "stage", "family_owner_id", "relation_key",
             "relation_label", "family_owner_name", "family_size", "family_phone_updated"}


def phone_key(phone: str | None) -> str:
    """Digits only, last 10 — so "+91 98250 12345", "098250-12345" and "9825012345" all compare equal."""
    return re.sub(r"\D", "", phone or "")[-10:]


class UnknownReferralSource(ValueError):
    pass


def _referral_id(db: Session, key: str | None) -> int | None:
    if not key:
        return None
    src = db.scalar(select(ReferralSource).filter_by(key=key))
    if src is None:
        raise UnknownReferralSource(key)
    return src.id


def create_patient(db: Session, data: PatientIn, by=None) -> Patient:
    """Raises UnknownReferralSource, or (with `family_owner_id`) the family service's NotFound /
    BadValue for an unknown owner or relation. Nothing is saved when it raises."""
    from app.services import family as family_svc

    values = data.model_dump(exclude={"referral_source", "family_owner_id", "relation_key"})
    if values.get("dob") is not None:
        values.pop("age", None)  # the DOB wins over a told age
    patient = Patient(**values, referral_source_id=_referral_id(db, data.referral_source))
    db.add(patient)
    if data.family_owner_id is not None:
        try:
            db.flush()
            family_svc.link(db, patient, data.family_owner_id, data.relation_key, by=by, commit=False)
        except Exception:
            db.rollback()
            raise
    db.commit()
    return patient


def update_patient(db: Session, patient: Patient, data: PatientPatch) -> int:
    """Returns how many family members' phones followed a change of the owner's phone."""
    from app.services import family as family_svc

    values = data.model_dump(exclude_unset=True)
    old_phone = patient.phone
    if "referral_source" in values:
        patient.referral_source_id = _referral_id(db, values.pop("referral_source"))
    if values.get("dob") is not None:
        values.pop("age", None)  # the DOB wins over a told age
    elif "age" in values and "dob" not in values and patient.dob is not None and values["age"] != patient.age:
        # Age corrected on its own while a DOB is on file: the DOB was wrong, so drop it.
        patient.dob = None
    for k, v in values.items():
        if v is not None or k in _NULLABLE:
            setattr(patient, k, v)
    followed = 0
    if patient.phone != old_phone and not patient.family_owner_id:
        followed = family_svc.phone_followed(db, patient)  # the owner's number is the family's number
    db.commit()
    return followed


def search_patients(db: Session, q: str, limit: int = 20) -> list[Patient]:
    q = (q or "").strip()
    if not q:
        return []
    like = f"%{q.lower()}%"
    conds = [func.lower(Patient.name).like(like), func.lower(Patient.phone).like(like)]
    # "98250 111" must also find "9825011111": compare phones on their digits alone.
    digits = re.sub(r"\D", "", q)
    if len(digits) >= 3:
        bare = func.replace(func.replace(func.replace(Patient.phone, " ", ""), "-", ""), "+", "")
        conds.append(bare.like(f"%{digits}%"))
    stmt = select(Patient).where(or_(*conds)).order_by(Patient.name).limit(limit)
    return list(db.scalars(stmt))


def patients_by_phone(db: Session, phone: str, limit: int = 20) -> list[Patient]:
    """Everyone registered with this number (families often share one), compared on the last 10
    digits so numbers typed with spaces, dashes or +91 (e.g. KiviHealth imports) still match."""
    key = phone_key(phone)
    if len(key) < 10:
        return []
    digits_only = Patient.phone
    for ch in (" ", "-", "+", "(", ")", "."):
        digits_only = func.replace(digits_only, ch, "")
    stmt = (select(Patient).where(Patient.phone.is_not(None), digits_only.like(f"%{key}"))
            .order_by(Patient.name, Patient.id))
    return [p for p in db.scalars(stmt) if phone_key(p.phone) == key][:limit]


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


def patient_out(patient: Patient, last_visit: date | None = None, today_visit: Visit | None = None,
                family: dict | None = None) -> PatientOut:
    """`family` = this patient's entry from family.family_bits (worked out here when not given)."""
    from app.services import family as family_svc

    cols = {k: getattr(patient, k) for k in PatientOut.model_fields if k not in _COMPUTED}
    tv = today_visit
    if family is None:
        family = family_svc.family_bits(None, [patient]).get(patient.id, {})
    return PatientOut(**cols, referral_source=patient.referral_source.key if patient.referral_source else None,
                      last_visit_date=last_visit, visit_id=tv and tv.id, token=tv and tv.token,
                      stage=tv and tv.stage_key, **family)


def patients_out(db: Session, patients: list[Patient], today: date) -> list[PatientOut]:
    from app.services import family as family_svc

    ids = [p.id for p in patients]
    last, active = last_visit_dates(db, ids), today_active_visits(db, ids, today)
    fam = family_svc.family_bits(db, patients)
    return [patient_out(p, last.get(p.id), active.get(p.id), fam.get(p.id)) for p in patients]


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
    from app.services import billing as billing_svc, pharmacy as pharmacy_svc
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
            bill=billing_svc.bill_out(v.bill) if v.bill is not None else None,
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
