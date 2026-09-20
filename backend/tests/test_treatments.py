"""Diagnoses + treatment standards (B15/F17): admin CRUD, history-derived standard, admin override."""
import pytest

from app.seed.reference import seed_reference

MOXI = "Moxifloxacin 0.5% eye drops"
PRED = "Prednisolone acetate 1% eye drops"
TIMO = "Timolol 0.5% eye drops"


@pytest.fixture(scope="module", autouse=True)
def _seed():
    from app.db import SessionLocal

    with SessionLocal() as db:
        seed_reference(db)
    yield


@pytest.fixture
def doctor_headers(client, db):
    from app.auth.service import ensure_user

    ensure_user(db, username="drtreat", password="doc123", name="Dr Treat", role="doctor")
    r = client.post("/api/auth/login", json={"username": "drtreat", "password": "doc123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _visit(client, headers, name):
    pid = client.post("/api/patients", json={"name": name, "age": 40, "sex": "M"}, headers=headers).json()["id"]
    return client.post("/api/visits", json={"patientId": pid}, headers=headers).json()["id"]


def _rx(client, headers, vid, diagnosis_id, lines):
    r = client.post(f"/api/visits/{vid}/prescription", json={"diagnosisId": diagnosis_id, "lines": lines},
                    headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def test_seeded_diagnoses_and_admin_crud(client, admin_headers, doctor_headers):
    r = client.get("/api/diagnoses", headers=doctor_headers)
    assert r.status_code == 200
    names = [d["name"] for d in r.json()]
    assert "Dry eye" in names and "Cataract" in names

    # doctor cannot write
    assert client.post("/api/admin/diagnoses", json={"name": "Uveitis"}, headers=doctor_headers).status_code == 403

    r = client.post("/api/admin/diagnoses", json={"name": "  Uveitis  "}, headers=admin_headers)
    assert r.status_code == 201, r.text
    uv = r.json()
    assert uv["name"] == "Uveitis" and uv["active"] and uv["prescriptionCount"] == 0 and not uv["hasStandard"]
    # duplicate (case-insensitive) -> 409
    assert client.post("/api/admin/diagnoses", json={"name": "uveitis"}, headers=admin_headers).status_code == 409

    r = client.patch(f"/api/admin/diagnoses/{uv['id']}", json={"name": "Anterior uveitis"}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["name"] == "Anterior uveitis"
    r = client.patch(f"/api/admin/diagnoses/{uv['id']}", json={"active": False}, headers=admin_headers)
    assert r.json()["active"] is False
    assert all(d["id"] != uv["id"] for d in client.get("/api/diagnoses", headers=admin_headers).json())
    assert any(d["id"] == uv["id"]
               for d in client.get("/api/diagnoses?includeInactive=1", headers=admin_headers).json())

    # reorder must list every diagnosis
    ids = [d["id"] for d in client.get("/api/diagnoses?includeInactive=1", headers=admin_headers).json()]
    assert client.put("/api/admin/diagnoses/order", json={"ids": ids[:2]}, headers=admin_headers).status_code == 422
    r = client.put("/api/admin/diagnoses/order", json={"ids": list(reversed(ids))}, headers=admin_headers)
    assert r.status_code == 200 and r.json()[0]["id"] == ids[-1]

    # unused -> deletable
    assert client.delete(f"/api/admin/diagnoses/{uv['id']}", headers=admin_headers).status_code == 204
    assert client.get(f"/api/diagnoses/{uv['id']}/standard", headers=admin_headers).status_code == 404


def test_history_standard_counts_most_common_prescription(client, admin_headers, doctor_headers):
    dx = client.post("/api/admin/diagnoses", json={"name": "Test conjunctivitis"}, headers=admin_headers).json()
    did = dx["id"]

    # nothing yet
    r = client.get(f"/api/diagnoses/{did}/standard", headers=doctor_headers)
    assert r.status_code == 200
    assert r.json() == {**r.json(), "source": "none", "lines": [], "historyCount": 0}

    # 4 prescriptions: MOXI in all 4 (dosage "4x daily" 3 times, "2x daily" once),
    # PRED in 2 (50% -> included), TIMO in 1 (25% -> left out)
    _rx(client, doctor_headers, _visit(client, doctor_headers, "H1"), did,
        [{"name": MOXI, "dosage": "1 drop 4x daily"}, {"name": PRED, "dosage": "1 drop 2x daily"}])
    _rx(client, doctor_headers, _visit(client, doctor_headers, "H2"), did,
        [{"name": MOXI, "dosage": "1 drop 4x daily"}, {"name": TIMO, "dosage": "night"}])
    _rx(client, doctor_headers, _visit(client, doctor_headers, "H3"), did,
        [{"name": MOXI, "dosage": "1 drop 2x daily"}, {"name": PRED, "dosage": "1 drop 2x daily"}])
    _rx(client, doctor_headers, _visit(client, doctor_headers, "H4"), did,
        [{"name": "moxifloxacin 0.5% EYE DROPS", "dosage": "1 drop 4x daily"}])  # same medicine, different case

    rx = client.get(f"/api/visits/{_visit(client, doctor_headers, 'H5')}/prescription", headers=doctor_headers)
    assert rx.status_code == 404  # unrelated visit has none

    r = client.get(f"/api/diagnoses/{did}/standard", headers=doctor_headers).json()
    assert r["source"] == "history" and r["historyCount"] == 4 and r["diagnosisName"] == "Test conjunctivitis"
    names = [l["name"] for l in r["lines"]]
    assert names == [MOXI, PRED]  # most frequent first, TIMO excluded
    moxi = r["lines"][0]
    assert moxi["dosage"] == "1 drop 4x daily" and moxi["frequency"] == 1.0 and moxi["matched"]
    assert r["lines"][1]["frequency"] == 0.5

    # the saved prescription carries the diagnosis
    listed = client.get("/api/diagnoses", headers=admin_headers).json()
    assert next(d for d in listed if d["id"] == did)["prescriptionCount"] == 4
    # used -> cannot hard-delete
    assert client.delete(f"/api/admin/diagnoses/{did}", headers=admin_headers).status_code == 409

    # ---- admin standard wins over history, and can be cleared again
    body = {"lines": [{"name": PRED, "dosage": "1 drop 6x daily, taper"}, {"name": "Lubricant of choice", "dosage": "4x daily"}]}
    assert client.put(f"/api/admin/diagnoses/{did}/standard", json=body, headers=doctor_headers).status_code == 403
    r = client.put(f"/api/admin/diagnoses/{did}/standard", json=body, headers=admin_headers)
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["source"] == "admin" and s["updatedBy"] == "Admin" and s["updatedAt"]
    assert [l["name"] for l in s["lines"]] == [PRED, "Lubricant of choice"]
    assert s["lines"][0]["matched"] is True and s["lines"][1]["matched"] is False
    assert [l["name"] for l in s["historyLines"]] == [MOXI, PRED]  # history still shown for comparison
    assert next(d for d in client.get("/api/diagnoses", headers=admin_headers).json() if d["id"] == did)["hasStandard"]

    r = client.delete(f"/api/admin/diagnoses/{did}/standard", headers=admin_headers)
    assert r.status_code == 200 and r.json()["source"] == "history"


def test_prescription_rejects_unknown_diagnosis(client, doctor_headers):
    vid = _visit(client, doctor_headers, "Bad dx")
    r = client.post(f"/api/visits/{vid}/prescription", json={"diagnosisId": 999999, "lines": []}, headers=doctor_headers)
    assert r.status_code == 422
