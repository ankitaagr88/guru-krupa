import pytest
from sqlalchemy import select

from app.models import InventoryItem, StockMovement
from app.seed.reference import seed_reference


@pytest.fixture(scope="module", autouse=True)
def _seed():
    from app.db import SessionLocal

    with SessionLocal() as db:
        seed_reference(db)
    yield
    with SessionLocal() as db:  # leave the reference tables as seeded for test_models
        for item in db.scalars(select(InventoryItem).where(InventoryItem.name.like("Test Lubricant Gel%"))):
            for m in db.scalars(select(StockMovement).where(StockMovement.item_id == item.id)):
                db.delete(m)
            db.delete(item)
        db.commit()


@pytest.fixture
def doctor_headers(client, db):
    from app.auth.service import ensure_user

    ensure_user(db, username="invdoc", password="doc123", name="Dr Inv", role="doctor")
    r = client.post("/api/auth/login", json={"username": "invdoc", "password": "doc123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_list_shape_and_low(client, admin_headers):
    assert client.get("/api/inventory").status_code == 401
    rows = client.get("/api/inventory", headers=admin_headers).json()
    assert len(rows) >= 12
    row = next(r for r in rows if r["name"] == "Tropicamide 0.8%")
    assert set(row) == {"id", "name", "unit", "stock", "reorderLevel", "low", "medicineId"}
    assert row["medicineId"] is None and row["unit"] == "bottles"  # dilation drop, not a prescribed medicine
    moxi = next(r for r in rows if r["name"] == "Moxifloxacin 0.5% eye drops")
    assert moxi["medicineId"] is not None
    assert [r["name"] for r in rows] == sorted(r["name"] for r in rows)

    low = client.get("/api/inventory/low", headers=admin_headers).json()
    assert all(r["low"] and r["stock"] <= r["reorderLevel"] for r in low)
    assert {r["id"] for r in low} == {r["id"] for r in rows if r["stock"] <= r["reorderLevel"]}


def test_create_patch_adjust_movements(client, admin_headers, doctor_headers):
    r = client.post("/api/inventory", json={"name": "Test Lubricant Gel", "unit": "tubes", "stock": 4, "reorderLevel": 3},
                    headers=admin_headers)
    assert r.status_code == 201, r.text
    item = r.json()
    assert item["stock"] == 4 and item["low"] is False and item["unit"] == "tubes"
    iid = item["id"]
    assert client.post("/api/inventory", json={"name": "test lubricant gel"}, headers=admin_headers).status_code == 409
    assert client.post("/api/inventory", json={"name": "Bad Unit", "unit": "boxes"}, headers=admin_headers).status_code == 422
    assert client.post("/api/inventory", json={"name": "Bad Med", "medicineId": 999999}, headers=admin_headers).status_code == 422

    r = client.patch(f"/api/inventory/{iid}", json={"reorderLevel": 5, "name": "Test Lubricant Gel 10g"}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["reorderLevel"] == 5 and r.json()["low"] is True
    assert r.json()["name"] == "Test Lubricant Gel 10g"

    r = client.post(f"/api/inventory/{iid}/adjust", json={"delta": 6, "reason": "received", "note": "Sun Pharma"},
                    headers=admin_headers)
    assert r.status_code == 200 and r.json()["stock"] == 10 and r.json()["low"] is False
    r = client.post(f"/api/inventory/{iid}/adjust", json={"delta": -3, "reason": "adjusted"}, headers=admin_headers)
    assert r.json()["stock"] == 7
    r = client.post(f"/api/inventory/{iid}/adjust", json={"delta": -8, "reason": "adjusted"}, headers=admin_headers)
    assert r.status_code == 409 and "below zero" in r.json()["detail"]
    assert client.get(f"/api/inventory/{iid}", headers=admin_headers).json()["stock"] == 7
    assert client.post(f"/api/inventory/{iid}/adjust", json={"delta": 1, "reason": "stolen"},
                       headers=admin_headers).status_code == 422

    moves = client.get(f"/api/inventory/{iid}/movements", headers=admin_headers).json()
    assert [(m["delta"], m["reason"]) for m in moves] == [(-3, "adjusted"), (6, "received"), (4, "received")]
    assert all(m["itemId"] == iid and m["byStaffId"] and m["at"] for m in moves)
    assert moves[0]["refPrescriptionId"] is None

    # role: doctor can read but not adjust/create
    assert client.get("/api/inventory", headers=doctor_headers).status_code == 200
    assert client.post(f"/api/inventory/{iid}/adjust", json={"delta": 1, "reason": "received"},
                       headers=doctor_headers).status_code == 403
    assert client.post("/api/inventory", json={"name": "Doc Item"}, headers=doctor_headers).status_code == 403
    assert client.patch(f"/api/inventory/{iid}", json={"reorderLevel": 1}, headers=doctor_headers).status_code == 403

    assert client.get("/api/inventory/999999", headers=admin_headers).status_code == 404
    assert client.post("/api/inventory/999999/adjust", json={"delta": 1, "reason": "received"},
                       headers=admin_headers).status_code == 404
