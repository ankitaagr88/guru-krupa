from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.models import AuditLog, MrVisit
from app.seed.reference import seed_reference


@pytest.fixture(scope="module", autouse=True)
def _seed_and_clear():
    from app.db import SessionLocal

    with SessionLocal() as db:
        seed_reference(db)
        for v in db.scalars(select(MrVisit)):
            db.delete(v)
        db.commit()


@pytest.fixture
def doctor_headers(client, db):
    from app.auth.service import ensure_user

    ensure_user(db, username="mrdoc", password="doc123", name="Dr MR", role="doctor")
    r = client.post("/api/auth/login", json={"username": "mrdoc", "password": "doc123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def reception_headers(client, db):
    from app.auth.service import ensure_user

    ensure_user(db, username="mrrecep", password="rec123", name="MR Reception", role="reception")
    r = client.post("/api/auth/login", json={"username": "mrrecep", "password": "rec123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _iso(days_ago: int) -> str:
    return (date.today() - timedelta(days=days_ago)).isoformat()


def test_mr_crud_and_reps(client, admin_headers, reception_headers, doctor_headers, db):
    assert client.get("/api/mr-visits").status_code == 401
    r = client.post("/api/mr-visits", json={"repName": "Rajesh Kumar", "company": "Sun Pharma", "phone": "98240 11111",
                                            "products": "Moxifloxacin, Carboxymethylcellulose (tear drops)",
                                            "visitDate": _iso(42), "notes": "First introduction visit"},
                    headers=reception_headers)
    assert r.status_code == 201, r.text
    first = r.json()
    assert first["visitDate"] == _iso(42) and first["nextVisitDate"] is None and first["createdAt"]
    r = client.post("/api/mr-visits", json={"repName": "Anita Desai", "company": "Cipla", "phone": "99250 22222",
                                            "products": "Latanoprost, Timolol", "visitDate": _iso(10),
                                            "nextVisitDate": _iso(-7)}, headers=admin_headers)
    anita = r.json()
    r = client.post("/api/mr-visits", json={"repName": "Rajesh Kumar", "company": "Sun Pharma", "phone": "98240 11111",
                                            "products": "Moxifloxacin, Prednisolone acetate", "visitDate": _iso(3),
                                            "nextVisitDate": _iso(-14), "notes": "Left samples"}, headers=admin_headers)
    latest = r.json()
    # visitDate defaults to today
    r = client.post("/api/mr-visits", json={"repName": "Temp Rep", "company": "Alkem"}, headers=admin_headers)
    assert r.status_code == 201 and r.json()["visitDate"] == date.today().isoformat() and r.json()["products"] == ""
    temp = r.json()["id"]

    rows = client.get("/api/mr-visits", headers=doctor_headers).json()
    assert [x["id"] for x in rows] == [temp, latest["id"], anita["id"], first["id"]]  # newest first
    assert [x["id"] for x in client.get("/api/mr-visits?rep=rajesh", headers=admin_headers).json()] == [latest["id"], first["id"]]
    assert [x["id"] for x in client.get("/api/mr-visits?company=cipla", headers=admin_headers).json()] == [anita["id"]]
    assert client.get("/api/mr-visits?rep=nobody", headers=admin_headers).json() == []

    r = client.patch(f"/api/mr-visits/{temp}", json={"notes": "Brought catalogue", "nextVisitDate": _iso(-30)},
                     headers=reception_headers)
    assert r.status_code == 200 and r.json()["notes"] == "Brought catalogue" and r.json()["nextVisitDate"] == _iso(-30)
    assert client.get(f"/api/mr-visits/{temp}", headers=admin_headers).json()["company"] == "Alkem"
    assert client.patch(f"/api/mr-visits/{temp}", json={"notes": "x"}, headers=doctor_headers).status_code == 403
    assert client.post("/api/mr-visits", json={"repName": "X", "company": "Y"}, headers=doctor_headers).status_code == 403
    assert client.delete(f"/api/mr-visits/{temp}", headers=doctor_headers).status_code == 403
    assert client.delete(f"/api/mr-visits/{temp}", headers=reception_headers).status_code == 204
    assert client.get(f"/api/mr-visits/{temp}", headers=admin_headers).status_code == 404
    assert client.delete(f"/api/mr-visits/{temp}", headers=admin_headers).status_code == 404
    assert client.post("/api/mr-visits", json={"repName": "", "company": "Y"}, headers=admin_headers).status_code == 422

    reps = client.get("/api/mr-visits/reps", headers=doctor_headers).json()
    assert [(r["repName"], r["company"]) for r in reps] == [("Rajesh Kumar", "Sun Pharma"), ("Anita Desai", "Cipla")]
    rajesh = reps[0]
    assert rajesh["visits"] == 2 and rajesh["phone"] == "98240 11111"
    assert rajesh["lastVisitDate"] == _iso(3) and rajesh["nextVisitDate"] == _iso(-14)
    assert rajesh["products"] == ["Moxifloxacin", "Prednisolone acetate", "Carboxymethylcellulose (tear drops)"]
    assert reps[1]["visits"] == 1 and reps[1]["products"] == ["Latanoprost", "Timolol"]

    actions = [a.action for a in db.scalars(select(AuditLog).where(AuditLog.entity == "mr_visit").order_by(AuditLog.id))]
    assert {"mr_visit.create", "mr_visit.update", "mr_visit.delete"} <= set(actions)
