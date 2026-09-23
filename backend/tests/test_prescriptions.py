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


MED_KEYS = {"id", "name", "brand", "composition", "form", "formLabel", "strength", "packSize", "manufacturer", "active",
            "displayName", "price"}


def test_medicines_search(client, admin_headers):
    assert client.get("/api/medicines").status_code == 401
    rows = client.get("/api/medicines", headers=admin_headers).json()
    assert len(rows) >= 12 and MED_KEYS == set(rows[0])
    generic = next(r for r in rows if r["name"] == MOXI)
    assert generic["brand"] is None and generic["composition"] == MOXI and generic["form"] == "drops"
    assert generic["formLabel"] == "Drops" and generic["displayName"] == MOXI
    # "moxi" hits the generic (name prefix) AND the brand MOSI LP (composition substring); brand/name prefix first
    hits = client.get("/api/medicines?q=moxi", headers=admin_headers).json()
    assert [h["name"] for h in hits] == [MOXI, "MOSI LP"]
    assert MOXI in [h["name"] for h in client.get("/api/medicines?q=EYE DROPS", headers=admin_headers).json()]
    assert client.get("/api/medicines?q=zzz", headers=admin_headers).json() == []


def test_medicines_search_by_brand_and_composition(client, admin_headers):
    by_brand = client.get("/api/medicines?q=aqua", headers=admin_headers).json()
    assert [h["name"] for h in by_brand] == ["Aquaray Gel"]
    a = by_brand[0]
    assert a == {"id": a["id"], "name": "Aquaray Gel", "brand": "Aquaray Gel",
                 "composition": "Carboxymethylcellulose sodium eye drops IP", "form": "gel", "formLabel": "Gel",
                 "strength": "0.5%", "packSize": "10 ml", "manufacturer": "Raymed",
                 "displayName": "Aquaray Gel (Carboxymethylcellulose sodium eye drops IP)", "active": True,
                 "price": None}
    # composition search: the generic CMC row (name prefix) first, then the brand whose composition matches
    names = [h["name"] for h in client.get("/api/medicines?q=carboxymethyl", headers=admin_headers).json()]
    assert names == ["Carboxymethylcellulose 0.5% (tear drops)", "Aquaray Gel"]
    names = [h["name"] for h in client.get("/api/medicines?q=loteprednol", headers=admin_headers).json()]
    assert names == ["MOSI LP"]
    assert client.get("/api/medicines?q=mosi lp", headers=admin_headers).json()[0]["manufacturer"] == "FDC"


def test_prescription_matches_brand_and_prints_composition(client, admin_headers, doctor_headers):
    vid = _visit(client, admin_headers, "Brand Patient")
    body = {"lines": [
        {"name": "aquaray gel", "dosage": "1 drop both eyes, thrice daily", "qtyGiven": 0},  # brand, any case
        {"name": "Moxifloxacin Hydrochloride & Loteprednol Etabonate ophthalmic suspension",  # composition
         "dosage": "1 drop right eye, four times daily", "qtyGiven": 0},
        {"name": "Ofloxacin eye ointment", "dosage": "ointment both eyes, at night", "qtyGiven": 0},  # generic
        {"name": "Unknown brand", "dosage": "x", "qtyGiven": 0},
    ]}
    r = client.post(f"/api/visits/{vid}/prescription", json=body, headers=doctor_headers)
    assert r.status_code == 201, r.text
    lines = r.json()["lines"]
    assert [(ln["name"], ln["matched"]) for ln in lines] == [
        ("Aquaray Gel", True), ("MOSI LP", True), ("Ofloxacin eye ointment", True), ("Unknown brand", False)]
    assert [(ln["form"], ln["formLabel"]) for ln in lines] == [
        ("gel", "Gel"), ("suspension", "Suspension"), ("ointment", "Ointment"), (None, None)]
    assert all(ln["medicineId"] for ln in lines[:3]) and lines[3]["medicineId"] is None

    p = client.get(f"/api/visits/{vid}/prescription/print?lang=english", headers=admin_headers).json()
    assert set(p["lines"][0]) == {"name", "dosage", "dosageLocal", "qtyGiven", "brand", "composition", "form",
                                  "formLabel", "packSize"}
    assert p["lines"][0] == {"name": "Aquaray Gel", "brand": "Aquaray Gel",
                             "composition": "Carboxymethylcellulose sodium eye drops IP", "form": "gel",
                             "formLabel": "Gel", "packSize": "10 ml", "dosage": "1 drop both eyes, thrice daily",
                             "dosageLocal": "1 drop both eyes, thrice daily", "qtyGiven": 0}
    assert p["lines"][1]["brand"] == "MOSI LP" and p["lines"][1]["packSize"] == "5 ml"
    assert p["lines"][1]["composition"].startswith("Moxifloxacin Hydrochloride")
    # generic-only row: no brand to print bold, composition == name
    assert p["lines"][2]["brand"] is None and p["lines"][2]["composition"] == "Ofloxacin eye ointment"
    assert p["lines"][2]["form"] == "ointment" and p["lines"][2]["packSize"] is None
    # unmatched free text: nothing but the typed name
    assert p["lines"][3]["brand"] is None and p["lines"][3]["composition"] is None and p["lines"][3]["form"] is None


def test_save_does_not_touch_stock_front_desk_confirms(client, admin_headers, doctor_headers, db):
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
    names = [(ln["name"], ln["matched"], ln["qtyGiven"], ln["dispensedQty"]) for ln in rx["lines"]]
    assert names == [(MOXI, True, 2, 0), (PRED, True, 1, 0), ("Some compounded gel", False, 0, 0)]
    assert rx["lines"][0]["inStock"] == 7 and rx["lines"][2]["inStock"] is None
    # the doctor saving moves nothing
    assert _stock(client, admin_headers, MOXI)["stock"] == 7 and _stock(client, admin_headers, PRED)["stock"] == 10
    assert rx["lowStock"] == []

    # front desk confirms MOXI was bought here (2) -> stock 5, now low
    moxi_line = rx["lines"][0]["id"]
    r = client.post(f"/api/visits/{vid}/prescription/lines/{moxi_line}/dispense", json={"qty": 2}, headers=admin_headers)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["lines"][0]["dispensedQty"] == 2 and out["lines"][0]["dispensedBy"] == "Admin" and out["lines"][0]["dispensedAt"]
    assert out["lowStock"] == [MOXI]
    assert _stock(client, admin_headers, MOXI)["stock"] == 5 and _stock(client, admin_headers, MOXI)["low"] is True
    # confirming twice is refused; PRED was not bought here -> untouched
    assert client.post(f"/api/visits/{vid}/prescription/lines/{moxi_line}/dispense", json={"qty": 1},
                       headers=admin_headers).status_code == 422
    assert _stock(client, admin_headers, PRED)["stock"] == 10
    moves = list(db.scalars(select(StockMovement).where(StockMovement.ref_prescription_id == rx["id"])))
    assert [(m.item_id, m.delta, m.reason) for m in moves] == [(moxi_id, -2, "dispensed")]
    assert all(m.by_staff_id is not None for m in moves)
    # a free-text line has no stock to deduct
    gel_line = rx["lines"][2]["id"]
    assert client.post(f"/api/visits/{vid}/prescription/lines/{gel_line}/dispense", json={"qty": 1},
                       headers=admin_headers).status_code == 422

    # undo puts it back
    r = client.delete(f"/api/visits/{vid}/prescription/lines/{moxi_line}/dispense", headers=admin_headers)
    assert r.status_code == 200 and r.json()["lines"][0]["dispensedQty"] == 0
    assert _stock(client, admin_headers, MOXI)["stock"] == 7

    r = client.get(f"/api/visits/{vid}/prescription", headers=admin_headers)
    assert r.status_code == 200 and r.json()["id"] == rx["id"] and len(r.json()["lines"]) == 3
    v = client.get(f"/api/visits/{vid}", headers=admin_headers).json()
    assert v["hasPrescription"] is True
    assert db.scalar(select(AuditLog).where(AuditLog.entity == "prescription", AuditLog.entity_id == rx["id"]))
    assert pred_id  # (kept for symmetry with the stock helper)


def test_dispense_checks_stock_atomically(client, admin_headers, doctor_headers, db):
    r = client.post("/api/inventory", json={"name": "Rx Scarce Drop", "unit": "bottles", "stock": 1, "reorderLevel": 1},
                    headers=admin_headers)
    assert r.status_code == 201, r.text
    scarce = r.json()["id"]
    vid = _visit(client, admin_headers, "Atomic Patient")
    body = {"lines": [{"name": "rx scarce drop", "dosage": "1 drop left eye, at night", "qtyGiven": 2}]}
    rx = client.post(f"/api/visits/{vid}/prescription", json=body, headers=doctor_headers).json()
    line = rx["lines"][0]["id"]
    r = client.post(f"/api/visits/{vid}/prescription/lines/{line}/dispense", json={"qty": 2}, headers=admin_headers)
    assert r.status_code == 409, r.text
    assert "Rx Scarce Drop" in r.json()["detail"]
    assert client.get(f"/api/inventory/{scarce}", headers=admin_headers).json()["stock"] == 1
    assert db.scalar(select(StockMovement).where(StockMovement.item_id == scarce, StockMovement.reason == "dispensed")) is None
    # the front desk can confirm a smaller quantity
    r = client.post(f"/api/visits/{vid}/prescription/lines/{line}/dispense", json={"qty": 1}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["lines"][0]["dispensedQty"] == 1


def test_repost_keeps_confirmations_and_restores_removed_lines(client, admin_headers, doctor_headers, db):
    _set_stock(client, admin_headers, MOXI, 10)
    _set_stock(client, admin_headers, PRED, 10)
    vid = _visit(client, admin_headers, "Replace Patient")
    first = client.post(f"/api/visits/{vid}/prescription",
                        json={"lines": [{"name": MOXI, "dosage": "1 drop both eyes, twice daily", "qtyGiven": 3},
                                        {"name": PRED, "dosage": "at night", "qtyGiven": 1}]},
                        headers=doctor_headers).json()
    for ln in first["lines"]:
        client.post(f"/api/visits/{vid}/prescription/lines/{ln['id']}/dispense", json={"qty": ln["qtyGiven"]},
                    headers=admin_headers)
    assert _stock(client, admin_headers, MOXI)["stock"] == 7 and _stock(client, admin_headers, PRED)["stock"] == 9

    # doctor edits: keeps PRED (new dosage), drops MOXI
    second = client.post(f"/api/visits/{vid}/prescription",
                         json={"lines": [{"name": PRED, "dosage": "1 drop both eyes, once daily", "qtyGiven": 1}]},
                         headers=doctor_headers)
    assert second.status_code == 201, second.text
    assert second.json()["id"] == first["id"]  # same prescription row, lines replaced
    lines = second.json()["lines"]
    assert [ln["name"] for ln in lines] == [PRED]
    assert lines[0]["dispensedQty"] == 1 and lines[0]["dosage"] == "1 drop both eyes, once daily"  # confirmation kept
    assert _stock(client, admin_headers, MOXI)["stock"] == 10  # removed line's stock restored
    assert _stock(client, admin_headers, PRED)["stock"] == 9


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
