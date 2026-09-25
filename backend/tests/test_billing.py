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
    # "pay" received the whole balance as one payment; the mode fix changed that payment's mode
    b = r.json()
    assert [(p["amount"], p["mode"]) for p in b["payments"]] == [(500, "upi")]
    assert (b["paidAmount"], b["balance"], b["status"]) == (500, 0, "paid")


# --------------------------------------------------------------------------- part payments
def _bill(client, headers, vid, *amounts):
    r = client.put(f"/api/visits/{vid}/bill", json={"items": [{"label": f"Line {i}", "amount": a}
                                                              for i, a in enumerate(amounts)]}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _receive(client, headers, vid, amount, mode="cash", **extra):
    return client.post(f"/api/visits/{vid}/bill/payments", json={"amount": amount, "mode": mode, **extra},
                       headers=headers)


def test_part_payments_balance_and_receipt_number_once(client, admin_headers, reception_headers):
    vid = _visit(client, admin_headers, "Part Payer")
    assert _receive(client, reception_headers, vid, 100).status_code == 404  # no bill yet
    b = _bill(client, reception_headers, vid, 500, 60)
    assert (b["total"], b["paidAmount"], b["balance"], b["status"], b["paid"]) == (560, 0, 560, "unpaid", False)
    assert b["receiptNo"] is None and b["payments"] == [] and b["patientId"]

    r = _receive(client, reception_headers, vid, 500, "cash", note="first part")
    assert r.status_code == 201, r.text
    b = r.json()
    assert (b["paidAmount"], b["balance"], b["status"], b["paid"], b["paidAt"]) == (500, 60, "part_paid", False, None)
    receipt = b["receiptNo"]
    assert receipt and receipt.startswith("GK-")
    assert b["payments"][0]["byName"] == "Bill Reception" and b["payments"][0]["note"] == "first part"
    # the patient page / billing drawer see the balance
    owing = client.get(f"/api/patients/{b['patientId']}/owing", headers=reception_headers).json()
    assert [(o["visitId"], o["balance"], o["paidAmount"]) for o in owing] == [(vid, 60, 500)]

    # more than the balance, a bad mode, zero: refused
    assert _receive(client, reception_headers, vid, 61).status_code == 422
    assert _receive(client, reception_headers, vid, 10, "gold").status_code == 422
    assert _receive(client, reception_headers, vid, 0).status_code == 422

    b = _receive(client, reception_headers, vid, 60, "upi").json()
    assert (b["balance"], b["status"], b["paid"], b["paymentMode"]) == (0, "paid", True, "upi")
    assert b["paidAt"] and b["receiptNo"] == receipt  # the number was given once
    assert [(p["amount"], p["mode"]) for p in b["payments"]] == [(500, "cash"), (60, "upi")]
    assert _receive(client, reception_headers, vid, 1).status_code == 409  # nothing owed
    assert client.get(f"/api/patients/{b['patientId']}/owing", headers=reception_headers).json() == []

    # undo the UPI entry: owing again, the receipt number stays
    pid = b["payments"][1]["id"]
    r = client.delete(f"/api/visits/{vid}/bill/payments/{pid}", headers=reception_headers)
    assert r.status_code == 200, r.text
    b = r.json()
    assert (b["balance"], b["status"], b["paidAt"], b["receiptNo"], b["paymentMode"]) == (
        60, "part_paid", None, receipt, "cash")
    assert client.delete(f"/api/visits/{vid}/bill/payments/{pid}", headers=reception_headers).status_code == 404

    # "pay" (older callers) receives whatever is left
    b = client.post(f"/api/visits/{vid}/bill/pay", json={"paymentMode": "card"}, headers=reception_headers).json()
    assert (b["balance"], b["paid"], [p["amount"] for p in b["payments"]]) == (0, True, [500, 60])


def test_editing_items_after_payment_recomputes_the_balance(client, admin_headers, reception_headers, db):
    from app.models.audit import AuditLog

    vid = _visit(client, admin_headers, "Edited After Paying")
    _bill(client, reception_headers, vid, 300)
    b = client.post(f"/api/visits/{vid}/bill/pay", json={"paymentMode": "cash"}, headers=reception_headers).json()
    assert b["paid"] is True
    # a line added after paying: owing again
    b = _bill(client, reception_headers, vid, 300, 150)
    assert (b["balance"], b["status"], b["paid"], b["paidAt"]) == (150, "part_paid", False, None)
    # a line taken off after paying: money to give back
    b = _bill(client, reception_headers, vid, 250)
    assert (b["balance"], b["status"], b["paid"]) == (-50, "overpaid", True)
    b = _bill(client, reception_headers, vid, 300)
    assert (b["balance"], b["status"], b["paid"]) == (0, "paid", True) and b["paidAt"]
    # payments and undos are audited
    actions = {a.action for a in db.query(AuditLog).filter(AuditLog.entity == "bill", AuditLog.entity_id == b["id"])}
    assert "bill.payment" in actions


def test_zero_bill_closes_as_no_charge_and_never_owes(client, admin_headers, reception_headers):
    vid = _visit(client, admin_headers, "Free Follow Up")
    b = client.put(f"/api/visits/{vid}/bill", json={"items": []}, headers=reception_headers).json()
    assert (b["total"], b["balance"], b["status"], b["paid"]) == (0, 0, "unpaid", False)
    assert client.get(f"/api/patients/{b['patientId']}/owing", headers=reception_headers).json() == []
    assert _receive(client, reception_headers, vid, 1).status_code == 409

    r = client.post(f"/api/visits/{vid}/bill/no-charge", headers=reception_headers)
    assert r.status_code == 200, r.text
    b = r.json()
    assert (b["status"], b["paid"], b["receiptNo"], b["payments"]) == ("no_charge", True, None, [])
    assert b["paidAt"]
    # a bill with an amount can't be closed as no charge
    v2 = _visit(client, admin_headers, "Not Free")
    _bill(client, reception_headers, v2, 200)
    assert client.post(f"/api/visits/{v2}/bill/no-charge", headers=reception_headers).status_code == 409
    # no bill yet: no-charge creates it (a visit whose kind is free has no fee line)
    v3 = _visit(client, admin_headers, "Free No Bill")
    client.put(f"/api/visits/{v3}/bill", json={"items": []}, headers=reception_headers)
    assert client.post(f"/api/visits/{v3}/bill/no-charge", headers=reception_headers).json()["status"] == "no_charge"
    # "pay" on a ₹0 bill closes it too
    v4 = _visit(client, admin_headers, "Free Pay")
    client.put(f"/api/visits/{v4}/bill", json={"items": []}, headers=reception_headers)
    b = client.post(f"/api/visits/{v4}/bill/pay", json={"paymentMode": "cash"}, headers=reception_headers).json()
    assert b["status"] == "no_charge" and b["payments"] == []


# --------------------------------------------------------------------------- day-book column on lines
def test_bill_lines_get_their_day_book_column(client, admin_headers, reception_headers):
    heads = {h["key"] for h in client.get("/api/account-heads", headers=reception_headers).json()}
    assert {"opd", "med", "test", "glasses", "ot", "other"} <= heads
    charges = {c["label"]: c for c in client.get("/api/standard-charges", headers=reception_headers).json()}
    assert charges["Glasses"]["amount"] == 0 and charges["Glasses"]["accountHeadKey"] == "glasses"
    assert charges["Perimetry"]["accountHeadKey"] == "test"

    vid = _visit(client, admin_headers, "Column Patient")
    r = client.put(f"/api/visits/{vid}/bill", json={"items": [
        {"label": "Glasses", "amount": 1200, "kind": "charge", "standardChargeId": charges["Glasses"]["id"]},
        {"label": "Eye patch", "amount": 40},
        {"label": "Frame repair", "amount": 100, "accountHeadKey": "glasses"},
        {"label": "Drops", "amount": 90, "kind": "medicine"},
    ]}, headers=reception_headers)
    assert r.status_code == 200, r.text
    assert [i["accountHeadKey"] for i in r.json()["items"]] == ["glasses", "other", "glasses", "med"]
    bad = {"items": [{"label": "X", "amount": 1, "accountHeadKey": "nope"}]}
    assert client.put(f"/api/visits/{vid}/bill", json=bad, headers=reception_headers).status_code == 422

    # a charge's column is set in Admin (unknown column refused)
    cid = charges["Glasses"]["id"]
    base = "/api/admin/standard-charges"
    assert client.patch(f"{base}/{cid}", json={"accountHeadKey": "nope"}, headers=admin_headers).status_code == 422
    assert client.patch(f"{base}/{cid}", json={"accountHeadKey": "other"},
                        headers=admin_headers).json()["accountHeadKey"] == "other"
    client.patch(f"{base}/{cid}", json={"accountHeadKey": "glasses"}, headers=admin_headers)
    r = client.post(base, json={"label": "Contact lens fitting", "amount": 800, "accountHeadKey": "glasses"},
                    headers=admin_headers)
    assert r.status_code == 201 and r.json()["accountHeadKey"] == "glasses"


# --------------------------------------------------------------------------- standard charges
def test_standard_charges_crud_and_roles(client, admin_headers, reception_headers, db):
    from app.seed.reference import seed_reference

    seed_reference(db)
    base = "/api/admin/standard-charges"
    assert client.get(base, headers=reception_headers).status_code == 403
    assert client.post(base, json={"label": "Nope", "amount": 1}, headers=reception_headers).status_code == 403
    starters = {c["label"] for c in client.get(base, headers=admin_headers).json()}
    # The ₹0 starters became Dr Anu's fees (Consultation -> "Consultation / new file"); see test_visit_fees.
    assert {"Consultation / new file", "Follow-up", "Pre-test", "Dilation", "Perimetry"} <= starters

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


def _meds(bill):
    """The "Bought here" lines (a bill created by dispensing also starts with the suggested visit fee)."""
    return [i for i in bill["items"] if i["kind"] == "medicine"]


def test_bought_here_without_price_adds_zero_line_flagged(client, admin_headers, reception_headers, doctor_headers,
                                                          priced):
    vid = _visit(client, admin_headers, "Unpriced Patient")  # no bill yet — dispensing creates it
    lines = _rx(client, vid, doctor_headers, (PRED, 1))
    client.post(f"/api/visits/{vid}/prescription/lines/{lines[0]['id']}/dispense", json={"qty": 1},
                headers=reception_headers)
    bill = client.get(f"/api/visits/{vid}/bill", headers=reception_headers).json()
    # the new bill starts with the visit's suggested fee (a new patient: Consultation / new file)
    assert ("charge", 700, False, True) in [(i["kind"], i["amount"], i["priceMissing"], i["suggested"])
                                            for i in bill["items"]]
    assert [(i["amount"], i["priceMissing"]) for i in _meds(bill)] == [(0, True)]
    # reception types the price
    items = [{**i, "amount": 60} if i["kind"] == "medicine" else i for i in bill["items"]]
    bill = client.put(f"/api/visits/{vid}/bill", json={"items": items}, headers=reception_headers).json()
    assert _meds(bill)[0]["priceMissing"] is False and _meds(bill)[0]["amount"] == 60


def test_prescription_change_moves_or_drops_bill_lines(client, admin_headers, reception_headers, doctor_headers,
                                                       priced):
    vid = _visit(client, admin_headers, "Changed Rx Patient")
    lines = _rx(client, vid, doctor_headers, (MOXI, 1), (PRED, 1))
    for ln in lines:
        client.post(f"/api/visits/{vid}/prescription/lines/{ln['id']}/dispense", json={"qty": 1},
                    headers=reception_headers)
    assert len(_meds(client.get(f"/api/visits/{vid}/bill", headers=reception_headers).json())) == 2

    # the doctor drops PRED and keeps MOXI: PRED's bill line goes, MOXI's follows the new line id
    new = _rx(client, vid, doctor_headers, (MOXI, 1))
    bill = client.get(f"/api/visits/{vid}/bill", headers=reception_headers).json()
    assert [(i["label"], i["prescriptionLineId"], i["amount"]) for i in _meds(bill)] == [
        (f"{MOXI} × 1", new[0]["id"], 85)]
    # and undo on the new line still finds it (the suggested visit fee stays)
    client.delete(f"/api/visits/{vid}/prescription/lines/{new[0]['id']}/dispense", headers=reception_headers)
    assert _meds(client.get(f"/api/visits/{vid}/bill", headers=reception_headers).json()) == []


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
