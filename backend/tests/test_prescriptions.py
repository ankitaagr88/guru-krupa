import pytest
from sqlalchemy import select

from app.models import AuditLog, InventoryItem, StockMovement
from app.seed.reference import seed_reference
from app.services.pharmacy import DOSAGE_PHRASES, localize_dosage

MOXI = "Moxifloxacin 0.5% eye drops"
PRED = "Prednisolone acetate 1% eye drops"


@pytest.fixture(scope="module", autouse=True)
def _seed():
    from app.db import SessionLocal

    with SessionLocal() as db:
        seed_reference(db)
    yield
    with SessionLocal() as db:  # leave the reference tables as seeded for test_models
        for item in db.scalars(select(InventoryItem).where(InventoryItem.name == "Rx Scarce Drop")):
            for m in db.scalars(select(StockMovement).where(StockMovement.item_id == item.id)):
                db.delete(m)
            db.delete(item)
        db.commit()


@pytest.fixture
def doctor_headers(client, db):
    from app.auth.service import ensure_user

    ensure_user(db, username="drtest", password="doc123", name="Dr Test", role="doctor")
    r = client.post("/api/auth/login", json={"username": "drtest", "password": "doc123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def reception_headers(client, db):
    from app.auth.service import ensure_user

    ensure_user(db, username="rxrecep", password="rec123", name="Reception", role="reception")
    r = client.post("/api/auth/login", json={"username": "rxrecep", "password": "rec123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _visit(client, headers, name="Rx Patient", **patient):
    pid = client.post("/api/patients", json={"name": name, "age": 61, "sex": "F", **patient}, headers=headers).json()["id"]
    r = client.post("/api/visits", json={"patientId": pid}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _stock(client, headers, name):
    return next(i for i in client.get("/api/inventory", headers=headers).json() if i["name"] == name)


def _set_stock(client, headers, name, target):
    item = _stock(client, headers, name)
    if item["stock"] != target:
        r = client.post(f"/api/inventory/{item['id']}/adjust", json={"delta": target - item["stock"], "reason": "received"},
                        headers=headers)
        assert r.status_code == 200, r.text
    return item["id"]


def test_medicines_search(client, admin_headers):
    assert client.get("/api/medicines").status_code == 401
    rows = client.get("/api/medicines", headers=admin_headers).json()
    assert len(rows) >= 10 and {"id", "name"} == set(rows[0])
    hits = client.get("/api/medicines?q=moxi", headers=admin_headers).json()
    assert [h["name"] for h in hits] == [MOXI]
    assert MOXI in [h["name"] for h in client.get("/api/medicines?q=EYE DROPS", headers=admin_headers).json()]
    assert client.get("/api/medicines?q=zzz", headers=admin_headers).json() == []


def test_save_decrements_stock_and_reports_low(client, admin_headers, doctor_headers, db):
    moxi_id = _set_stock(client, admin_headers, MOXI, 7)  # reorder 6 -> dispensing 2 crosses the line
    pred_id = _set_stock(client, admin_headers, PRED, 10)
    vid = _visit(client, admin_headers)
    body = {"lines": [
        {"name": MOXI.upper(), "dosage": "1 drop both eyes, twice daily", "qtyGiven": 2},
        {"name": PRED, "dosage": "1 drop right eye, at night", "qtyGiven": 1},
        {"name": "Some compounded gel", "dosage": "apply at night", "qtyGiven": 0},
    ], "printLanguage": "gujlish"}
    r = client.post(f"/api/visits/{vid}/prescription", json=body, headers=doctor_headers)
    assert r.status_code == 201, r.text
    rx = r.json()
    assert rx["visitId"] == vid and rx["printLanguage"] == "gujarati"
    names = [(ln["name"], ln["matched"], ln["qtyGiven"]) for ln in rx["lines"]]
    assert names == [(MOXI, True, 2), (PRED, True, 1), ("Some compounded gel", False, 0)]
    assert rx["lines"][0]["medicineId"] and rx["lines"][2]["medicineId"] is None
    assert rx["lowStock"] == [MOXI]

    assert _stock(client, admin_headers, MOXI)["stock"] == 5 and _stock(client, admin_headers, MOXI)["low"] is True
    assert _stock(client, admin_headers, PRED)["stock"] == 9
    moves = list(db.scalars(select(StockMovement).where(StockMovement.ref_prescription_id == rx["id"])))
    assert sorted((m.item_id, m.delta, m.reason) for m in moves) == sorted(
        [(moxi_id, -2, "dispensed"), (pred_id, -1, "dispensed")])
    assert all(m.by_staff_id is not None for m in moves)

    r = client.get(f"/api/visits/{vid}/prescription", headers=admin_headers)
    assert r.status_code == 200 and r.json()["id"] == rx["id"] and len(r.json()["lines"]) == 3
    v = client.get(f"/api/visits/{vid}", headers=admin_headers).json()
    assert v["hasPrescription"] is True
    assert db.scalar(select(AuditLog).where(AuditLog.entity == "prescription", AuditLog.entity_id == rx["id"]))


def test_insufficient_stock_is_atomic(client, admin_headers, doctor_headers, db):
    r = client.post("/api/inventory", json={"name": "Rx Scarce Drop", "unit": "bottles", "stock": 1, "reorderLevel": 1},
                    headers=admin_headers)
    assert r.status_code == 201, r.text
    scarce = r.json()["id"]
    _set_stock(client, admin_headers, PRED, 10)
    vid = _visit(client, admin_headers, "Atomic Patient")
    body = {"lines": [{"name": PRED, "dosage": "1 drop both eyes, once daily", "qtyGiven": 3},
                      {"name": "rx scarce drop", "dosage": "1 drop left eye, at night", "qtyGiven": 2}]}
    r = client.post(f"/api/visits/{vid}/prescription", json=body, headers=doctor_headers)
    assert r.status_code == 409, r.text
    assert "Rx Scarce Drop" in r.json()["detail"]
    # nothing written: no prescription, no movements, stock untouched
    assert client.get(f"/api/visits/{vid}/prescription", headers=admin_headers).status_code == 404
    assert _stock(client, admin_headers, PRED)["stock"] == 10
    assert client.get(f"/api/inventory/{scarce}", headers=admin_headers).json()["stock"] == 1
    assert db.scalar(select(StockMovement).where(StockMovement.item_id == scarce, StockMovement.reason == "dispensed")) is None


def test_repost_replaces_and_restores_stock(client, admin_headers, doctor_headers, db):
    moxi_id = _set_stock(client, admin_headers, MOXI, 10)
    pred_id = _set_stock(client, admin_headers, PRED, 10)
    vid = _visit(client, admin_headers, "Replace Patient")
    first = client.post(f"/api/visits/{vid}/prescription",
                        json={"lines": [{"name": MOXI, "dosage": "1 drop both eyes, twice daily", "qtyGiven": 3}]},
                        headers=doctor_headers).json()
    assert _stock(client, admin_headers, MOXI)["stock"] == 7

    second = client.post(f"/api/visits/{vid}/prescription",
                         json={"lines": [{"name": PRED, "dosage": "1 drop both eyes, once daily", "qtyGiven": 1}]},
                         headers=doctor_headers)
    assert second.status_code == 201, second.text
    assert second.json()["id"] == first["id"]  # same prescription row, lines replaced
    assert [ln["name"] for ln in second.json()["lines"]] == [PRED]
    assert _stock(client, admin_headers, MOXI)["stock"] == 10  # restored
    assert _stock(client, admin_headers, PRED)["stock"] == 9

    moves = list(db.scalars(select(StockMovement).where(StockMovement.ref_prescription_id == first["id"])
                            .order_by(StockMovement.id)))
    assert [(m.item_id, m.delta, m.reason) for m in moves] == [
        (moxi_id, -3, "dispensed"), (moxi_id, 3, "adjusted"), (pred_id, -1, "dispensed")]
    assert len(client.get(f"/api/visits/{vid}/prescription", headers=admin_headers).json()["lines"]) == 1

    # re-posting the same lines again when stock would run out is still atomic
    _set_stock(client, admin_headers, PRED, 1)  # 1 in stock, 1 already dispensed on this rx -> 2 after reversal
    r = client.post(f"/api/visits/{vid}/prescription",
                    json={"lines": [{"name": PRED, "dosage": "x", "qtyGiven": 5}]}, headers=doctor_headers)
    assert r.status_code == 409
    assert _stock(client, admin_headers, PRED)["stock"] == 1
    assert [ln["qtyGiven"] for ln in client.get(f"/api/visits/{vid}/prescription", headers=admin_headers).json()["lines"]] == [1]


def test_print_payload_localised(client, admin_headers, doctor_headers):
    _set_stock(client, admin_headers, MOXI, 10)
    vid = _visit(client, admin_headers, "Print Patient", language="hindi")
    client.post(f"/api/visits/{vid}/prescription",
                json={"lines": [{"name": MOXI, "dosage": "1 drop both eyes, twice daily", "qtyGiven": 1},
                                {"name": "Ofloxacin eye ointment", "dosage": "ointment left eye, at night", "qtyGiven": 0},
                                {"name": "Custom", "dosage": "Rinse with cold water", "qtyGiven": 0}]},
                headers=doctor_headers)
    r = client.get(f"/api/visits/{vid}/prescription/print?lang=hinglish", headers=admin_headers)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["hospital"] == {"name": "Guru Krupa Eye Hospital & Laser Center",
                             "address": "201/320, The Grand Plaza, Opp. Fire Station, VIP Road, Vesu, Surat",
                             "phone": "9328621216, 7574998502", "doctor": "Dr. Anu Juneja"}
    assert p["patient"]["name"] == "Print Patient" and p["patient"]["age"] == 61 and p["patient"]["sex"] == "F"
    assert p["patient"]["token"].startswith("#") and p["patient"]["date"]
    assert p["language"] == "hinglish"
    assert p["lines"][0]["dosageLocal"] == "1 boond dono aankh mein, din mein 2 baar"
    assert p["lines"][1]["dosageLocal"] == "baayi aankh mein malam lagayein, raat ko sote samay"
    assert p["lines"][2]["dosageLocal"] == "Rinse with cold water"  # English fallback
    assert p["lines"][0]["qtyGiven"] == 1 and p["lines"][0]["dosage"] == "1 drop both eyes, twice daily"

    g = client.get(f"/api/visits/{vid}/prescription/print?lang=gujlish", headers=admin_headers).json()
    assert g["language"] == "gujlish"
    assert g["lines"][0]["dosageLocal"] == "1 tipu banne aankh ma, divas ma 2 vaar"
    e = client.get(f"/api/visits/{vid}/prescription/print?lang=english", headers=admin_headers).json()
    assert e["lines"][0]["dosageLocal"] == "1 drop both eyes, twice daily"
    # no lang -> the prescription's stored language (patient language hindi -> hinglish)
    assert client.get(f"/api/visits/{vid}/prescription/print", headers=admin_headers).json()["language"] == "hinglish"
    assert client.get(f"/api/visits/{vid}/prescription/print?lang=klingon", headers=admin_headers).status_code == 422


def test_dosage_table():
    assert len(DOSAGE_PHRASES) >= 12
    assert DOSAGE_PHRASES["1 drop both eyes, twice daily"] == (
        "1 boond dono aankh mein, din mein 2 baar", "1 tipu banne aankh ma, divas ma 2 vaar")
    assert localize_dosage("2 drops, right eye, 3x daily for 5 days", "gujarati") == \
        "2 tipu jamni aankh ma, divas ma 3 vaar, 5 divas sudhi"
    assert localize_dosage("1 tab BD", "hindi") == "1 goli, din mein 2 baar"
    assert localize_dosage("as directed", "hindi") == "as directed"
    assert localize_dosage("", "gujlish") == ""


def test_prescription_roles_and_404(client, admin_headers, reception_headers):
    vid = _visit(client, admin_headers, "Role Patient")
    body = {"lines": [{"name": "Custom", "dosage": "x", "qtyGiven": 0}]}
    assert client.post(f"/api/visits/{vid}/prescription", json=body, headers=reception_headers).status_code == 403
    assert client.post(f"/api/visits/{vid}/prescription", json=body, headers=admin_headers).status_code == 201
    assert client.get(f"/api/visits/{vid}/prescription", headers=reception_headers).status_code == 200
    assert client.post("/api/visits/999999/prescription", json=body, headers=admin_headers).status_code == 404
    assert client.get("/api/visits/999999/prescription/print", headers=admin_headers).status_code == 404
    assert client.post(f"/api/visits/{vid}/prescription", json={"lines": [], "printLanguage": "latin"},
                       headers=admin_headers).status_code == 422


def test_bill_upsert_and_pay(client, admin_headers, reception_headers):
    vid = _visit(client, admin_headers, "Bill Patient")
    assert client.get(f"/api/visits/{vid}/bill", headers=admin_headers).status_code == 404
    r = client.put(f"/api/visits/{vid}/bill", json={"items": [{"label": "Consultation", "amount": 500},
                                                             {"label": "Dilation", "amount": 150}]},
                   headers=reception_headers)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["visitId"] == vid and b["total"] == 650 and b["paymentMode"] is None and b["paid"] is False
    assert [i["label"] for i in b["items"]] == ["Consultation", "Dilation"]
    assert client.get(f"/api/visits/{vid}", headers=admin_headers).json()["hasBill"] is True

    r = client.put(f"/api/visits/{vid}/bill", json={"items": [{"label": "Consultation", "amount": 500}],
                                                    "paymentMode": "upi"}, headers=admin_headers)
    b = r.json()
    assert b["id"] == r.json()["id"] and b["total"] == 500 and len(b["items"]) == 1 and b["paymentMode"] == "upi"
    assert client.put(f"/api/visits/{vid}/bill", json={"items": [], "paymentMode": "barter"},
                      headers=admin_headers).status_code == 422

    r = client.post(f"/api/visits/{vid}/bill/pay", json={"paymentMode": "cash"}, headers=reception_headers)
    assert r.status_code == 200 and r.json()["paid"] is True and r.json()["paidAt"] and r.json()["paymentMode"] == "cash"
    assert client.get(f"/api/visits/{vid}/bill", headers=admin_headers).json()["paid"] is True
    assert client.post(f"/api/visits/{vid}/bill/pay", json={"paymentMode": "gold"}, headers=admin_headers).status_code == 422
    v2 = _visit(client, admin_headers, "Unbilled")
    assert client.post(f"/api/visits/{v2}/bill/pay", json={"paymentMode": "cash"}, headers=admin_headers).status_code == 404

