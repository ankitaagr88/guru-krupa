"""Doctor's panel: diagnosis on the visit and the follow-up date that books an appointment
(lane C owns this file)."""
from datetime import date, timedelta

import pytest

from app.models import Appointment, Patient, Visit
from app.seed.reference import seed_reference
from app.services.queue import today


@pytest.fixture(scope="module", autouse=True)
def _seed():
    from app.db import SessionLocal

    with SessionLocal() as db:
        seed_reference(db)


def _day(offset: int) -> str:
    return (today() + timedelta(days=offset)).isoformat()


def _visit(client, headers, name, phone=None):
    body = {"name": name, "age": 50, "sex": "F", **({"phone": phone} if phone else {})}
    pid = client.post("/api/patients", json=body, headers=headers).json()["id"]
    r = client.post("/api/visits", json={"patientId": pid}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _diagnoses(client, headers):
    return {d["name"]: d["id"] for d in client.get("/api/diagnoses", headers=headers).json()}


def _appts(client, headers, day):
    return client.get(f"/api/appointments?date={day}", headers=headers).json()


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


def test_diagnosis_on_visit_keeps_prescription_in_sync(client, admin_headers):
    dx = _diagnoses(client, admin_headers)
    dry, cat = dx["Dry eye"], dx["Cataract"]
    v = _visit(client, admin_headers, "Diag Sync")
    assert v["diagnosisId"] is None and v["diagnosisName"] is None

    # picked before any prescription exists: stored on the visit
    r = client.patch(f"/api/visits/{v['id']}", json={"diagnosisId": dry}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["diagnosisId"] == dry and r.json()["diagnosisName"] == "Dry eye"

    # the prescription screen saves with another diagnosis -> the visit follows
    r = client.post(f"/api/visits/{v['id']}/prescription",
                    json={"diagnosisId": cat, "lines": [{"name": "Carboxymethylcellulose 0.5%", "dosage": "1 drop"}]},
                    headers=admin_headers)
    assert r.status_code == 201, r.text
    assert client.get(f"/api/visits/{v['id']}", headers=admin_headers).json()["diagnosisId"] == cat

    # changed on the visit -> the prescription follows (and so the standard counting)
    client.patch(f"/api/visits/{v['id']}", json={"diagnosisId": dry}, headers=admin_headers)
    assert client.get(f"/api/visits/{v['id']}/prescription", headers=admin_headers).json()["diagnosisId"] == dry

    # other fields leave it alone; an explicit null clears both
    r = client.patch(f"/api/visits/{v['id']}", json={"doctorNotes": "Tear film poor"}, headers=admin_headers)
    assert r.json()["diagnosisId"] == dry and r.json()["doctorNotes"] == "Tear film poor"
    r = client.patch(f"/api/visits/{v['id']}", json={"diagnosisId": None}, headers=admin_headers)
    assert r.json()["diagnosisId"] is None
    assert client.get(f"/api/visits/{v['id']}/prescription", headers=admin_headers).json()["diagnosisId"] is None

    assert client.patch(f"/api/visits/{v['id']}", json={"diagnosisId": 999999},
                        headers=admin_headers).status_code == 422


def test_follow_up_books_moves_and_clears_the_appointment(client, admin_headers):
    v = _visit(client, admin_headers, "Follow Up Patient", phone="98250 70001")
    r = client.put(f"/api/visits/{v['id']}/follow-up", json={"date": _day(14), "note": "IOP check"},
                   headers=admin_headers)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["followUpDate"] == _day(14) and out["followUpNote"] == "IOP check"
    appt = next(a for a in _appts(client, admin_headers, _day(14)) if a["sourceVisitId"] == v["id"])
    assert appt["id"] == out["followUpAppointmentId"]
    assert appt["name"] == "Follow Up Patient" and appt["phone"] == "98250 70001"
    assert appt["patientId"] == v["patientId"] and appt["note"] == "IOP check" and appt["checkedIn"] is False
    # the board shows it too
    board = next(x for x in client.get("/api/visits/today", headers=admin_headers).json() if x["id"] == v["id"])
    assert board["followUpDate"] == _day(14)

    # a new date moves the same appointment
    r = client.put(f"/api/visits/{v['id']}/follow-up", json={"date": _day(30)}, headers=admin_headers)
    assert r.json()["followUpDate"] == _day(30) and r.json()["followUpAppointmentId"] == appt["id"]
    assert not [a for a in _appts(client, admin_headers, _day(14)) if a["sourceVisitId"] == v["id"]]
    moved = [a for a in _appts(client, admin_headers, _day(30)) if a["sourceVisitId"] == v["id"]]
    assert [a["id"] for a in moved] == [appt["id"]] and moved[0]["note"] == ""

    # the same day as the visit (or earlier) is refused
    assert client.put(f"/api/visits/{v['id']}/follow-up", json={"date": _day(0)},
                      headers=admin_headers).status_code == 422
    assert client.put(f"/api/visits/{v['id']}/follow-up", json={"date": _day(-3)},
                      headers=admin_headers).status_code == 422

    # "No follow-up" removes the appointment
    r = client.delete(f"/api/visits/{v['id']}/follow-up", headers=admin_headers)
    assert r.status_code == 200 and r.json()["followUpDate"] is None and r.json()["followUpAppointmentId"] is None
    assert client.get(f"/api/appointments/{appt['id']}", headers=admin_headers).status_code == 404


def test_checked_in_follow_up_is_kept(client, admin_headers):
    v = _visit(client, admin_headers, "Checked In Follow Up")
    out = client.put(f"/api/visits/{v['id']}/follow-up", json={"date": _day(7), "note": "Review"},
                     headers=admin_headers).json()
    client.post(f"/api/visits/{v['id']}/complete", headers=admin_headers)
    r = client.post(f"/api/appointments/{out['followUpAppointmentId']}/checkin", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["visit"]["note"] == "Follow-up visit — Review"

    r = client.delete(f"/api/visits/{v['id']}/follow-up", headers=admin_headers)
    assert r.json()["followUpDate"] is None
    kept = client.get(f"/api/appointments/{out['followUpAppointmentId']}", headers=admin_headers)
    assert kept.status_code == 200 and kept.json()["checkedIn"] is True

    # booking again makes a fresh appointment rather than moving the checked-in one
    again = client.put(f"/api/visits/{v['id']}/follow-up", json={"date": _day(21)}, headers=admin_headers).json()
    assert again["followUpAppointmentId"] not in (None, out["followUpAppointmentId"])


def test_appointment_book_changes_flow_back_to_the_visit(client, admin_headers):
    v = _visit(client, admin_headers, "Moved From Book")
    out = client.put(f"/api/visits/{v['id']}/follow-up", json={"date": _day(10)}, headers=admin_headers).json()
    aid = out["followUpAppointmentId"]
    r = client.patch(f"/api/appointments/{aid}", json={"date": _day(12)}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["sourceVisitId"] == v["id"]
    assert client.get(f"/api/visits/{v['id']}", headers=admin_headers).json()["followUpDate"] == _day(12)

    assert client.delete(f"/api/appointments/{aid}", headers=admin_headers).status_code == 204
    assert client.get(f"/api/visits/{v['id']}", headers=admin_headers).json()["followUpDate"] is None


def test_several_diagnoses_per_visit(client, admin_headers):
    dx = _diagnoses(client, admin_headers)
    gl, dry, cat, bleph = dx["Glaucoma"], dx["Dry eye"], dx["Cataract"], dx["Blepharitis"]
    v = _visit(client, admin_headers, "Two Diagnoses")
    url = f"/api/visits/{v['id']}"
    assert v["diagnoses"] == [] and v["maxDiagnoses"] == 3

    # picked in order; the first is the main one; a repeat is dropped
    r = client.patch(url, json={"diagnosisIds": [gl, dry, gl]}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert [d["name"] for d in r.json()["diagnoses"]] == ["Glaucoma", "Dry eye"]
    assert r.json()["diagnosisId"] == gl and r.json()["diagnosisName"] == "Glaucoma"
    # more than the clinic's limit is refused
    r = client.patch(url, json={"diagnosisIds": [gl, dry, cat, bleph]}, headers=admin_headers)
    assert r.status_code == 422 and "At most 3" in r.json()["detail"]

    # a new prescription takes the visit's diagnoses; saving the old way with the main one keeps both
    r = client.post(f"{url}/prescription", json={"lines": [{"name": "Timolol 0.5%", "dosage": "1 drop BD"}]},
                    headers=admin_headers)
    assert [d["id"] for d in r.json()["diagnoses"]] == [gl, dry]
    r = client.post(f"{url}/prescription", json={"diagnosisId": gl, "lines": [{"name": "Timolol 0.5%"}]},
                    headers=admin_headers)
    assert [d["id"] for d in r.json()["diagnoses"]] == [gl, dry]
    # the prescription screen sends a new list -> the visit follows
    client.post(f"{url}/prescription", json={"diagnosisIds": [dry, cat], "lines": [{"name": "Timolol 0.5%"}]},
                headers=admin_headers)
    got = client.get(url, headers=admin_headers).json()
    assert [d["id"] for d in got["diagnoses"]] == [dry, cat] and got["diagnosisId"] == dry
    # changed on the visit -> the prescription follows; the old single field still works
    client.patch(url, json={"diagnosisIds": [cat]}, headers=admin_headers)
    assert [d["id"] for d in client.get(f"{url}/prescription", headers=admin_headers).json()["diagnoses"]] == [cat]
    r = client.patch(url, json={"diagnosisId": None}, headers=admin_headers)
    assert r.json()["diagnoses"] == [] and r.json()["diagnosisId"] is None

    # Admin sets the limit
    assert client.put("/api/admin/diagnoses/settings", json={"maxPerVisit": 1},
                      headers=admin_headers).json() == {"maxPerVisit": 1}
    assert client.get("/api/diagnoses/settings", headers=admin_headers).json() == {"maxPerVisit": 1}
    assert client.patch(url, json={"diagnosisIds": [gl, dry]}, headers=admin_headers).status_code == 422
    client.put("/api/admin/diagnoses/settings", json={"maxPerVisit": 3}, headers=admin_headers)


def test_history_and_combined_standard_with_several_diagnoses(client, admin_headers):
    a = client.post("/api/admin/diagnoses", json={"name": "Multi Dx A"}, headers=admin_headers).json()["id"]
    b = client.post("/api/admin/diagnoses", json={"name": "Multi Dx B"}, headers=admin_headers).json()["id"]

    def rx(name, ids, meds):
        v = _visit(client, admin_headers, name)
        r = client.post(f"/api/visits/{v['id']}/prescription",
                        json={"diagnosisIds": ids, "lines": [{"name": m, "dosage": "1 drop"} for m in meds]},
                        headers=admin_headers)
        assert r.status_code == 201, r.text

    rx("Multi One", [a], ["Drop Alpha"])
    rx("Multi Two", [a], ["Drop Alpha"])
    rx("Multi Three", [a, b], ["Drop Alpha", "Drop Beta"])
    rx("Multi Four", [a, b], ["Drop Alpha", "Drop Beta"])
    rx("Multi Five", [a, b], ["Drop Alpha", "Drop Beta"])

    counts = {d["id"]: d["prescriptionCount"] for d in client.get("/api/diagnoses", headers=admin_headers).json()}
    assert counts[a] == 5 and counts[b] == 3  # a mixed prescription counts for both
    # A on its own was prescribed twice: those decide A's standard (Drop Beta belongs to B)
    std_a = client.get(f"/api/diagnoses/{a}/standard", headers=admin_headers).json()
    assert std_a["historyCount"] == 2 and [l["name"] for l in std_a["lines"]] == ["Drop Alpha"]
    # B was never prescribed alone: the mixed ones are used
    std_b = client.get(f"/api/diagnoses/{b}/standard", headers=admin_headers).json()
    assert std_b["historyCount"] == 3 and [l["name"] for l in std_b["lines"]] == ["Drop Alpha", "Drop Beta"]

    # Both picked: A's medicines, then B's not already there
    both = client.get("/api/diagnoses/standard", params=[("ids", a), ("ids", b)], headers=admin_headers).json()
    assert [l["name"] for l in both["lines"]] == ["Drop Alpha", "Drop Beta"]
    assert [(p["diagnosisName"], p["source"], p["lines"]) for p in both["parts"]] == [
        ("Multi Dx A", "history", 1), ("Multi Dx B", "history", 2)]
    assert client.get("/api/diagnoses/standard", params={"ids": 999999}, headers=admin_headers).status_code == 404
