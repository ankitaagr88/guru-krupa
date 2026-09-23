"""Families on one mobile number: the family card, link / relation / owner / remove rules, the admin
relations list and "Group patients who share a number"."""
import pytest

from app.models.config import Relation
from app.models.patients import Patient
from app.seed.family import RELATIONS, seed_family
from app.seed.reference import seed_reference


@pytest.fixture(scope="module", autouse=True)
def _seed():
    from app.db import SessionLocal

    with SessionLocal() as db:
        seed_reference(db)


@pytest.fixture
def reception_headers(client, db):
    from app.auth.service import ensure_user

    ensure_user(db, username="fam_recep", password="rec123", name="Front Desk", role="reception")
    r = client.post("/api/auth/login", json={"username": "fam_recep", "password": "rec123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _new(client, h, name, phone, **extra):
    r = client.post("/api/patients", json={"name": name, "phone": phone, "age": 40, "sex": "F", **extra}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def _family(client, h, pid):
    r = client.get(f"/api/patients/{pid}/family", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_seed_is_idempotent_and_keeps_admin_edits(db):
    keys = [r.key for r in db.query(Relation).order_by(Relation.sort_order)]
    assert keys[:3] == ["spouse", "son", "daughter"] and len(keys) >= len(RELATIONS)
    son = db.query(Relation).filter_by(key="son").one()
    son.label = "Son (beta)"
    db.commit()
    seed_family(db)
    db.commit()
    assert db.query(Relation).filter_by(key="son").one().label == "Son (beta)"
    son.label = "Son"
    db.commit()


def test_new_patient_as_family_member(client, admin_headers):
    h = admin_headers
    owner = _new(client, h, "Rasila Patel", "98111 00001")
    assert owner["familySize"] == 1 and owner["familyOwnerId"] is None
    kid = _new(client, h, "Jay Patel", "9811100001", familyOwnerId=owner["id"], relationKey="son", sex="M", age=12)
    assert kid["familyOwnerId"] == owner["id"] and kid["relationKey"] == "son"
    assert kid["relationLabel"] == "Son" and kid["familyOwnerName"] == "Rasila Patel" and kid["familySize"] == 2
    assert kid["phone"] == "98111 00001"  # a member takes the owner's number as written on file

    # Linking to a member links to that member's owner; relation "not set" is allowed.
    kid2 = _new(client, h, "Riya Patel", "98111 00001", familyOwnerId=kid["id"])
    assert kid2["familyOwnerId"] == owner["id"] and kid2["relationKey"] is None and kid2["familySize"] == 3

    fam = _family(client, h, kid["id"])
    assert fam["ownerId"] == owner["id"]
    assert [m["name"] for m in fam["members"]] == ["Rasila Patel", "Jay Patel", "Riya Patel"]
    assert fam["members"][0]["isOwner"] and fam["members"][0]["relationKey"] is None
    assert fam["members"][1]["relationLabel"] == "Son" and fam["members"][1]["age"] == 12

    # The owner's card, search and by-phone rows all carry the family facts.
    got = client.get(f"/api/patients/{owner['id']}", headers=h).json()
    assert got["familySize"] == 3 and got["relationKey"] is None
    rows = client.get("/api/patients/by-phone", params={"phone": "9811100001"}, headers=h).json()
    assert {r["name"]: r["relationLabel"] for r in rows} == {"Rasila Patel": None, "Jay Patel": "Son",
                                                             "Riya Patel": None}
    hits = client.get("/api/patients", params={"q": "Jay Patel"}, headers=h).json()
    assert hits[0]["familyOwnerName"] == "Rasila Patel"


def test_new_patient_bad_family_link_saves_nothing(client, admin_headers, db):
    h = admin_headers
    owner = _new(client, h, "Bad Link Owner", "98111 00002")
    before = db.query(Patient).count()
    r = client.post("/api/patients", json={"name": "X", "familyOwnerId": 999999}, headers=h)
    assert r.status_code == 404
    r = client.post("/api/patients", json={"name": "X", "familyOwnerId": owner["id"], "relationKey": "cousin"},
                    headers=h)
    assert r.status_code == 422 and "relation" in r.json()["detail"]
    db.expire_all()
    assert db.query(Patient).count() == before


def test_link_change_relation_make_owner_remove(client, reception_headers):
    h = reception_headers
    dad = _new(client, h, "Mahesh Shah", "98111 00003", sex="M")
    mom = _new(client, h, "Nita Shah", "98111 00003")
    son = _new(client, h, "Om Shah", "98111 00003", sex="M")

    # Before anyone is linked the others show as "on this number".
    fam = _family(client, h, mom["id"])
    assert fam["ownerId"] is None and fam["members"] == []
    assert {x["name"] for x in fam["samePhone"]} == {"Mahesh Shah", "Om Shah"}

    r = client.post(f"/api/patients/{mom['id']}/family", json={"ownerId": dad["id"], "relationKey": "spouse"},
                    headers=h)
    assert r.status_code == 200, r.text
    r = client.post(f"/api/patients/{son['id']}/family", json={"ownerId": mom["id"]}, headers=h)
    fam = r.json()
    assert fam["ownerId"] == dad["id"] and len(fam["members"]) == 3 and fam["samePhone"] == []

    r = client.patch(f"/api/patients/{son['id']}/family", json={"relationKey": "son"}, headers=h)
    assert r.status_code == 200 and r.json()["members"][2]["relationLabel"] == "Son"
    # The owner has no relation; unknown / switched-off relations are refused.
    assert client.patch(f"/api/patients/{dad['id']}/family", json={"relationKey": "son"}, headers=h).status_code == 409
    assert client.patch(f"/api/patients/{son['id']}/family", json={"relationKey": "nope"},
                        headers=h).status_code == 422

    # No loops: the owner cannot join their own member's family.
    r = client.post(f"/api/patients/{dad['id']}/family", json={"ownerId": son["id"], "relationKey": "father"},
                    headers=h)
    assert r.status_code == 409

    # Make Nita the owner: the others re-point to her, Mahesh becomes her spouse.
    r = client.post(f"/api/patients/{mom['id']}/family/owner", json={"oldOwnerRelationKey": "spouse"}, headers=h)
    assert r.status_code == 200, r.text
    fam = r.json()
    assert fam["ownerId"] == mom["id"] and "check" in fam["message"]
    by_name = {m["name"]: m for m in fam["members"]}
    assert by_name["Nita Shah"]["isOwner"] and by_name["Mahesh Shah"]["relationKey"] == "spouse"
    assert by_name["Om Shah"]["relationKey"] == "son"
    assert client.get(f"/api/patients/{son['id']}", headers=h).json()["familyOwnerName"] == "Nita Shah"
    # Only a member can be made owner.
    assert client.post(f"/api/patients/{mom['id']}/family/owner", json={}, headers=h).status_code == 409

    # The owner of a family of three cannot just leave; a member can.
    assert client.delete(f"/api/patients/{mom['id']}/family", headers=h).status_code == 409
    r = client.delete(f"/api/patients/{son['id']}/family", headers=h)
    assert r.status_code == 200 and r.json()["ownerId"] is None
    # Two left: removing the owner undoes the family.
    r = client.delete(f"/api/patients/{mom['id']}/family", headers=h)
    assert r.status_code == 200 and "separate" in r.json()["message"]
    assert client.get(f"/api/patients/{dad['id']}", headers=h).json()["familyOwnerId"] is None
    assert client.delete(f"/api/patients/{dad['id']}/family", headers=h).status_code == 409


def test_linking_an_owner_brings_their_members(client, admin_headers):
    h = admin_headers
    a = _new(client, h, "Owner A", "98111 00004")
    b = _new(client, h, "Owner B", "98111 00005")
    b_kid = _new(client, h, "B Kid", "98111 00005", familyOwnerId=b["id"], relationKey="son")
    r = client.post(f"/api/patients/{b['id']}/family", json={"ownerId": a["id"], "relationKey": "brother"},
                    headers=h)
    assert r.status_code == 200, r.text
    fam = r.json()
    assert fam["ownerId"] == a["id"] and {m["name"] for m in fam["members"]} == {"Owner A", "Owner B", "B Kid"}
    kid = next(m for m in fam["members"] if m["id"] == b_kid["id"])
    assert kid["relationKey"] is None  # was "son" of B, not of A
    assert kid["phone"] == "98111 00004" and "phone changed" in fam["message"]


def test_owner_phone_change_follows_to_members(client, admin_headers):
    h = admin_headers
    owner = _new(client, h, "Phone Owner", "98111 00006")
    kid = _new(client, h, "Phone Kid", "98111 00006", familyOwnerId=owner["id"], relationKey="daughter")
    r = client.patch(f"/api/patients/{owner['id']}", json={"phone": "98111 00007"}, headers=h)
    assert r.status_code == 200 and r.json()["familyPhoneUpdated"] == 1
    assert client.get(f"/api/patients/{kid['id']}", headers=h).json()["phone"] == "98111 00007"
    # A member's own phone edit does not move anyone else.
    r = client.patch(f"/api/patients/{kid['id']}", json={"phone": "98111 00008"}, headers=h)
    assert r.json()["familyPhoneUpdated"] == 0
    assert client.get(f"/api/patients/{owner['id']}", headers=h).json()["phone"] == "98111 00007"


def test_family_endpoints_need_sign_in_and_real_patients(client, admin_headers):
    assert client.get("/api/patients/1/family").status_code == 401
    assert client.get("/api/patients/999999/family", headers=admin_headers).status_code == 404
    p = _new(client, admin_headers, "Lonely", "98111 00009")
    r = client.post(f"/api/patients/{p['id']}/family", json={"ownerId": 999999}, headers=admin_headers)
    assert r.status_code == 404
    r = client.post(f"/api/patients/{p['id']}/family", json={"ownerId": p["id"]}, headers=admin_headers)
    assert r.status_code == 409


# --------------------------------------------------------------------------- relations admin
def test_relations_admin_crud(client, admin_headers, reception_headers):
    h = admin_headers
    listed = client.get("/api/relations", headers=reception_headers).json()
    assert listed[0]["key"] == "spouse" and all(r["active"] for r in listed)

    # Admin only for writes.
    assert client.post("/api/admin/relations", json={"label": "Nephew"}, headers=reception_headers).status_code == 403
    r = client.post("/api/admin/relations", json={"label": "Nephew"}, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["key"] == "nephew" and r.json()["active"] is True
    assert client.post("/api/admin/relations", json={"label": "nephew"}, headers=h).status_code == 409
    r = client.post("/api/admin/relations", json={"label": "Step-son", "key": "step_son"}, headers=h)
    assert r.status_code == 201 and r.json()["key"] == "step_son"

    r = client.patch("/api/admin/relations/nephew", json={"label": "Nephew / Niece"}, headers=h)
    assert r.status_code == 200 and r.json()["label"] == "Nephew / Niece"
    assert client.patch("/api/admin/relations/nobody", json={"label": "X"}, headers=h).status_code == 404

    # Switched off: gone from the picker, still in the admin table, and refused on new links.
    assert client.patch("/api/admin/relations/step_son", json={"active": False}, headers=h).json()["active"] is False
    assert "step_son" not in [x["key"] for x in client.get("/api/relations", headers=h).json()]
    full = client.get("/api/relations", params={"includeInactive": "true"}, headers=h).json()
    assert "step_son" in [x["key"] for x in full]
    owner = _new(client, h, "Rel Owner", "98111 00010")
    r = client.post("/api/patients", json={"name": "Rel Kid", "familyOwnerId": owner["id"], "relationKey": "step_son"},
                    headers=h)
    assert r.status_code == 422

    # Reorder: every key exactly once.
    keys = [x["key"] for x in full]
    r = client.put("/api/admin/relations/order", json={"keys": keys[::-1]}, headers=h)
    assert r.status_code == 200 and [x["key"] for x in r.json()] == keys[::-1]
    assert client.put("/api/admin/relations/order", json={"keys": keys[:2]}, headers=h).status_code == 422
    client.put("/api/admin/relations/order", json={"keys": keys}, headers=h)

    # Delete only while unused; in use -> 409 "switch it off instead".
    _new(client, h, "Rel Nephew", "98111 00010", familyOwnerId=owner["id"], relationKey="nephew")
    r = client.delete("/api/admin/relations/nephew", headers=h)
    assert r.status_code == 409 and "switch it off" in r.json()["detail"]
    counts = {x["key"]: x["patientCount"] for x in client.get("/api/relations?includeInactive=true", headers=h).json()}
    assert counts["nephew"] == 1
    assert client.delete("/api/admin/relations/step_son", headers=reception_headers).status_code == 403
    assert client.delete("/api/admin/relations/step_son", headers=h).status_code == 204


# --------------------------------------------------------------------------- group by shared number
def test_group_patients_who_share_a_number(client, admin_headers, reception_headers, db):
    h = admin_headers
    first = _new(client, h, "Group First", "98111 00011")
    second = _new(client, h, "Group Second", "+91 98111-00011")
    third = _new(client, h, "Group Third", "9811100011")
    fam_owner = _new(client, h, "Group Owner", "98111 00012")
    fam_kid = _new(client, h, "Group Kid", "98111 00012", familyOwnerId=fam_owner["id"], relationKey="son")
    late = _new(client, h, "Group Late", "98111 00012")
    alone = _new(client, h, "Group Alone", "98111 00013")

    assert client.get("/api/admin/family/grouping", headers=reception_headers).status_code == 403
    preview = client.get("/api/admin/family/grouping", headers=h).json()
    assert preview["written"] is False and preview["numbers"] >= 2 and preview["membersLinked"] >= 3
    db.expire_all()
    assert db.get(Patient, second["id"]).family_owner_id is None  # preview writes nothing

    done = client.post("/api/admin/family/grouping", headers=h).json()
    assert done["written"] is True and done["membersLinked"] == preview["membersLinked"]
    db.expire_all()
    # Earliest registered owns the number; relation "not set" for staff to fill in.
    assert db.get(Patient, first["id"]).family_owner_id is None
    for p in (second, third):
        row = db.get(Patient, p["id"])
        assert row.family_owner_id == first["id"] and row.relation_key is None
    # An existing family on the number takes the newcomer; its relations stay.
    assert db.get(Patient, late["id"]).family_owner_id == fam_owner["id"]
    assert db.get(Patient, fam_kid["id"]).relation_key == "son"
    assert db.get(Patient, alone["id"]).family_owner_id is None

    again = client.get("/api/admin/family/grouping", headers=h).json()
    assert again["numbers"] == 0 and again["membersLinked"] == 0
    assert client.post("/api/admin/family/grouping", headers=h).json()["membersLinked"] == 0
