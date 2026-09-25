"""OT team: team roles and outside doctors in Admin, the options for a case, and the team on a case
(billing.team) — validation, snapshots, fees in the bill total."""
from datetime import date

import pytest

D = date(2032, 5, 17)  # far-future date nobody else in the suite uses
PROC = "Cataract — Phaco with IOL (OD)"


@pytest.fixture(scope="module", autouse=True)
def _seed():
    from app.db import SessionLocal
    from app.seed.reference import seed_reference

    with SessionLocal() as db:
        seed_reference(db)


def _headers(client, db, username, role):
    from app.auth.service import ensure_user

    ensure_user(db, username=username, password="pw12345", name=f"Team {role}", role=role)
    r = client.post("/api/auth/login", json={"username": username, "password": "pw12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def reception_headers(client, db):
    return _headers(client, db, "team_recep", "reception")


@pytest.fixture
def doctor_headers(client, db):
    return _headers(client, db, "team_doc", "doctor")


def _case(client, headers, slot):
    r = client.post("/api/ot/cases", json={"date": D.isoformat(), "timeSlot": slot, "procedure": PROC,
                                           "patientName": "Team Patient"}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _row(**kw):
    row = {"roleKey": "anaesthetist", "roleLabel": "Anaesthetist", "name": "Dr. R. Mehta",
           "qualification": "MD Anaesthesia", "regNo": "G-1234", "external": True, "partnerId": None, "fee": 2500}
    row.update(kw)
    return row


def test_options_any_staff(client, reception_headers, doctor_headers):
    assert client.get("/api/ot/team-options").status_code == 401
    r = client.get("/api/ot/team-options", headers=reception_headers)
    assert r.status_code == 200, r.text
    o = r.json()
    assert [x["label"] for x in o["roles"]][:5] == ["Surgeon", "Assistant surgeon", "Anaesthetist", "Scrub nurse",
                                                     "OT technician"]
    assert all(x["defaultFee"] == 0 for x in o["roles"][:5])
    assert {"name": "Team doctor", "role": "doctor"} in o["staff"]
    assert all(s["role"] in ("doctor", "ot_staff", "optometrist") for s in o["staff"])
    assert isinstance(o["partners"], list)


def test_admin_roles_crud_and_reorder(client, admin_headers, reception_headers):
    assert client.get("/api/admin/ot-team-roles", headers=reception_headers).status_code == 403
    r = client.post("/api/admin/ot-team-roles", json={"label": "Circulating nurse", "defaultFee": 500},
                    headers=admin_headers)
    assert r.status_code == 201, r.text
    role = r.json()
    assert (role["key"], role["label"], role["defaultFee"], role["active"]) == (
        "circulating_nurse", "Circulating nurse", 500, True)
    assert client.post("/api/admin/ot-team-roles", json={"label": "surgeon"}, headers=admin_headers).status_code == 409
    assert client.post("/api/admin/ot-team-roles", json={"label": "X", "defaultFee": -1},
                       headers=admin_headers).status_code == 422

    r = client.patch("/api/admin/ot-team-roles/anaesthetist", json={"defaultFee": 3000}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["defaultFee"] == 3000
    r = client.patch("/api/admin/ot-team-roles/circulating_nurse", json={"label": "Floor nurse", "active": False},
                     headers=admin_headers)
    assert r.status_code == 200 and (r.json()["label"], r.json()["active"]) == ("Floor nurse", False)
    assert client.patch("/api/admin/ot-team-roles/nope", json={"active": False},
                        headers=admin_headers).status_code == 404

    keys = [x["key"] for x in client.get("/api/admin/ot-team-roles", headers=admin_headers).json()]
    assert "circulating_nurse" in keys  # switched off rows still listed for Admin
    options = client.get("/api/ot/team-options", headers=admin_headers).json()["roles"]
    assert "circulating_nurse" not in [x["key"] for x in options]
    new = list(reversed(keys))
    r = client.put("/api/admin/ot-team-roles/order", json={"keys": new}, headers=admin_headers)
    assert r.status_code == 200 and [x["key"] for x in r.json()] == new
    assert client.put("/api/admin/ot-team-roles/order", json={"keys": new[:-1]},
                      headers=admin_headers).status_code == 422
    client.put("/api/admin/ot-team-roles/order", json={"keys": keys}, headers=admin_headers)
    client.patch("/api/admin/ot-team-roles/anaesthetist", json={"defaultFee": 0}, headers=admin_headers)


def test_admin_partners_crud(client, admin_headers, reception_headers):
    assert client.post("/api/admin/ot-partners", json={"name": "Dr. X", "qualification": "MD"},
                       headers=reception_headers).status_code == 403
    r = client.post("/api/admin/ot-partners", json={"name": "Dr. No Degree"}, headers=admin_headers)
    assert r.status_code == 422 and "qualification" in r.json()["detail"]
    r = client.post("/api/admin/ot-partners", json={"name": "Dr. Bad Role", "qualification": "MD",
                                                    "defaultRoleKey": "juggler"}, headers=admin_headers)
    assert r.status_code == 422
    r = client.post("/api/admin/ot-partners", json={
        "name": "  Dr.  Kavita Shah ", "qualification": "MD Anaesthesia", "regNo": "G-777", "phone": "9876543210",
        "defaultRoleKey": "anaesthetist", "defaultFee": 2500, "note": "Tuesdays"}, headers=admin_headers)
    assert r.status_code == 201, r.text
    p = r.json()
    assert (p["name"], p["qualification"], p["regNo"], p["defaultRoleKey"], p["defaultFee"], p["active"]) == (
        "Dr. Kavita Shah", "MD Anaesthesia", "G-777", "anaesthetist", 2500, True)
    assert client.post("/api/admin/ot-partners", json={"name": "dr. kavita shah", "qualification": "MD"},
                       headers=admin_headers).status_code == 409

    r = client.patch(f"/api/admin/ot-partners/{p['id']}", json={"defaultFee": 2800, "defaultRoleKey": ""},
                     headers=admin_headers)
    assert r.status_code == 200 and (r.json()["defaultFee"], r.json()["defaultRoleKey"]) == (2800, None)
    assert client.patch(f"/api/admin/ot-partners/{p['id']}", json={"qualification": " "},
                        headers=admin_headers).status_code == 422
    assert client.patch("/api/admin/ot-partners/999999", json={"active": False}, headers=admin_headers).status_code == 404

    names = [x["name"] for x in client.get("/api/ot/team-options", headers=reception_headers).json()["partners"]]
    assert "Dr. Kavita Shah" in names
    client.patch(f"/api/admin/ot-partners/{p['id']}", json={"active": False}, headers=admin_headers)
    names = [x["name"] for x in client.get("/api/ot/team-options", headers=reception_headers).json()["partners"]]
    assert "Dr. Kavita Shah" not in names
    assert "Dr. Kavita Shah" in [x["name"] for x in client.get("/api/admin/ot-partners", headers=admin_headers).json()]


def test_new_case_starts_with_the_clinic_surgeon(client, admin_headers):
    before = client.get("/api/rx-print/settings", headers=admin_headers).json()
    client.put("/api/admin/rx-print/settings", json={**before, "doctorName": "Dr. Anu Juneja Pathak",
                                                     "degrees": "M.S. (Ophth.)", "regNo": "G-42"}, headers=admin_headers)
    try:
        c = _case(client, admin_headers, "9:00 AM")
    finally:
        client.put("/api/admin/rx-print/settings", json=before, headers=admin_headers)
    assert c["billing"]["team"] == [{"roleKey": "surgeon", "roleLabel": "Surgeon", "name": "Dr. Anu Juneja Pathak",
                                     "qualification": "M.S. (Ophth.)", "regNo": "G-42", "external": False,
                                     "partnerId": None, "fee": 0}]
    assert (c["billing"]["teamFees"], c["billing"]["total"]) == (0, 0)


def test_team_validation_fees_and_total(client, admin_headers, reception_headers):
    c = _case(client, admin_headers, "9:45 AM")
    url = f"/api/ot/cases/{c['id']}"
    surgeon = c["billing"]["team"][0]

    # reception may edit the team (billing section); lists replace, text is tidied, empty rows dropped
    team = [dict(surgeon, fee=5000), _row(name="  Dr.  R. Mehta "),
            {"roleKey": "scrub_nurse", "name": "", "qualification": "", "regNo": "", "fee": 0}]
    r = client.patch(url, json={"billing": {"team": team, "lensTier": "toric"}}, headers=reception_headers)
    assert r.status_code == 200, r.text
    b = r.json()["billing"]
    assert [m["name"] for m in b["team"]] == ["Dr. Anu Juneja Pathak", "Dr. R. Mehta"]
    assert (b["lensPrice"], b["teamFees"], b["total"]) == (38000, 7500, 45500)

    def bad(team_rows, needle):
        r = client.patch(url, json={"billing": {"team": team_rows}}, headers=reception_headers)
        assert r.status_code == 422, r.text
        assert needle in r.json()["detail"], r.json()["detail"]

    bad([surgeon, _row(qualification="")], "row 2 (Anaesthetist, Dr. R. Mehta): an outside doctor needs a medical "
                                           "qualification")
    bad([_row(roleKey="juggler")], "unknown role")
    bad([_row(roleKey="")], "pick a role")
    bad([_row(name="", fee=100)], "enter the person's name")
    bad([_row(fee=-5)], "cannot be below ₹0")
    bad([_row(fee=12.5)], "whole rupees")
    bad([_row(partnerId=987654)], "unknown outside doctor")
    # nothing was saved by the refused patches
    g = client.get(url, headers=admin_headers).json()["billing"]
    assert g["teamFees"] == 7500 and len(g["team"]) == 2

    # an inside member needs no qualification; a fee typed as text is accepted when it is whole rupees
    r = client.patch(url, json={"billing": {"team": [dict(surgeon, qualification="", fee="1,000")]}},
                     headers=reception_headers)
    assert r.status_code == 200 and r.json()["billing"]["teamFees"] == 1000

    # other billing edits keep the team
    r = client.patch(url, json={"billing": {"paymentMode": "cash"}}, headers=reception_headers)
    assert r.json()["billing"]["team"][0]["fee"] == 1000 and r.json()["billing"]["total"] == 39000


def test_team_snapshot_kept_after_partner_rename(client, admin_headers):
    p = client.post("/api/admin/ot-partners", json={"name": "Dr. Snap Shot", "qualification": "DA",
                                                    "defaultFee": 1800}, headers=admin_headers).json()
    c = _case(client, admin_headers, "10:30 AM")
    url = f"/api/ot/cases/{c['id']}"
    row = _row(name=p["name"], qualification=p["qualification"], partnerId=p["id"], fee=p["defaultFee"])
    r = client.patch(url, json={"billing": {"team": [row]}}, headers=admin_headers)
    assert r.status_code == 200, r.text
    client.patch(f"/api/admin/ot-partners/{p['id']}", json={"name": "Dr. Renamed", "qualification": "MD"},
                 headers=admin_headers)
    client.patch("/api/admin/ot-team-roles/anaesthetist", json={"label": "Anaesthesia doctor"}, headers=admin_headers)
    try:
        m = client.get(url, headers=admin_headers).json()["billing"]["team"][0]
        assert (m["name"], m["qualification"], m["roleLabel"], m["partnerId"]) == (
            "Dr. Snap Shot", "DA", "Anaesthetist", p["id"])
    finally:
        client.patch("/api/admin/ot-team-roles/anaesthetist", json={"label": "Anaesthetist"}, headers=admin_headers)


def test_old_case_shows_operative_surgeon(client, admin_headers, db):
    from app.models.ot import OtCase

    case = OtCase(patient_name="Old Case", date=D, time_slot="3:00 PM", procedure=PROC, status="completed",
                  operative={"surgeon": "Dr. Old Name"}, billing={"lensTier": "monofocal", "mediclaim": False,
                                                                  "paymentMode": None})
    db.add(case)
    db.commit()
    b = client.get(f"/api/ot/cases/{case.id}", headers=admin_headers).json()["billing"]
    assert [(m["roleKey"], m["name"], m["fee"]) for m in b["team"]] == [("surgeon", "Dr. Old Name", 0)]
    assert (b["teamFees"], b["total"]) == (0, 28500)
    db.refresh(case)
    assert "team" not in case.billing  # shown, not written


def test_times_need_a_clinical_role(client, admin_headers, reception_headers, doctor_headers):
    c = _case(client, admin_headers, "11:15 AM")
    url = f"/api/ot/cases/{c['id']}"
    assert client.patch(url, json={"operative": {"startTime": "09:10"}}, headers=reception_headers).status_code == 403
    r = client.patch(url, json={"operative": {"startTime": "09:10", "endTime": "09:40"}}, headers=doctor_headers)
    assert r.status_code == 200 and r.json()["operative"]["endTime"] == "09:40"
