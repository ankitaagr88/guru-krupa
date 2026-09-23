"""Per-visit bill, standard charges, receipts and the Today summary (lane B owns this file)."""
import pytest


@pytest.fixture(scope="module", autouse=True)
def _seed():
    from app.db import SessionLocal
    from app.seed.reference import seed_reference

    with SessionLocal() as db:  # stages, medicines, stock and the starter charges
        seed_reference(db)


@pytest.fixture
def reception_headers(client, db):
    from app.auth.service import ensure_user

    ensure_user(db, username="billrecep", password="rec123", name="Bill Reception", role="reception")
    r = client.post("/api/auth/login", json={"username": "billrecep", "password": "rec123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _visit(client, headers, name="Bill Patient", **patient):
    pid = client.post("/api/patients", json={"name": name, "age": 61, "sex": "F", **patient}, headers=headers).json()["id"]
    r = client.post("/api/visits", json={"patientId": pid}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


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
    # paying gives a receipt number; paying again with another mode keeps it
    receipt = client.get(f"/api/visits/{vid}/bill", headers=admin_headers).json()["receiptNo"]
    assert receipt and receipt.startswith("GK-")
    r = client.post(f"/api/visits/{vid}/bill/pay", json={"paymentMode": "upi"}, headers=admin_headers)
    assert r.json()["receiptNo"] == receipt and r.json()["paymentMode"] == "upi"
    assert r.json()["patientName"] == "Bill Patient" and r.json()["token"].startswith("#")


# --------------------------------------------------------------------------- standard charges
def test_standard_charges_crud_and_roles(client, admin_headers, reception_headers, db):
    from app.seed.reference import seed_reference

    seed_reference(db)
    base = "/api/admin/standard-charges"
    assert client.get(base, headers=reception_headers).status_code == 403
    assert client.post(base, json={"label": "Nope", "amount": 1}, headers=reception_headers).status_code == 403
    starters = {c["label"] for c in client.get(base, headers=admin_headers).json()}
    assert {"Consultation", "Follow-up consultation", "Pre-test", "Dilation"} <= starters

    r = client.post(base, json={"label": "  Charge  Test  ", "amount": 300}, headers=admin_headers)
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    assert r.json()["label"] == "Charge Test" and r.json()["amount"] == 300 and r.json()["active"] is True
    assert client.post(base, json={"label": "charge test", "amount": 1}, headers=admin_headers).status_code == 409
    assert client.post(base, json={"label": "Negative", "amount": -1}, headers=admin_headers).status_code == 422

    r = client.patch(f"{base}/{cid}", json={"label": "Charge Test B", "amount": 350}, headers=admin_headers)
    assert r.status_code == 200 and (r.json()["label"], r.json()["amount"]) == ("Charge Test B", 350)
    # any staff reads the active list (the one-tap chips)
    assert "Charge Test B" in [c["label"] for c in client.get("/api/standard-charges", headers=reception_headers).json()]
    client.patch(f"{base}/{cid}", json={"active": False}, headers=admin_headers)
    assert "Charge Test B" not in [c["label"] for c in client.get("/api/standard-charges", headers=reception_headers).json()]
    assert "Charge Test B" in [c["label"] for c in client.get(base, headers=admin_headers).json()]
    client.patch(f"{base}/{cid}", json={"active": True}, headers=admin_headers)

    # reorder: every id exactly once
    ids = [c["id"] for c in client.get(base, headers=admin_headers).json()]
    r = client.put(f"{base}/order", json={"ids": [cid] + [i for i in ids if i != cid]}, headers=admin_headers)
    assert r.status_code == 200 and r.json()[0]["id"] == cid
    assert client.get("/api/standard-charges", headers=reception_headers).json()[0]["id"] == cid
    assert client.put(f"{base}/order", json={"ids": [cid]}, headers=admin_headers).status_code == 422

    # used on a bill -> can't delete (switch off instead); an unused one deletes
    vid = _visit(client, admin_headers, "Charge Patient")
    client.put(f"/api/visits/{vid}/bill", json={"items": [{"label": "Charge Test B", "amount": 350, "kind": "charge",
                                                           "standardChargeId": cid}]}, headers=reception_headers)
    r = client.delete(f"{base}/{cid}", headers=admin_headers)
    assert r.status_code == 409 and "switch it off" in r.json()["detail"]
    spare = client.post(base, json={"label": "Charge Spare", "amount": 0}, headers=admin_headers).json()["id"]
    assert client.delete(f"{base}/{spare}", headers=admin_headers).status_code == 204
    assert client.delete(f"{base}/{spare}", headers=admin_headers).status_code == 404


def test_bill_lines_carry_kind_qty_and_links(client, admin_headers, reception_headers):
    vid = _visit(client, admin_headers, "Kinds Patient")
    cid = client.post("/api/admin/standard-charges", json={"label": "Kinds Consult", "amount": 400},
                      headers=admin_headers).json()["id"]
    r = client.put(f"/api/visits/{vid}/bill", json={"items": [
        {"label": "Kinds Consult", "amount": 300, "kind": "charge", "standardChargeId": cid},  # discounted
        {"label": "Eye patch", "amount": 40, "qty": 2},
    ]}, headers=reception_headers)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [(i["kind"], i["qty"], i["amount"], i["standardChargeId"]) for i in items] == [
        ("charge", 1, 300, cid), ("other", 2, 40, None)]
    assert r.json()["total"] == 340
    bad = {"items": [{"label": "X", "amount": 1, "kind": "gift"}]}
    assert client.put(f"/api/visits/{vid}/bill", json=bad, headers=reception_headers).status_code == 422
    bad = {"items": [{"label": "X", "amount": 1, "kind": "charge", "standardChargeId": 999999}]}
    assert client.put(f"/api/visits/{vid}/bill", json=bad, headers=reception_headers).status_code == 422


# --------------------------------------------------------------------------- "Bought here"
MOXI = "Moxifloxacin 0.5% eye drops"
PRED = "Prednisolone acetate 1% eye drops"


@pytest.fixture
def doctor_headers(client, db):
    from app.auth.service import ensure_user

    ensure_user(db, username="billdoc", password="doc123", name="Bill Doctor", role="doctor")
    r = client.post("/api/auth/login", json={"username": "billdoc", "password": "doc123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def priced(client, admin_headers, db):
    """MOXI costs 85 a pack, PRED has no price; stock topped up. MOXI's price is reset afterwards."""
    from app.seed.reference import seed_reference

    seed_reference(db)
    meds = {m["name"]: m for m in client.get("/api/admin/medicines", headers=admin_headers).json()}
    client.patch(f"/api/admin/medicines/{meds[MOXI]['id']}", json={"price": 85}, headers=admin_headers)
    client.patch(f"/api/admin/medicines/{meds[PRED]['id']}", json={"price": None}, headers=admin_headers)
    for item in client.get("/api/inventory", headers=admin_headers).json():
        if item["name"] in (MOXI, PRED) and item["stock"] < 20:
            client.post(f"/api/inventory/{item['id']}/adjust", json={"delta": 20, "reason": "received"},
                        headers=admin_headers)
    yield meds
    client.patch(f"/api/admin/medicines/{meds[MOXI]['id']}", json={"price": None}, headers=admin_headers)


def _rx(client, vid, doctor_headers, *lines):
    r = client.post(f"/api/visits/{vid}/prescription",
                    json={"lines": [{"name": n, "dosage": "1 drop both eyes, twice daily", "qtyGiven": q}
                                    for n, q in lines]},
                    headers=doctor_headers)
    assert r.status_code == 201, r.text
    return r.json()["lines"]


def test_bought_here_adds_priced_bill_line_and_undo_removes_it(client, admin_headers, reception_headers,
                                                               doctor_headers, priced):
    vid = _visit(client, admin_headers, "Bought Patient")
    client.put(f"/api/visits/{vid}/bill", json={"items": [{"label": "Consultation", "amount": 300}]},
               headers=reception_headers)
    lines = _rx(client, vid, doctor_headers, (MOXI, 2), (PRED, 1))
    assert lines[0]["price"] == 85 and lines[1]["price"] is None

    r = client.post(f"/api/visits/{vid}/prescription/lines/{lines[0]['id']}/dispense", json={"qty": 2},
                    headers=reception_headers)
    assert r.status_code == 200, r.text
    bill = client.get(f"/api/visits/{vid}/bill", headers=reception_headers).json()
    med = [i for i in bill["items"] if i["kind"] == "medicine"]
    assert len(med) == 1 and med[0]["amount"] == 170 and med[0]["qty"] == 2
    assert med[0]["label"] == f"{MOXI} × 2" and med[0]["prescriptionLineId"] == lines[0]["id"]
    assert med[0]["priceMissing"] is False and bill["total"] == 470

    # saving the bill from the panel (items round-trip) keeps the medicine line linked
    client.put(f"/api/visits/{vid}/bill", json={"items": bill["items"]}, headers=reception_headers)
    # undo takes it off the bill again
    r = client.delete(f"/api/visits/{vid}/prescription/lines/{lines[0]['id']}/dispense", headers=reception_headers)
    assert r.status_code == 200
    bill = client.get(f"/api/visits/{vid}/bill", headers=reception_headers).json()
    assert [i["label"] for i in bill["items"]] == ["Consultation"] and bill["total"] == 300


def test_bought_here_without_price_adds_zero_line_flagged(client, admin_headers, reception_headers, doctor_headers,
                                                          priced):
    vid = _visit(client, admin_headers, "Unpriced Patient")  # no bill yet — dispensing creates it
    lines = _rx(client, vid, doctor_headers, (PRED, 1))
    client.post(f"/api/visits/{vid}/prescription/lines/{lines[0]['id']}/dispense", json={"qty": 1},
                headers=reception_headers)
    bill = client.get(f"/api/visits/{vid}/bill", headers=reception_headers).json()
    assert [(i["kind"], i["amount"], i["priceMissing"]) for i in bill["items"]] == [("medicine", 0, True)]
    # reception types the price
    items = [{**bill["items"][0], "amount": 60}]
    bill = client.put(f"/api/visits/{vid}/bill", json={"items": items}, headers=reception_headers).json()
    assert bill["items"][0]["priceMissing"] is False and bill["total"] == 60


def test_prescription_change_moves_or_drops_bill_lines(client, admin_headers, reception_headers, doctor_headers,
                                                       priced):
    vid = _visit(client, admin_headers, "Changed Rx Patient")
    lines = _rx(client, vid, doctor_headers, (MOXI, 1), (PRED, 1))
    for ln in lines:
        client.post(f"/api/visits/{vid}/prescription/lines/{ln['id']}/dispense", json={"qty": 1},
                    headers=reception_headers)
    assert len(client.get(f"/api/visits/{vid}/bill", headers=reception_headers).json()["items"]) == 2

    # the doctor drops PRED and keeps MOXI: PRED's bill line goes, MOXI's follows the new line id
    new = _rx(client, vid, doctor_headers, (MOXI, 1))
    bill = client.get(f"/api/visits/{vid}/bill", headers=reception_headers).json()
    assert [(i["label"], i["prescriptionLineId"], i["amount"]) for i in bill["items"]] == [
        (f"{MOXI} × 1", new[0]["id"], 85)]
    # and undo on the new line still finds it
    client.delete(f"/api/visits/{vid}/prescription/lines/{new[0]['id']}/dispense", headers=reception_headers)
    assert client.get(f"/api/visits/{vid}/bill", headers=reception_headers).json()["items"] == []


# --------------------------------------------------------------------------- receipts
def test_receipt_numbers_are_sequential_per_year(client, admin_headers, db):
    from app.models.billing import Bill
    from app.services.billing import next_receipt_no

    nums = []
    for n in range(3):
        vid = _visit(client, admin_headers, f"Receipt Patient {n}")
        client.put(f"/api/visits/{vid}/bill", json={"items": [{"label": "Consultation", "amount": 100}]},
                   headers=admin_headers)
        assert client.get(f"/api/visits/{vid}/bill", headers=admin_headers).json()["receiptNo"] is None  # not paid
        nums.append(client.post(f"/api/visits/{vid}/bill/pay", json={"paymentMode": "cash"},
                                headers=admin_headers).json()["receiptNo"])
    year = nums[0].split("-")[1]
    seq = [int(x.split("-")[2]) for x in nums]
    assert all(x.startswith(f"GK-{year}-") and len(x) == len(f"GK-{year}-00001") for x in nums)
    assert seq == [seq[0], seq[0] + 1, seq[0] + 2]
    # a new year starts again at 1; the next number this year follows the last one
    assert next_receipt_no(db, 1999) == "GK-1999-00001"
    assert next_receipt_no(db, int(year)) == f"GK-{year}-{seq[2] + 1:05d}"
    paid = [b.receipt_no for b in db.query(Bill).filter(Bill.receipt_no.is_not(None))]
    assert len(set(paid)) == len(paid)
