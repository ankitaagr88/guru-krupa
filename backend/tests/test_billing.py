"""Per-visit bill, standard charges, receipts and the Today summary (lane B owns this file)."""
import pytest


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
