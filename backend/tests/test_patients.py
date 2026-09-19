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
