from datetime import timedelta

import pytest

from app.seed.reference import seed_reference
from app.services.queue import today


@pytest.fixture(scope="module", autouse=True)
def _seed():
    from app.db import SessionLocal

    with SessionLocal() as db:
        seed_reference(db)


@pytest.fixture
def reception_headers(client, db):
    from app.auth.service import ensure_user

    ensure_user(db, username="appt_reception", password="pw12345", name="Front Desk", role="reception")
    r = client.post("/api/auth/login", json={"username": "appt_reception", "password": "pw12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def optometrist_headers(client, db):
    from app.auth.service import ensure_user

    ensure_user(db, username="appt_opto", password="pw12345", name="Opto", role="optometrist")
    r = client.post("/api/auth/login", json={"username": "appt_opto", "password": "pw12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _day(offset: int) -> str:
    return (today() + timedelta(days=offset)).isoformat()


def _add(client, headers, name, **extra):
    r = client.post("/api/appointments", json={"name": name, **extra}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def test_unauthenticated(client):
    assert client.get("/api/appointments").status_code == 401
    assert client.post("/api/appointments", json={"name": "x"}).status_code == 401
    assert client.get("/api/appointments/counts?from=2026-01-01&to=2026-01-02").status_code == 401


def test_crud(client, admin_headers):
    a = _add(client, admin_headers, "Priya Mehta", phone="98250 11223", channel="whatsapp")
    assert a["date"] == _day(0) and a["channel"] == "whatsapp" and a["checkedIn"] is False
    assert a["patientId"] is None and a["visitId"] is None and a["createdAt"]
    assert set(a) == {"id", "name", "phone", "date", "channel", "checkedIn", "patientId", "visitId", "createdAt",
                      "note", "sourceVisitId"}
    assert a["note"] == "" and a["sourceVisitId"] is None

    b = _add(client, admin_headers, "Kishor Panchal", phone="98980 33221", date=_day(1), channel="call")
    assert b["date"] == _day(1)

    # default listing is today; explicit date filters
    ids_today = [x["id"] for x in client.get("/api/appointments", headers=admin_headers).json()]
    assert a["id"] in ids_today and b["id"] not in ids_today
    ids_tmrw = [x["id"] for x in client.get(f"/api/appointments?date={_day(1)}", headers=admin_headers).json()]
    assert b["id"] in ids_tmrw and a["id"] not in ids_tmrw

    r = client.get(f"/api/appointments/{a['id']}", headers=admin_headers)
    assert r.status_code == 200 and r.json()["name"] == "Priya Mehta"

    r = client.patch(f"/api/appointments/{b['id']}", json={"channel": "walkin", "date": _day(2), "name": "K. Panchal"},
                     headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["channel"] == "walkin" and r.json()["date"] == _day(2) and r.json()["name"] == "K. Panchal"

    assert client.delete(f"/api/appointments/{b['id']}", headers=admin_headers).status_code == 204
    assert client.get(f"/api/appointments/{b['id']}", headers=admin_headers).status_code == 404
    assert client.delete(f"/api/appointments/{b['id']}", headers=admin_headers).status_code == 404


def test_validation(client, admin_headers):
    r = client.post("/api/appointments", json={"name": "Late", "date": _day(-1)}, headers=admin_headers)
    assert r.status_code == 422
    assert client.post("/api/appointments", json={"name": "Bad", "channel": "fax"}, headers=admin_headers).status_code == 422
    assert client.post("/api/appointments", json={"name": ""}, headers=admin_headers).status_code == 422
    assert client.post("/api/appointments", json={"name": "Ghost", "patientId": 999999},
                       headers=admin_headers).status_code == 404
    a = _add(client, admin_headers, "Future", date=_day(3))
    assert client.patch(f"/api/appointments/{a['id']}", json={"date": _day(-2)}, headers=admin_headers).status_code == 422
    assert client.patch(f"/api/appointments/{a['id']}", json={"channel": "pigeon"}, headers=admin_headers).status_code == 422
    assert client.get(f"/api/appointments/{a['id']}", headers=admin_headers).json()["date"] == _day(3)


def test_roles(client, admin_headers, reception_headers, optometrist_headers):
    # reception (FRONT_DESK) may book; optometrist may only read
    a = _add(client, reception_headers, "Booked by reception")
    assert client.get("/api/appointments", headers=optometrist_headers).status_code == 200
    assert client.post("/api/appointments", json={"name": "Nope"}, headers=optometrist_headers).status_code == 403
    assert client.post(f"/api/appointments/{a['id']}/checkin", headers=optometrist_headers).status_code == 403
    assert client.delete(f"/api/appointments/{a['id']}", headers=optometrist_headers).status_code == 403
    assert client.delete(f"/api/appointments/{a['id']}", headers=reception_headers).status_code == 204


def test_counts(client, admin_headers):
    base = 10  # a slice of days far enough ahead that other tests do not touch it
    _add(client, admin_headers, "C1", date=_day(base))
    _add(client, admin_headers, "C2", date=_day(base))
    _add(client, admin_headers, "C3", date=_day(base + 2))
    r = client.get(f"/api/appointments/counts?from={_day(base)}&to={_day(base + 3)}", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert list(body) == [_day(base), _day(base + 1), _day(base + 2), _day(base + 3)]
    assert body[_day(base)] == {"total": 2, "checkedIn": 0}
    assert body[_day(base + 1)] == {"total": 0, "checkedIn": 0}
    assert body[_day(base + 2)] == {"total": 1, "checkedIn": 0}

    assert client.get(f"/api/appointments/counts?from={_day(0)}&to={_day(40)}", headers=admin_headers).status_code == 422
    assert client.get("/api/appointments/counts?from=x&to=y", headers=admin_headers).status_code == 422
    assert client.get(f"/api/appointments/counts?from={_day(0)}", headers=admin_headers).status_code == 422


def test_checkin_creates_patient_and_visit(client, admin_headers):
    a = _add(client, admin_headers, "Suresh Bhatt", phone="99250 44556", channel="call")
    r = client.post(f"/api/appointments/{a['id']}/checkin", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    appt, visit = body["appointment"], body["visit"]
    assert appt["checkedIn"] is True and appt["patientId"] and appt["visitId"] == visit["id"]
    assert visit["stage"] == "reg" and visit["status"] == "active" and visit["date"] == _day(0)
    assert visit["token"].startswith("#") and len(visit["token"]) == 4
    assert visit["patientId"] == appt["patientId"]
    assert visit["note"] == "Appointment booked via phone call"
    p = visit["patient"]
    assert p["name"] == "Suresh Bhatt" and p["phone"] == "99250 44556" and p["referralSource"] is None
    assert p["token"] == visit["token"] and p["stage"] == "reg"

    # patient record exists and is searchable
    found = client.get("/api/patients?q=99250 44556", headers=admin_headers).json()
    assert [x["id"] for x in found] == [appt["patientId"]]

    # listing shows checkedIn + visitId; counts reflect it
    listed = {x["id"]: x for x in client.get("/api/appointments", headers=admin_headers).json()}
    assert listed[a["id"]]["checkedIn"] is True and listed[a["id"]]["visitId"] == visit["id"]
    c = client.get(f"/api/appointments/counts?from={_day(0)}&to={_day(0)}", headers=admin_headers).json()
    assert c[_day(0)]["checkedIn"] >= 1 and c[_day(0)]["total"] >= c[_day(0)]["checkedIn"]

    # double check-in and deleting a checked-in appointment are conflicts
    assert client.post(f"/api/appointments/{a['id']}/checkin", headers=admin_headers).status_code == 409
    assert client.delete(f"/api/appointments/{a['id']}", headers=admin_headers).status_code == 409
    assert client.post("/api/appointments/999999/checkin", headers=admin_headers).status_code == 404


def test_checkin_by_phone_reuses_patient(client, admin_headers):
    r = client.post("/api/patients", json={"name": "Anjali Rathod", "phone": "97250 77889"}, headers=admin_headers)
    assert r.status_code == 201
    pid = r.json()["id"]

    a = _add(client, admin_headers, "Anjali R.", phone="97250 77889", channel="walkin")
    r = client.post(f"/api/appointments/{a['id']}/checkin", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["appointment"]["patientId"] == pid and r.json()["visit"]["patientId"] == pid
    assert r.json()["visit"]["patient"]["name"] == "Anjali Rathod"  # existing record, not renamed

    # a second appointment for the same phone today: the patient already has an active visit -> 409
    b = _add(client, admin_headers, "Anjali again", phone="97250 77889")
    assert client.post(f"/api/appointments/{b['id']}/checkin", headers=admin_headers).status_code == 409
    assert client.get(f"/api/appointments/{b['id']}", headers=admin_headers).json()["checkedIn"] is False


def test_checkin_by_patient_id(client, admin_headers):
    pid = client.post("/api/patients", json={"name": "Linked Person"}, headers=admin_headers).json()["id"]
    a = _add(client, admin_headers, "Linked Person", patientId=pid)
    assert a["patientId"] == pid
    r = client.post(f"/api/appointments/{a['id']}/checkin", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["visit"]["patientId"] == pid and r.json()["visit"]["stage"] == "reg"
