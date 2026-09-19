import pytest
from sqlalchemy import select

from app.models import AuditLog, Patient, ReferralSource
from app.seed.reference import CONDITIONS, seed_reference


@pytest.fixture(scope="module", autouse=True)
def _seed():
    from app.db import SessionLocal

    with SessionLocal() as db:
        seed_reference(db)
    yield
    with SessionLocal() as db:  # leave the reference tables as seeded for test_models
        for p in db.scalars(select(Patient).where(Patient.name == "Banner Walk-in")):
            db.delete(p)
        for s in db.scalars(select(ReferralSource).where(ReferralSource.key == "hoarding")):
            db.delete(s)
        db.commit()


@pytest.fixture
def reception_headers(client, db):
    from app.auth.service import ensure_user

    ensure_user(db, username="adm_recep", password="rec123", name="Reception", role="reception")
    r = client.post("/api/auth/login", json={"username": "adm_recep", "password": "rec123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _login(client, username, password):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_config_shape(client, admin_headers, reception_headers):
    assert client.get("/api/config").status_code == 401
    r = client.get("/api/config", headers=reception_headers)
    assert r.status_code == 200, r.text
    c = r.json()
    assert set(c) == {"stages", "protocolSteps", "referralSources", "lensTiers", "conditions"}
    assert [s["key"] for s in c["stages"]][:2] == ["reg", "pretest"] and c["stages"][-1]["key"] == "done"
    assert {"id", "key", "label", "cls", "sortOrder"} <= set(c["stages"][0])
    assert c["protocolSteps"][0]["name"] == "Tropicamide 0.8%" and c["protocolSteps"][0]["minutes"] == 5
    src = next(s for s in c["referralSources"] if s["key"] == "doctor")
    assert src["needsDetail"] is True and src["label"] == "Referred by another doctor"
    assert next(s for s in c["referralSources"] if s["key"] == "self")["needsDetail"] is False
    assert {t["key"]: t["price"] for t in c["lensTiers"]}["monofocal"] == 28500
    assert c["conditions"] == CONDITIONS


def test_stage_crud_reorder_and_active_visit_block(client, admin_headers, db):
    r = client.post("/api/admin/stages", json={"key": "counsel", "label": "Counselling"}, headers=admin_headers)
    assert r.status_code == 201, r.text
    assert r.json()["cls"] == "counsel"
    keys = [s["key"] for s in client.get("/api/admin/stages", headers=admin_headers).json()]
    assert keys[-2:] == ["counsel", "done"]  # inserted before the last stage, like `addStage`
    assert client.post("/api/admin/stages", json={"key": "counsel", "label": "Dup"}, headers=admin_headers).status_code == 409
    assert client.post("/api/admin/stages", json={"key": "Bad Key", "label": "x"}, headers=admin_headers).status_code == 422

    r = client.patch("/api/admin/stages/counsel", json={"label": "Counselling desk", "cls": "billing"}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["label"] == "Counselling desk" and r.json()["cls"] == "billing"
    assert client.patch("/api/admin/stages/nope", json={"label": "x"}, headers=admin_headers).status_code == 404

    new_order = [keys[0], "counsel"] + keys[1:-2] + ["done"]
    r = client.put("/api/admin/stages/order", json={"keys": new_order}, headers=admin_headers)
    assert r.status_code == 200 and [s["key"] for s in r.json()] == new_order
    assert [s["key"] for s in client.get("/api/config", headers=admin_headers).json()["stages"]] == new_order
    assert client.put("/api/admin/stages/order", json={"keys": ["reg"]}, headers=admin_headers).status_code == 422

    # a visit parked on the stage blocks deletion until it moves on
    pid = client.post("/api/patients", json={"name": "Stage Blocker"}, headers=admin_headers).json()["id"]
    vid = client.post("/api/visits", json={"patientId": pid}, headers=admin_headers).json()["id"]
    assert client.post(f"/api/visits/{vid}/move", json={"stage": "counsel"}, headers=admin_headers).status_code == 200
    r = client.delete("/api/admin/stages/counsel", headers=admin_headers)
    assert r.status_code == 409 and "active visit" in r.json()["detail"]
    client.post(f"/api/visits/{vid}/move", json={"stage": "done"}, headers=admin_headers)
    assert client.delete("/api/admin/stages/counsel", headers=admin_headers).status_code == 204
    assert client.delete("/api/admin/stages/counsel", headers=admin_headers).status_code == 404
    assert "counsel" not in [s["key"] for s in client.get("/api/admin/stages", headers=admin_headers).json()]
    client.put("/api/admin/stages/order", json={"keys": keys[:-2] + ["done"]}, headers=admin_headers)

    actions = [a.action for a in db.scalars(select(AuditLog).where(AuditLog.entity == "stage").order_by(AuditLog.id))]
    for a in ("stage.create", "stage.update", "stage.reorder", "stage.delete"):
        assert a in actions


def test_protocol_steps(client, admin_headers):
    r = client.post("/api/admin/protocol-steps", json={"name": "Phenylephrine 5%", "minutes": 10}, headers=admin_headers)
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    steps = client.get("/api/admin/protocol-steps", headers=admin_headers).json()
    assert steps[-1]["id"] == sid
    assert client.post("/api/admin/protocol-steps", json={"name": "Phenylephrine 5%", "minutes": 1},
                       headers=admin_headers).status_code == 409
    assert client.post("/api/admin/protocol-steps", json={"name": "Zero", "minutes": 0}, headers=admin_headers).status_code == 422
    r = client.patch(f"/api/admin/protocol-steps/{sid}", json={"minutes": 12}, headers=admin_headers)
    assert r.json()["minutes"] == 12 and r.json()["name"] == "Phenylephrine 5%"

    ids = [s["id"] for s in steps]
    moved = [ids[-1]] + ids[:-1]  # `moveProtocolStep` to the top
    r = client.put("/api/admin/protocol-steps/order", json={"ids": moved}, headers=admin_headers)
    assert r.status_code == 200 and [s["id"] for s in r.json()] == moved
    assert client.put("/api/admin/protocol-steps/order", json={"ids": ids[:1]}, headers=admin_headers).status_code == 422
    assert client.delete(f"/api/admin/protocol-steps/{sid}", headers=admin_headers).status_code == 204
    assert client.delete(f"/api/admin/protocol-steps/{sid}", headers=admin_headers).status_code == 404
    client.put("/api/admin/protocol-steps/order", json={"ids": ids[:-1]}, headers=admin_headers)


def test_referral_sources_and_lens_tiers(client, admin_headers):
    r = client.post("/api/admin/referral-sources", json={"key": "hoarding", "label": "Hoarding / Banner", "needsDetail": True},
                    headers=admin_headers)
    assert r.status_code == 201 and r.json()["needsDetail"] is True
    assert client.post("/api/admin/referral-sources", json={"key": "hoarding", "label": "x"}, headers=admin_headers).status_code == 409
    r = client.patch("/api/admin/referral-sources/hoarding", json={"needsDetail": False, "label": "Banner"}, headers=admin_headers)
    assert r.json()["needsDetail"] is False and r.json()["label"] == "Banner"
    # referenced by a patient -> 409
    client.post("/api/patients", json={"name": "Banner Walk-in", "referralSource": "hoarding"}, headers=admin_headers)
    assert client.delete("/api/admin/referral-sources/hoarding", headers=admin_headers).status_code == 409
    r = client.post("/api/admin/referral-sources", json={"key": "radio", "label": "Radio"}, headers=admin_headers)
    assert r.status_code == 201
    assert client.delete("/api/admin/referral-sources/radio", headers=admin_headers).status_code == 204
    assert client.delete("/api/admin/referral-sources/radio", headers=admin_headers).status_code == 404

    r = client.post("/api/admin/lens-tiers", json={"key": "edof", "label": "EDOF IOL", "price": 52000}, headers=admin_headers)
    assert r.status_code == 201 and r.json()["price"] == 52000
    assert client.post("/api/admin/lens-tiers", json={"key": "edof", "label": "x", "price": 1}, headers=admin_headers).status_code == 409
    assert client.patch("/api/admin/lens-tiers/edof", json={"price": 55000}, headers=admin_headers).json()["price"] == 55000
    assert "edof" in [t["key"] for t in client.get("/api/admin/lens-tiers", headers=admin_headers).json()]
    assert client.delete("/api/admin/lens-tiers/edof", headers=admin_headers).status_code == 204
    assert client.delete("/api/admin/lens-tiers/edof", headers=admin_headers).status_code == 404


def test_staff_create_duplicate_last_admin(client, admin_headers, admin_user, db):
    r = client.post("/api/admin/staff", json={"name": "Optom One", "username": "Optom1", "password": "opt12345",
                                              "role": "optometrist"}, headers=admin_headers)
    assert r.status_code == 201, r.text
    u = r.json()
    assert u["username"] == "optom1" and u["role"] == "optometrist" and u["active"] is True
    assert "passwordHash" not in u and "password_hash" not in u and "password" not in u
    uid = u["id"]
    assert client.post("/api/admin/staff", json={"name": "Dup", "username": "optom1", "password": "x1234",
                                                 "role": "reception"}, headers=admin_headers).status_code == 409
    assert client.post("/api/admin/staff", json={"name": "Bad", "username": "badrole", "password": "x1234",
                                                 "role": "janitor"}, headers=admin_headers).status_code == 422
    assert client.patch(f"/api/admin/staff/{uid}", json={"role": "wizard"}, headers=admin_headers).status_code == 422

    rows = client.get("/api/admin/staff", headers=admin_headers).json()
    assert uid in [s["id"] for s in rows] and all("password_hash" not in s for s in rows)

    _login(client, "optom1", "opt12345")
    r = client.post(f"/api/admin/staff/{uid}/reset-password", json={"password": "newpass99"}, headers=admin_headers)
    assert r.status_code == 200
    assert client.post("/api/auth/login", json={"username": "optom1", "password": "opt12345"}).status_code == 401
    _login(client, "optom1", "newpass99")

    r = client.patch(f"/api/admin/staff/{uid}", json={"role": "reception", "name": "Optom Renamed"}, headers=admin_headers)
    assert r.json()["role"] == "reception" and r.json()["name"] == "Optom Renamed"
    r = client.patch(f"/api/admin/staff/{uid}", json={"active": False}, headers=admin_headers)
    assert r.json()["active"] is False
    assert client.post("/api/auth/login", json={"username": "optom1", "password": "newpass99"}).status_code == 401

    # cannot deactivate yourself
    assert client.patch(f"/api/admin/staff/{admin_user.id}", json={"active": False}, headers=admin_headers).status_code == 409
    # last-active-admin protection
    r = client.post("/api/admin/staff", json={"name": "Admin Two", "username": "admin2", "password": "adm2pass",
                                              "role": "admin"}, headers=admin_headers)
    a2 = r.json()["id"]
    a2_headers = _login(client, "admin2", "adm2pass")
    assert client.patch(f"/api/admin/staff/{a2}", json={"active": False}, headers=admin_headers).status_code == 200
    # now admin2 is inactive: it can no longer act, and admin1 is the last active admin
    assert client.patch(f"/api/admin/staff/{admin_user.id}", json={"role": "doctor"}, headers=a2_headers).status_code == 401
    assert client.patch(f"/api/admin/staff/{admin_user.id}", json={"role": "doctor"}, headers=admin_headers).status_code == 409
    # reactivate admin2, then admin2 can demote admin1 (another active admin remains)
    client.patch(f"/api/admin/staff/{a2}", json={"active": True}, headers=admin_headers)
    a2_headers = _login(client, "admin2", "adm2pass")
    assert client.patch(f"/api/admin/staff/{a2}", json={"active": False}, headers=a2_headers).status_code == 409  # self
    assert client.patch(f"/api/admin/staff/{admin_user.id}", json={"active": False}, headers=a2_headers).status_code == 200
    assert client.get("/api/admin/staff", headers=admin_headers).status_code == 401  # admin1 is now inactive
    # restore admin1 for the other test modules
    assert client.patch(f"/api/admin/staff/{admin_user.id}", json={"active": True}, headers=a2_headers).status_code == 200
    client.patch(f"/api/admin/staff/{a2}", json={"active": False}, headers=admin_headers)
    assert client.get("/api/admin/staff", headers=admin_headers).status_code == 200

    audit = [a.action for a in db.scalars(select(AuditLog).where(AuditLog.entity == "staff").order_by(AuditLog.id))]
    assert {"staff.create", "staff.update", "staff.reset_password"} <= set(audit)


def test_reception_denied_admin_writes(client, reception_headers):
    assert client.get("/api/admin/stages", headers=reception_headers).status_code == 200
    assert client.get("/api/admin/lens-tiers", headers=reception_headers).status_code == 200
    assert client.post("/api/admin/stages", json={"key": "x", "label": "X"}, headers=reception_headers).status_code == 403
    assert client.patch("/api/admin/stages/reg", json={"label": "X"}, headers=reception_headers).status_code == 403
    assert client.delete("/api/admin/stages/reg", headers=reception_headers).status_code == 403
    assert client.put("/api/admin/stages/order", json={"keys": []}, headers=reception_headers).status_code == 403
    assert client.post("/api/admin/protocol-steps", json={"name": "x", "minutes": 1}, headers=reception_headers).status_code == 403
    assert client.post("/api/admin/referral-sources", json={"key": "x", "label": "x"}, headers=reception_headers).status_code == 403
    assert client.post("/api/admin/lens-tiers", json={"key": "x", "label": "x", "price": 1}, headers=reception_headers).status_code == 403
    assert client.get("/api/admin/staff", headers=reception_headers).status_code == 403
    assert client.post("/api/admin/staff", json={"name": "x", "username": "x", "password": "xxxx", "role": "admin"},
                       headers=reception_headers).status_code == 403
    assert client.post("/api/admin/staff/1/reset-password", json={"password": "xxxx"}, headers=reception_headers).status_code == 403
