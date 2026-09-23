import pytest

from app.seed.reference import seed_reference

NEW = {"name": "Rasilaben Qureshi", "age": 62, "sex": "F", "phone": "98250 12345", "address": "Vesu, Surat",
       "occupation": "Homemaker", "screenHours": 1, "language": "gujarati", "elsewhere": True,
       "elsewhereNote": "Cataract op, Rajkot", "referralSource": "doctor", "referralDetail": "Dr. Shah",
       "existingConditions": ["Diabetes", "Hypertension"], "conditionOther": ""}


@pytest.fixture(scope="module", autouse=True)
def _seed():
    from app.db import SessionLocal

    with SessionLocal() as db:
        seed_reference(db)


def test_unauthenticated(client):
    assert client.post("/api/patients", json=NEW).status_code == 401
    assert client.get("/api/patients?q=x").status_code == 401


def test_create_search_get_patch(client, admin_headers):
    r = client.post("/api/patients", json=NEW, headers=admin_headers)
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["name"] == "Rasilaben Qureshi" and p["screenHours"] == 1
    assert p["referralSource"] == "doctor" and p["referralDetail"] == "Dr. Shah"
    assert p["existingConditions"] == ["Diabetes", "Hypertension"]
    assert p["lastVisitDate"] is None and p["stage"] is None and p["token"] is None
    assert "created_at" not in p and p["createdAt"].endswith(("+00:00", "Z"))
    pid = p["id"]

    # search by name (case-insensitive) and by phone fragment
    assert [x["id"] for x in client.get("/api/patients?q=rasilaben qu", headers=admin_headers).json()] == [pid]
    assert pid in [x["id"] for x in client.get("/api/patients?q=98250", headers=admin_headers).json()]
    assert client.get("/api/patients?q=", headers=admin_headers).json() == []
    assert client.get("/api/patients?q=zzz-nobody", headers=admin_headers).json() == []

    r = client.get(f"/api/patients/{pid}", headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["visits"] == [] and r.json()["name"] == "Rasilaben Qureshi"

    r = client.patch(f"/api/patients/{pid}", json={"age": 63, "sex": "F", "language": "hindi",
                                                   "existingConditions": ["Asthma"], "referralSource": "self",
                                                   "conditionOther": "Migraine"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["age"] == 63 and p["language"] == "hindi" and p["name"] == "Rasilaben Qureshi"
    assert p["existingConditions"] == ["Asthma"] and p["referralSource"] == "self" and p["conditionOther"] == "Migraine"
    r = client.patch(f"/api/patients/{pid}", json={"referralSource": None}, headers=admin_headers)
    assert r.json()["referralSource"] is None


def test_min_create_and_validation(client, admin_headers):
    r = client.post("/api/patients", json={"name": "Only Name"}, headers=admin_headers)
    assert r.status_code == 201 and r.json()["existingConditions"] == [] and r.json()["note"] == ""
    assert client.post("/api/patients", json={"name": ""}, headers=admin_headers).status_code == 422
    assert client.post("/api/patients", json={"name": "X", "referralSource": "nope"},
                       headers=admin_headers).status_code == 422


def test_404s(client, admin_headers):
    assert client.get("/api/patients/999999", headers=admin_headers).status_code == 404
    assert client.patch("/api/patients/999999", json={"age": 1}, headers=admin_headers).status_code == 404


def test_history_after_visit(client, admin_headers):
    pid = client.post("/api/patients", json={"name": "History Person", "phone": "1112223334"},
                      headers=admin_headers).json()["id"]
    v = client.post("/api/visits", json={"patientId": pid}, headers=admin_headers).json()
    client.patch(f"/api/visits/{v['id']}/va", json={"R": "6/9", "L": "6/6"}, headers=admin_headers)

    p = client.get(f"/api/patients/{pid}", headers=admin_headers).json()
    assert p["stage"] == "reg" and p["token"] == v["token"] and p["visitId"] == v["id"]
    assert p["lastVisitDate"] is None  # not completed yet
    assert len(p["visits"]) == 1
    h = p["visits"][0]
    assert h["va"] == {"R": "6/9", "L": "6/6"} and h["readingsCount"] == 0
    assert h["hasPrescription"] is False and h["hasBill"] is False and h["stage"] == "reg"

    client.post(f"/api/visits/{v['id']}/complete", headers=admin_headers)
    p = client.get(f"/api/patients/{pid}", headers=admin_headers).json()
    assert p["lastVisitDate"] == v["date"] and p["stage"] is None
    assert p["visits"][0]["status"] == "completed" and p["visits"][0]["completedAt"]
    # search result carries lastVisitDate too (lookupLastVisit)
    hit = client.get("/api/patients?q=1112223334", headers=admin_headers).json()[0]
    assert hit["lastVisitDate"] == v["date"]


def test_full_history_endpoint(client, admin_headers):
    from app.services.queue import today

    pid = client.post("/api/patients", json={"name": "History Person", "age": 50, "sex": "F", "phone": "9000000001"},
                      headers=admin_headers).json()["id"]
    vid = client.post("/api/visits", json={"patientId": pid}, headers=admin_headers).json()["id"]
    client.post("/api/readings/manual", json={"visitId": vid, "machineKey": "tbut_schirmer",
                                              "values": [{"l": "TBUT (R)", "v": "8"}]}, headers=admin_headers)
    client.post(f"/api/visits/{vid}/prescription", json={"lines": [{"name": "Timolol 0.5% eye drops", "dosage": "2x"}]},
                headers=admin_headers)
    client.put(f"/api/visits/{vid}/bill", json={"items": [{"label": "Consultation", "amount": 500}]}, headers=admin_headers)
    client.post("/api/ot/cases", json={"patientId": pid, "date": today().isoformat(), "timeSlot": "3:00 PM",
                                       "procedure": "LASIK"}, headers=admin_headers)
    client.post("/api/appointments", json={"name": "History Person", "phone": "9000000001", "patientId": pid,
                                           "date": today().isoformat(), "channel": "call"}, headers=admin_headers)

    r = client.get(f"/api/patients/{pid}/history", headers=admin_headers)
    assert r.status_code == 200, r.text
    h = r.json()
    assert h["patient"]["id"] == pid and h["patient"]["name"] == "History Person"
    assert h["totals"] == {"visits": 1, "prescriptions": 1, "surgeries": 1, "readings": 1}
    v = h["visits"][0]
    assert v["id"] == vid and v["readings"][0]["machineKey"] == "tbut_schirmer"
    assert v["prescription"]["lines"][0]["name"] == "Timolol 0.5% eye drops"
    assert v["bill"]["items"][0]["amount"] == 500
    assert h["otCases"][0]["procedure"] == "LASIK"
    assert h["appointments"][0]["channel"] == "call"
    assert client.get("/api/patients/999999/history", headers=admin_headers).status_code == 404


def test_age_from_dob_or_recorded_age():
    """Session-3 groundwork: `age` is worked out from the DOB when known; a told age grows with the
    calendar from the day it was told."""
    from datetime import date

    from app.models import Patient

    today = date.today()
    p = Patient(name="Age Check", dob=date(today.year - 30, 1, 1))
    assert p.age == 30
    q = Patient(name="Told Age", age=50)
    assert q.age == 50 and q.age_recorded == 50 and q.age_recorded_on == today
    q.age_recorded_on = date(today.year - 3, 1, 1)
    assert q.age == 53
    q.age = None
    assert q.age is None and q.age_recorded_on is None


def test_by_phone_matches_last_ten_digits(client, admin_headers):
    """New-patient duplicate check: numbers typed with spaces / +91 / dashes all match the same 10 digits."""
    def mk(name, phone):
        return client.post("/api/patients", json={"name": name, "phone": phone, "age": 40, "sex": "F"},
                           headers=admin_headers).json()["id"]

    a = mk("Phone Mother", "+91 97111 22233")
    b = mk("Phone Son", "9711122233")
    c = mk("Phone Aunt", "097111-22233")
    other = mk("Phone Other", "9711122234")
    vid = client.post("/api/visits", json={"patientId": b}, headers=admin_headers).json()

    r = client.get("/api/patients/by-phone", params={"phone": "97111 22233"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    got = {p["id"]: p for p in r.json()}
    assert set(got) == {a, b, c} and other not in got
    assert got[b]["token"] == vid["token"] and got[b]["stage"] == "reg" and got[b]["visitId"] == vid["id"]
    assert got[a]["age"] == 40 and got[a]["sex"] == "F" and got[a]["lastVisitDate"] is None
    assert {p["id"] for p in client.get("/api/patients/by-phone", params={"phone": "+919711122233"},
                                        headers=admin_headers).json()} == {a, b, c}
    # fewer than 10 digits: no lookup
    assert client.get("/api/patients/by-phone", params={"phone": "97111"}, headers=admin_headers).json() == []
    assert client.get("/api/patients/by-phone", params={"phone": "9000000999"}, headers=admin_headers).json() == []
    assert client.get("/api/patients/by-phone?phone=9711122233").status_code == 401


def test_dob_sets_age_and_is_validated(client, admin_headers):
    from datetime import date, timedelta

    today = date.today()
    dob = date(today.year - 62, 1, 1)
    r = client.post("/api/patients", json={"name": "Dob Person", "dob": dob.isoformat(), "age": 10},
                    headers=admin_headers)
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["dob"] == dob.isoformat() and p["age"] == 62  # DOB wins over the typed age
    pid = p["id"]

    # future / too old -> 422 with a plain message
    bad = client.post("/api/patients", json={"name": "X", "dob": (today + timedelta(days=1)).isoformat()},
                      headers=admin_headers)
    assert bad.status_code == 422 and "future" in bad.text
    bad = client.patch(f"/api/patients/{pid}", json={"dob": "1850-01-01"}, headers=admin_headers)
    assert bad.status_code == 422 and "120 years" in bad.text

    # change the DOB -> age follows
    r = client.patch(f"/api/patients/{pid}", json={"dob": date(today.year - 30, 1, 1).isoformat()},
                     headers=admin_headers)
    assert r.json()["age"] == 30
    # the age corrected on its own drops the (wrong) DOB
    r = client.patch(f"/api/patients/{pid}", json={"age": 45}, headers=admin_headers)
    assert r.json()["dob"] is None and r.json()["age"] == 45
    # clearing the DOB with an age sent falls back to the told age
    client.patch(f"/api/patients/{pid}", json={"dob": date(today.year - 30, 1, 1).isoformat()}, headers=admin_headers)
    r = client.patch(f"/api/patients/{pid}", json={"dob": None, "age": 51}, headers=admin_headers)
    assert r.json()["dob"] is None and r.json()["age"] == 51
    # without a DOB the told age is kept as before
    assert client.post("/api/patients", json={"name": "Age Only", "age": 70}, headers=admin_headers).json()["age"] == 70
