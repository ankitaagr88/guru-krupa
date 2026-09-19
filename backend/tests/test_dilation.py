from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import AuditLog
from app.seed.reference import PROTOCOL_STEPS, seed_reference


@pytest.fixture(scope="module", autouse=True)
def _seed():
    """Seed the protocol/stages; on teardown drop the audit rows this module wrote.

    test_queue empties the visits table and SQLite reuses the ids, so stage-move audit rows left
    behind here would otherwise show up under a later test's visit."""
    from sqlalchemy import func

    from app.db import SessionLocal

    with SessionLocal() as db:
        seed_reference(db)
        last_audit = db.scalar(select(func.max(AuditLog.id))) or 0
    yield
    with SessionLocal() as db:
        for row in db.scalars(select(AuditLog).where(AuditLog.id > last_audit)):
            db.delete(row)
        db.commit()


@pytest.fixture
def visit(client, admin_headers):
    """A fresh patient + today's visit at `reg`."""
    pid = client.post("/api/patients", json={"name": "Dilation Person"}, headers=admin_headers).json()["id"]
    r = client.post("/api/visits", json={"patientId": pid}, headers=admin_headers)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def doctor_headers(client, db):
    from app.auth.service import ensure_user

    ensure_user(db, username="dil_doctor", password="pw12345", name="Doc", role="doctor")
    r = client.post("/api/auth/login", json={"username": "dil_doctor", "password": "pw12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def reception_headers(client, db):
    from app.auth.service import ensure_user

    ensure_user(db, username="dil_reception", password="pw12345", name="Front", role="reception")
    r = client.post("/api/auth/login", json={"username": "dil_reception", "password": "pw12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def test_unauthenticated(client):
    assert client.get("/api/visits/1/dilation").status_code == 401
    assert client.post("/api/visits/1/dilation/start").status_code == 401


def test_start_copies_protocol_and_moves_stage(client, admin_headers, visit, db):
    vid = visit["id"]
    assert visit["stage"] == "reg" and visit["dilation"] is None
    assert client.get(f"/api/visits/{vid}/dilation", headers=admin_headers).status_code == 404

    r = client.post(f"/api/visits/{vid}/dilation/start", headers=admin_headers)
    assert r.status_code == 201, r.text
    run = r.json()
    assert run["visitId"] == vid and run["currentIndex"] == 0 and run["complete"] is False
    assert [(s["name"], s["min"]) for s in run["steps"]] == PROTOCOL_STEPS  # the 2 seeded steps, in order
    s0, s1 = run["steps"]
    assert s0["given"] is False and s0["done"] is False and s0["startedAt"] is None
    # ticking step 0 stamps startedAt and dueAt
    s0 = client.post(f"/api/visits/{vid}/dilation/steps/0/given", headers=admin_headers).json()["steps"][0]
    assert s0["given"] is True and s0["startedAt"]
    assert _iso(s0["dueAt"]) - _iso(s0["startedAt"]) == timedelta(minutes=s0["min"])
    run["steps"][0] = s0
    assert s1 == {"name": PROTOCOL_STEPS[1][0], "min": PROTOCOL_STEPS[1][1], "given": False, "startedAt": None,
                  "done": False, "dueAt": None}
    assert set(s0) == {"name", "min", "given", "startedAt", "done", "dueAt"}

    # the visit was moved to `dilate` with an audit row, and VisitOut now carries the run
    v = client.get(f"/api/visits/{vid}", headers=admin_headers).json()
    assert v["stage"] == "dilate" and v["status"] == "active"
    assert v["dilation"]["currentIndex"] == 0 and len(v["dilation"]["steps"]) == 2
    assert v["dilation"]["steps"][0]["given"] is True  # ticked above
    rows = list(db.scalars(select(AuditLog).where(AuditLog.entity == "visit", AuditLog.entity_id == vid)))
    assert [(a.detail["from"], a.detail["to"]) for a in rows] == [("reg", "dilate")]

    # GET mirrors the start payload; a second start is a conflict
    g = client.get(f"/api/visits/{vid}/dilation", headers=admin_headers).json()
    assert g == run
    assert client.post(f"/api/visits/{vid}/dilation/start", headers=admin_headers).status_code == 409
    assert client.post("/api/visits/999999/dilation/start", headers=admin_headers).status_code == 404


def test_step_sequencing_and_complete(client, admin_headers, visit):
    vid = visit["id"]
    client.post(f"/api/visits/{vid}/move", json={"stage": "dilate"}, headers=admin_headers)
    run = client.post(f"/api/visits/{vid}/dilation/start", headers=admin_headers).json()
    assert run["currentIndex"] == 0 and run["steps"][0]["given"] is False

    # done before given is out of order; give step 0, then giving it again or touching step 1 is out of order
    assert client.post(f"/api/visits/{vid}/dilation/steps/0/done", headers=admin_headers).status_code == 409
    assert client.post(f"/api/visits/{vid}/dilation/steps/0/given", headers=admin_headers).status_code == 200
    assert client.post(f"/api/visits/{vid}/dilation/steps/0/given", headers=admin_headers).status_code == 409
    assert client.post(f"/api/visits/{vid}/dilation/steps/1/given", headers=admin_headers).status_code == 409
    assert client.post(f"/api/visits/{vid}/dilation/steps/1/done", headers=admin_headers).status_code == 409
    assert client.post(f"/api/visits/{vid}/dilation/steps/5/done", headers=admin_headers).status_code == 404

    r = client.post(f"/api/visits/{vid}/dilation/steps/0/done", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["currentIndex"] == 1 and body["complete"] is False
    assert body["steps"][0]["done"] is True and body["steps"][1]["given"] is False

    # step 1: must be given before done; step 0 is no longer current
    assert client.post(f"/api/visits/{vid}/dilation/steps/1/done", headers=admin_headers).status_code == 409
    assert client.post(f"/api/visits/{vid}/dilation/steps/0/done", headers=admin_headers).status_code == 409
    r = client.post(f"/api/visits/{vid}/dilation/steps/1/given", headers=admin_headers)
    assert r.status_code == 200, r.text
    s1 = r.json()["steps"][1]
    assert s1["given"] is True and s1["startedAt"] and s1["done"] is False
    assert _iso(s1["dueAt"]) - _iso(s1["startedAt"]) == timedelta(minutes=PROTOCOL_STEPS[1][1])
    assert r.json()["currentIndex"] == 1

    r = client.post(f"/api/visits/{vid}/dilation/steps/1/done", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["complete"] is True and body["currentIndex"] == 2
    assert all(s["given"] and s["done"] for s in body["steps"])

    # nothing left to tick
    assert client.post(f"/api/visits/{vid}/dilation/steps/2/given", headers=admin_headers).status_code == 404
    g = client.get(f"/api/visits/{vid}/dilation", headers=admin_headers).json()
    assert g["complete"] is True
    # stage is untouched by the run completing (the doctor moves them on)
    assert client.get(f"/api/visits/{vid}", headers=admin_headers).json()["stage"] == "dilate"


def test_cancel_and_restart(client, admin_headers, reception_headers, doctor_headers, visit):
    vid = visit["id"]
    assert client.delete(f"/api/visits/{vid}/dilation", headers=doctor_headers).status_code == 404
    # reception (any staff) can start
    assert client.post(f"/api/visits/{vid}/dilation/start", headers=reception_headers).status_code == 201
    # ...but only admin/doctor can cancel
    assert client.delete(f"/api/visits/{vid}/dilation", headers=reception_headers).status_code == 403
    assert client.delete(f"/api/visits/{vid}/dilation", headers=doctor_headers).status_code == 204
    assert client.get(f"/api/visits/{vid}/dilation", headers=admin_headers).status_code == 404
    assert client.get(f"/api/visits/{vid}", headers=admin_headers).json()["dilation"] is None

    # restart after reset: fresh run at index 0, visit already at dilate so no extra stage move
    r = client.post(f"/api/visits/{vid}/dilation/start", headers=admin_headers)
    assert r.status_code == 201 and r.json()["currentIndex"] == 0 and r.json()["steps"][1]["given"] is False
    assert client.delete(f"/api/visits/{vid}/dilation", headers=admin_headers).status_code == 204
