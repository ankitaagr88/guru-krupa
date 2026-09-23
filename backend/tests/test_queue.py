from datetime import date

import pytest
from sqlalchemy import select

from app.models import AuditLog, Patient, Visit
from app.seed.reference import seed_reference
from app.services import queue


@pytest.fixture(scope="module", autouse=True)
def _seed_and_clear_queue():
    """Seed stages and start from an empty visits table so tokens begin at #001."""
    from app.db import SessionLocal

    with SessionLocal() as db:
        seed_reference(db)
        for v in db.scalars(select(Visit)):
            db.delete(v)
        db.commit()


def _patient(client, headers, name, **extra):
    r = client.post("/api/patients", json={"name": name, **extra}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_unauthenticated(client):
    assert client.get("/api/visits/today").status_code == 401
    assert client.post("/api/visits", json={"patientId": 1}).status_code == 401


def test_register_tokens_and_duplicate(client, admin_headers):
    a = _patient(client, admin_headers, "Token One", note="Blurred vision", elsewhere=True)
    b = _patient(client, admin_headers, "Token Two")

    r = client.post("/api/visits", json={"patientId": a}, headers=admin_headers)
    assert r.status_code == 201, r.text
    v1 = r.json()
    assert v1["token"] == "#001" and v1["stage"] == "reg" and v1["status"] == "active"
    assert v1["date"] == date.today().isoformat()
    assert v1["note"] == "Blurred vision" and v1["elsewhere"] is True  # snapshot from the patient
    assert v1["patient"]["id"] == a and v1["patient"]["token"] == "#001" and v1["patient"]["stage"] == "reg"
    assert v1["dilation"] is None and v1["hasBill"] is False and v1["readingsCount"] == 0
    assert isinstance(v1["waitingSeconds"], int) and v1["waitingSeconds"] >= 0
    assert v1["stageEnteredAt"].endswith(("+00:00", "Z"))
    # visit kind (lane E2): a first visit is a new patient; no earlier visit -> no day count
    assert v1["visitKindKey"] == "new" and v1["visitKindLabel"] == "New patient"
    assert v1["daysSinceLastVisit"] is None and v1["feeReason"] == "No earlier visit on record"

    v2 = client.post("/api/visits", json={"patientId": b, "note": "Routine"}, headers=admin_headers).json()
    assert v2["token"] == "#002" and v2["note"] == "Routine"

    assert client.post("/api/visits", json={"patientId": a}, headers=admin_headers).status_code == 409
    assert client.post("/api/visits", json={"patientId": 999999}, headers=admin_headers).status_code == 404

    # after completing, the patient can be registered again with a fresh token
    client.post(f"/api/visits/{v1['id']}/complete", headers=admin_headers)
    v3 = client.post("/api/visits", json={"patientId": a}, headers=admin_headers).json()
    assert v3["token"] == "#003"


def test_move_stages_with_audit(client, admin_headers, db):
    pid = _patient(client, admin_headers, "Mover")
    v = client.post("/api/visits", json={"patientId": pid}, headers=admin_headers).json()
    vid = v["id"]

    r = client.post(f"/api/visits/{vid}/move", json={"stage": "pretest"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["stage"] == "pretest" and r.json()["status"] == "active"
    assert r.json()["stageEnteredAt"] >= v["stageEnteredAt"]

    for s in ("doctor", "dilate", "doctor", "billing"):
        assert client.post(f"/api/visits/{vid}/move", json={"stage": s}, headers=admin_headers).json()["stage"] == s

    assert client.post(f"/api/visits/{vid}/move", json={"stage": "nope"}, headers=admin_headers).status_code == 400
    assert client.post(f"/api/visits/{vid}/move", json={}, headers=admin_headers).status_code == 422
    assert client.post("/api/visits/999999/move", json={"stage": "reg"}, headers=admin_headers).status_code == 404

    r = client.post(f"/api/visits/{vid}/move", json={"stage": "done"}, headers=admin_headers)
    body = r.json()
    assert body["stage"] == "done" and body["status"] == "completed" and body["completedAt"]
    # "Last visit" means the previous completed visit, not the one just finished (first-timer -> none)
    assert body["patient"]["lastVisitDate"] is None

    rows = list(db.scalars(select(AuditLog).where(AuditLog.entity == "visit", AuditLog.entity_id == vid)
                           .order_by(AuditLog.id)))
    assert [(a.detail["from"], a.detail["to"]) for a in rows] == [
        ("reg", "pretest"), ("pretest", "doctor"), ("doctor", "dilate"), ("dilate", "doctor"),
        ("doctor", "billing"), ("billing", "done")]
    assert all(a.action == "stage_move" and a.staff_id is not None for a in rows)


def test_complete_alias_and_get(client, admin_headers):
    pid = _patient(client, admin_headers, "Completer")
    vid = client.post("/api/visits", json={"patientId": pid}, headers=admin_headers).json()["id"]
    r = client.post(f"/api/visits/{vid}/complete", headers=admin_headers)
    assert r.status_code == 200 and r.json()["status"] == "completed" and r.json()["stage"] == "done"
    r = client.get(f"/api/visits/{vid}", headers=admin_headers)
    assert r.status_code == 200 and r.json()["completedAt"] and r.json()["patient"]["name"] == "Completer"
    assert client.get("/api/visits/999999", headers=admin_headers).status_code == 404


def test_va_and_patch(client, admin_headers):
    pid = _patient(client, admin_headers, "Va Person")
    vid = client.post("/api/visits", json={"patientId": pid}, headers=admin_headers).json()["id"]
    r = client.patch(f"/api/visits/{vid}/va", json={"R": "6/18", "L": "6/24"}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["va"] == {"R": "6/18", "L": "6/24"}
    r = client.patch(f"/api/visits/{vid}", json={"doctorNotes": "IOP high", "elsewhere": True,
                                                 "elsewhereNote": "Rajkot 2018"}, headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["doctorNotes"] == "IOP high" and r.json()["elsewhere"] is True
    assert r.json()["elsewhereNote"] == "Rajkot 2018" and r.json()["va"]["R"] == "6/18"


def test_today_board_and_filter(client, admin_headers):
    pid = _patient(client, admin_headers, "Board Person")
    vid = client.post("/api/visits", json={"patientId": pid}, headers=admin_headers).json()["id"]
    client.post(f"/api/visits/{vid}/move", json={"stage": "dilate"}, headers=admin_headers)

    r = client.get("/api/visits/today", headers=admin_headers)
    assert r.status_code == 200
    rows = r.json()
    assert vid in [x["id"] for x in rows]
    entered = [x["stageEnteredAt"] for x in rows]
    assert entered == sorted(entered)
    assert all(x["waitingSeconds"] >= 0 for x in rows)
    assert all(x["date"] == date.today().isoformat() for x in rows)

    only = client.get("/api/visits/today?stage=dilate", headers=admin_headers).json()
    assert [x["id"] for x in only] == [vid] and only[0]["patient"]["name"] == "Board Person"
    assert client.get("/api/visits/today?stage=nothing", headers=admin_headers).json() == []


def test_services_direct(db, admin_user):
    """Later modules (appointments check-in, dilation) call the service layer without HTTP."""
    p = Patient(name="Direct Caller")
    db.add(p)
    db.commit()
    v = queue.register_visit(db, p, note="via service")
    assert v.token.startswith("#") and v.stage_key == "reg" and v.note == "via service"
    with pytest.raises(queue.ActiveVisitExists):
        queue.register_visit(db, p)
    with pytest.raises(queue.UnknownStage):
        queue.move_stage(db, v, "bogus", admin_user)
    queue.move_stage(db, v, "done", admin_user.id)
    assert v.status == "completed" and v.completed_at is not None


def test_today_counts(client, admin_headers):
    r = client.get("/api/visits/today/counts", headers=admin_headers)
    assert r.status_code == 200
    counts = r.json()
    assert "reg" in counts and all(isinstance(n, int) for n in counts.values())
    assert sum(counts.values()) == len(client.get("/api/visits/today", headers=admin_headers).json())
