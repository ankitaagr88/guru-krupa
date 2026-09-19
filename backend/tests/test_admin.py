import pytest
from sqlalchemy import select

from app.models import AuditLog, Medicine, MedicineForm, Patient, ReferralSource
from app.seed.reference import CONDITIONS, MEDICINE_FORMS, seed_reference


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
        for m in db.scalars(select(Medicine).where(Medicine.name.like("Testbrand%"))):
            db.delete(m)
        for f in db.scalars(select(MedicineForm).where(MedicineForm.key.in_(["spray", "lozenge"]))):
            db.delete(f)
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
    assert set(c) == {"stages", "protocolSteps", "referralSources", "lensTiers", "conditions", "medicineForms"}
    assert [s["key"] for s in c["stages"]][:2] == ["reg", "pretest"] and c["stages"][-1]["key"] == "done"
    assert {"id", "key", "label", "cls", "sortOrder"} <= set(c["stages"][0])
    assert c["protocolSteps"][0]["name"] == "Tropicamide 0.8%" and c["protocolSteps"][0]["minutes"] == 5
    src = next(s for s in c["referralSources"] if s["key"] == "doctor")
    assert src["needsDetail"] is True and src["label"] == "Referred by another doctor"
    assert next(s for s in c["referralSources"] if s["key"] == "self")["needsDetail"] is False
    assert {t["key"]: t["price"] for t in c["lensTiers"]}["monofocal"] == 28500
    assert c["conditions"] == CONDITIONS
    assert c["medicineForms"] == [{"key": k, "label": lbl} for k, lbl in MEDICINE_FORMS]
    assert c["medicineForms"][0] == {"key": "drops", "label": "Drops"}


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


MED_KEYS = {"id", "name", "brand", "composition", "form", "formLabel", "strength", "packSize", "manufacturer",
            "displayName"}


def test_medicine_forms_crud(client, admin_headers, db):
    rows = client.get("/api/admin/medicine-forms", headers=admin_headers).json()
    assert [r["key"] for r in rows][:4] == ["drops", "gel", "ointment", "suspension"]
    assert set(rows[0]) == {"id", "key", "label", "sortOrder", "active"}
    assert {"syrup", "gummies"} <= {r["key"] for r in rows}

    r = client.post("/api/admin/medicine-forms", json={"key": "spray", "label": "Nasal spray"}, headers=admin_headers)
    assert r.status_code == 201, r.text
    assert r.json()["key"] == "spray" and r.json()["label"] == "Nasal spray" and r.json()["active"] is True
    assert r.json()["sortOrder"] == max(x["sortOrder"] for x in rows) + 1
    assert client.post("/api/admin/medicine-forms", json={"key": "spray", "label": "x"}, headers=admin_headers).status_code == 409
    assert client.post("/api/admin/medicine-forms", json={"key": "Bad Key", "label": "x"}, headers=admin_headers).status_code == 422
    r = client.patch("/api/admin/medicine-forms/spray", json={"label": "Spray"}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["label"] == "Spray"
    assert client.patch("/api/admin/medicine-forms/nope", json={"label": "x"}, headers=admin_headers).status_code == 404
    assert "spray" in [f["key"] for f in client.get("/api/config", headers=admin_headers).json()["medicineForms"]]

    # retiring a type hides it from /config (and from new medicines) but keeps it on the admin list
    r = client.patch("/api/admin/medicine-forms/spray", json={"active": False}, headers=admin_headers)
    assert r.json()["active"] is False
    assert "spray" not in [f["key"] for f in client.get("/api/config", headers=admin_headers).json()["medicineForms"]]
    assert "spray" in [f["key"] for f in client.get("/api/admin/medicine-forms", headers=admin_headers).json()]
    r = client.post("/api/admin/medicines", json={"composition": "Xylometazoline", "form": "spray"}, headers=admin_headers)
    assert r.status_code == 422 and "form must be one of" in r.json()["detail"]

    # a type in use cannot be deleted (seeded gel -> Aquaray Gel)
    r = client.delete("/api/admin/medicine-forms/gel", headers=admin_headers)
    assert r.status_code == 409 and "medicine(s) use form" in r.json()["detail"]
    assert client.delete("/api/admin/medicine-forms/spray", headers=admin_headers).status_code == 204
    assert client.delete("/api/admin/medicine-forms/spray", headers=admin_headers).status_code == 404

    keys = [r["key"] for r in client.get("/api/admin/medicine-forms", headers=admin_headers).json()]
    moved = keys[1:] + keys[:1]
    r = client.put("/api/admin/medicine-forms/order", json={"keys": moved}, headers=admin_headers)
    assert r.status_code == 200 and [f["key"] for f in r.json()] == moved
    client.put("/api/admin/medicine-forms/order", json={"keys": keys}, headers=admin_headers)

    actions = {a.action for a in db.scalars(select(AuditLog).where(AuditLog.entity == "medicine_form"))}
    assert {"medicine_form.create", "medicine_form.update", "medicine_form.delete", "medicine_form.reorder"} <= actions


def test_medicines_crud_soft_delete(client, admin_headers, db):
    rows = client.get("/api/admin/medicines", headers=admin_headers).json()
    assert len(rows) >= 12 and MED_KEYS == set(rows[0])
    assert "Aquaray Gel" in [r["name"] for r in rows]

    # brand + composition as an MR brings it: name defaults to the brand
    body = {"brand": "Testbrand Eye Drops", "composition": "Ketorolac tromethamine 0.5%", "form": "drops",
            "strength": "0.5%", "packSize": "5 ml", "manufacturer": "Sun Pharma"}
    r = client.post("/api/admin/medicines", json=body, headers=admin_headers)
    assert r.status_code == 201, r.text
    m = r.json()
    mid = m["id"]
    assert m == {"id": mid, "name": "Testbrand Eye Drops", "brand": "Testbrand Eye Drops",
                 "composition": "Ketorolac tromethamine 0.5%", "form": "drops", "formLabel": "Drops",
                 "strength": "0.5%", "packSize": "5 ml", "manufacturer": "Sun Pharma",
                 "displayName": "Testbrand Eye Drops (Ketorolac tromethamine 0.5%)"}
    # duplicate name (case-insensitive) -> 409; unknown form -> 422; composition required -> 422
    assert client.post("/api/admin/medicines", json={"brand": "testbrand eye drops", "composition": "x"},
                       headers=admin_headers).status_code == 409
    assert client.post("/api/admin/medicines", json={"composition": "x", "form": "lotion"}, headers=admin_headers).status_code == 422
    assert client.post("/api/admin/medicines", json={"brand": "No composition"}, headers=admin_headers).status_code == 422
    # generic-only row: name defaults to the composition, brand stays null
    r = client.post("/api/admin/medicines", json={"composition": "Testbrand Generic Syrup", "form": "syrup"}, headers=admin_headers)
    assert r.status_code == 201 and r.json()["name"] == "Testbrand Generic Syrup" and r.json()["brand"] is None
    assert r.json()["formLabel"] == "Syrup" and r.json()["displayName"] == "Testbrand Generic Syrup"
    gid = r.json()["id"]

    # searchable by brand and by composition from the doctor's picker
    assert [h["id"] for h in client.get("/api/medicines?q=testbrand eye", headers=admin_headers).json()] == [mid]
    assert mid in [h["id"] for h in client.get("/api/medicines?q=tromethamine", headers=admin_headers).json()]

    r = client.patch(f"/api/admin/medicines/{mid}", json={"packSize": "10 ml", "form": "gel", "manufacturer": ""},
                     headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["packSize"] == "10 ml" and r.json()["form"] == "gel" and r.json()["formLabel"] == "Gel"
    assert r.json()["manufacturer"] is None  # "" clears an optional field
    assert client.patch(f"/api/admin/medicines/{mid}", json={"form": "lotion"}, headers=admin_headers).status_code == 422
    assert client.patch(f"/api/admin/medicines/{mid}", json={"name": "aquaray gel"}, headers=admin_headers).status_code == 409
    assert client.patch("/api/admin/medicines/999999", json={"name": "x"}, headers=admin_headers).status_code == 404
    assert client.get(f"/api/admin/medicines/{mid}", headers=admin_headers).json()["packSize"] == "10 ml"

    # soft delete: gone from the picker and the default admin list, still present with includeInactive
    assert client.delete(f"/api/admin/medicines/{gid}", headers=admin_headers).status_code == 204
    assert gid not in [h["id"] for h in client.get("/api/medicines?q=testbrand", headers=admin_headers).json()]
    assert gid not in [h["id"] for h in client.get("/api/admin/medicines", headers=admin_headers).json()]
    assert gid in [h["id"] for h in client.get("/api/admin/medicines?includeInactive=true", headers=admin_headers).json()]
    assert db.get(Medicine, gid).active is False
    assert client.delete("/api/admin/medicines/999999", headers=admin_headers).status_code == 404
    # reactivate via PATCH
    assert client.patch(f"/api/admin/medicines/{gid}", json={"active": True}, headers=admin_headers).json()["name"]
    assert gid in [h["id"] for h in client.get("/api/medicines?q=testbrand", headers=admin_headers).json()]

    actions = {a.action for a in db.scalars(select(AuditLog).where(AuditLog.entity == "medicine"))}
    assert {"medicine.create", "medicine.update", "medicine.delete"} <= actions


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
    # medicines / medicine forms: any staff reads, admin writes
    assert client.get("/api/admin/medicines", headers=reception_headers).status_code == 200
    assert client.get("/api/admin/medicine-forms", headers=reception_headers).status_code == 200
    assert client.post("/api/admin/medicines", json={"composition": "x"}, headers=reception_headers).status_code == 403
    assert client.patch("/api/admin/medicines/1", json={"packSize": "x"}, headers=reception_headers).status_code == 403
    assert client.delete("/api/admin/medicines/1", headers=reception_headers).status_code == 403
    assert client.post("/api/admin/medicine-forms", json={"key": "x", "label": "X"}, headers=reception_headers).status_code == 403
    assert client.patch("/api/admin/medicine-forms/drops", json={"label": "X"}, headers=reception_headers).status_code == 403
    assert client.delete("/api/admin/medicine-forms/drops", headers=reception_headers).status_code == 403
    assert client.put("/api/admin/medicine-forms/order", json={"keys": []}, headers=reception_headers).status_code == 403
