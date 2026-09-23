"""Doctor's panel: diagnosis on the visit and the follow-up date that books an appointment
(lane C owns this file)."""
from datetime import date

from app.models import Appointment, Patient, Visit


def test_groundwork_columns_exist(db):
    """Session-3 groundwork: the visit carries a diagnosis + follow-up date; an appointment can point
    back at the visit that booked it."""
    p = Patient(name="Follow Up Groundwork", age=40)
    db.add(p)
    db.flush()
    v = Visit(patient_id=p.id, date=date(2020, 1, 2), token="#901", follow_up_date=date(2020, 1, 16))
    db.add(v)
    db.flush()
    a = Appointment(name=p.name, date=date(2020, 1, 16), patient_id=p.id, source_visit_id=v.id, note="2 weeks")
    db.add(a)
    db.flush()
    assert v.diagnosis_id is None and v.follow_up_date == date(2020, 1, 16)
    assert a.source_visit_id == v.id
    db.rollback()
