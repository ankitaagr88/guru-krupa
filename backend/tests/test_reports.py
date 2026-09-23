"""The "Today" summary (`GET /reports/today`): a small made-up clinic day with known times and money."""
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import select

DAY = date(2025, 6, 10)  # nobody else in the suite uses 2025 — the numbers below are exact


def _utc(h, m, day=10):
    return datetime(2025, 6, day, h, m, tzinfo=timezone.utc)  # IST = UTC + 5:30


@pytest.fixture(scope="module")
def clinic_day():
    from app.db import SessionLocal
    from app.models.audit import AuditLog
    from app.models.billing import Bill, BillItem
    from app.models.patients import Patient, Visit
    from app.models.pharmacy import Prescription, PrescriptionLine
    from app.seed.reference import seed_reference

    with SessionLocal() as db:
        seed_reference(db)
        pa, pb, pc, pd = (Patient(name=n) for n in ("Report Asha", "Report Bharat", "Report Chirag", "Report Dev"))
        db.add_all([pa, pb, pc, pd])
        db.flush()
        # A: the whole way through in 60 min (reg 10, pretest 20, doctor 20, billing 10).
        a = Visit(patient_id=pa.id, date=DAY, token="#901", stage_key="done", status="completed",
                  created_at=_utc(4, 0), stage_entered_at=_utc(5, 0), completed_at=_utc(5, 0))
        # B: reg 20, pretest 10, still with the doctor.
        b = Visit(patient_id=pb.id, date=DAY, token="#902", stage_key="doctor", status="active",
                  created_at=_utc(5, 0), stage_entered_at=_utc(5, 30))
        # C: came the day before, paid this morning (counts in this day's money, not its patients).
        c = Visit(patient_id=pc.id, date=date(2025, 6, 9), token="#903", stage_key="done", status="completed",
                  created_at=_utc(4, 0, 9), stage_entered_at=_utc(5, 0, 9), completed_at=_utc(5, 0, 9))
        # D: paid at 00:30 the next morning, clinic time — not this day.
        d = Visit(patient_id=pd.id, date=date(2025, 6, 11), token="#904", stage_key="done", status="completed",
                  created_at=_utc(18, 45), stage_entered_at=_utc(19, 0), completed_at=_utc(19, 0))
        db.add_all([a, b, c, d])
        db.flush()
        # SQLite hands out ids of visits other tests deleted; drop any audit rows left under them.
        for old in db.scalars(select(AuditLog).where(AuditLog.entity == "visit",
                                                     AuditLog.entity_id.in_([a.id, b.id, c.id, d.id]))):
            db.delete(old)
        for vid, moves in ((a.id, [("reg", "pretest", 4, 10), ("pretest", "doctor", 4, 30),
                                   ("doctor", "billing", 4, 50), ("billing", "done", 5, 0)]),
                           (b.id, [("reg", "pretest", 5, 20), ("pretest", "doctor", 5, 30)])):
            for frm, to, h, m in moves:
                db.add(AuditLog(action="stage_move", entity="visit", entity_id=vid, detail={"from": frm, "to": to},
                                at=_utc(h, m)))
        rx_a = Prescription(visit_id=a.id)
        rx_b = Prescription(visit_id=b.id)
        db.add_all([rx_a, rx_b])
        db.flush()
        la = PrescriptionLine(prescription_id=rx_a.id, name="Report Drop", dispensed_qty=2, dispensed_at=_utc(4, 55))
        lb = PrescriptionLine(prescription_id=rx_b.id, name="Report Drop", dispensed_qty=1, dispensed_at=_utc(5, 25))
        db.add_all([la, lb])
        db.flush()
        db.add_all([
            Bill(visit_id=a.id, payment_mode="cash", paid_at=_utc(5, 0), receipt_no="GK-2025-90001",
                 items=[BillItem(label="Consultation", amount=300, kind="charge"),
                        BillItem(label="Report Drop × 2", amount=170, kind="medicine", qty=2,
                                 prescription_line_id=la.id)]),
            Bill(visit_id=b.id, items=[BillItem(label="Consultation", amount=300, kind="charge")]),
            Bill(visit_id=c.id, payment_mode="upi", paid_at=_utc(6, 0), receipt_no="GK-2025-90002",
                 items=[BillItem(label="Follow-up consultation", amount=200, kind="charge")]),
            Bill(visit_id=d.id, payment_mode="card", paid_at=_utc(19, 0), receipt_no="GK-2025-90003",
                 items=[BillItem(label="Consultation", amount=999, kind="charge")]),
        ])
        db.commit()
        return {"a": a.id, "b": b.id, "c": c.id}


def test_today_report_numbers(client, admin_headers, clinic_day):
    r = client.get("/api/reports/today", params={"date": DAY.isoformat()}, headers=admin_headers)
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["date"] == "2025-06-10"
    assert rep["patients"] == {"registered": 2, "seen": 1, "inProgress": 1}
    assert rep["avgVisitMinutes"] == 60.0

    stages = {s["key"]: s for s in rep["stages"]}
    assert "done" not in stages
    assert (stages["reg"]["avgMinutes"], stages["reg"]["visits"]) == (15.0, 2)
    assert (stages["pretest"]["avgMinutes"], stages["pretest"]["visits"]) == (15.0, 2)
    assert (stages["doctor"]["avgMinutes"], stages["doctor"]["visits"], stages["doctor"]["waitingNow"]) == (20.0, 1, 1)
    assert (stages["billing"]["avgMinutes"], stages["billing"]["visits"]) == (10.0, 1)
    assert stages["dilate"]["avgMinutes"] is None and stages["dilate"]["visits"] == 0
    assert stages["reg"]["label"] == "Registration"
    # visits by kind (lane E2): these two were made without one
    kinds = rep["visitKinds"]
    assert kinds["notSet"] == 2 and kinds["emergencies"] == 0 and all(k["count"] == 0 for k in kinds["kinds"])

    money = rep["collections"]
    modes = {m["mode"]: (m["bills"], m["amount"]) for m in money["byMode"]}
    assert modes == {"cash": (1, 470), "upi": (1, 200), "card": (0, 0), "mediclaim": (0, 0)}
    assert money["total"] == 670 and money["billsPaid"] == 2
    assert money["unpaid"] == [{"visitId": clinic_day["b"], "name": "Report Bharat", "token": "#902", "total": 300}]
    assert money["unpaidTotal"] == 300

    # A's line was billed at 170; B's was bought here but not priced (no medicine row) -> 0
    assert rep["medicines"] == [{"name": "Report Drop", "qty": 3, "amount": 170}]
    assert rep["medicinesQty"] == 3 and rep["medicinesAmount"] == 170

    assert [(x["receiptNo"], x["name"], x["total"], x["paymentMode"]) for x in rep["receipts"]] == [
        ("GK-2025-90001", "Report Asha", 470, "cash"), ("GK-2025-90002", "Report Chirag", 200, "upi")]


def test_today_report_next_day_and_roles(client, admin_headers, clinic_day, db):
    rep = client.get("/api/reports/today", params={"date": "2025-06-11"}, headers=admin_headers).json()
    assert rep["collections"]["total"] == 999 and [x["receiptNo"] for x in rep["receipts"]] == ["GK-2025-90003"]
    assert rep["patients"]["registered"] == 1

    empty = client.get("/api/reports/today", params={"date": "2025-01-01"}, headers=admin_headers).json()
    assert empty["patients"] == {"registered": 0, "seen": 0, "inProgress": 0}
    assert empty["avgVisitMinutes"] is None and empty["collections"]["total"] == 0 and empty["receipts"] == []
    # default = today (clinic time)
    assert client.get("/api/reports/today", headers=admin_headers).status_code == 200
    assert client.get("/api/reports/today", params={"date": "not-a-date"}, headers=admin_headers).status_code == 422

    from app.auth.service import ensure_user

    ensure_user(db, username="reportot", password="ot123", name="OT Person", role="ot_staff")
    ensure_user(db, username="reportrec", password="rec123", name="Report Reception", role="reception")
    ot = client.post("/api/auth/login", json={"username": "reportot", "password": "ot123"}).json()["access_token"]
    rec = client.post("/api/auth/login", json={"username": "reportrec", "password": "rec123"}).json()["access_token"]
    assert client.get("/api/reports/today", headers={"Authorization": f"Bearer {ot}"}).status_code == 403
    assert client.get("/api/reports/today", headers={"Authorization": f"Bearer {rec}"}).status_code == 200
    assert client.get("/api/reports/today").status_code == 401
