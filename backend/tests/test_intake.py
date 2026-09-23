"""New-patient form (`/api/intake`): public self-fill + the same form used by signed-in staff."""
import pytest

from app.config import settings
from app.models.patients import Patient, Visit
from app.seed.reference import seed_reference
from app.services import intake as intake_svc
from app.services.queue import today

FORM = {"name": "Kokilaben Desai", "phone": "70000 11111", "dob": "1960-04-02", "age": None, "sex": "F",
        "address": "Vesu, Surat", "occupation": "Teacher", "screenHours": 2, "language": "gujarati",
        "elsewhere": True, "elsewhereNote": "Cataract op, Rajkot", "referralSource": "doctor",
        "referralDetail": "Dr. Shah", "existingConditions": ["Diabetes"], "conditionOther": "Migraine",
        "website": ""}


@pytest.fixture(scope="module", autouse=True)
def _seed():
    from app.db import SessionLocal

    with SessionLocal() as db:
        seed_reference(db)


@pytest.fixture(autouse=True)
def _fresh_limiter():
    intake_svc.limiter.reset()
    yield
    intake_svc.limiter.reset()


def _visit(db, token):
    return db.query(Visit).filter_by(date=today(), token=token).one()


def test_lists_are_public_and_hold_only_the_lists(client):
    r = client.get("/api/intake/lists")
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"referralSources", "conditions"}
    assert "Diabetes" in body["conditions"]
    doctor = next(s for s in body["referralSources"] if s["key"] == "doctor")
    assert set(doctor) == {"key", "label", "needsDetail"} and doctor["needsDetail"] is True


def test_public_submit_creates_patient_and_todays_visit(client, db):
    r = client.post("/api/intake", json=FORM)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["token"].startswith("#")
    assert body["patientId"] is None and body["visitId"] is None  # the public page gets the token only

    visit = _visit(db, body["token"])
    assert visit.stage_key == "reg" and visit.status == "active"
    assert visit.note == intake_svc.SELF_FILLED_NOTE
    assert visit.elsewhere is True and visit.elsewhere_note == "Cataract op, Rajkot"
    p = db.get(Patient, visit.patient_id)
    assert p.name == "Kokilaben Desai" and p.phone == "70000 11111" and str(p.dob) == "1960-04-02"
    assert p.sex == "F" and p.language == "gujarati" and p.screen_hours == 2
    assert p.referral_source.key == "doctor" and p.referral_detail == "Dr. Shah"
    assert p.existing_conditions == ["Diabetes"] and p.condition_other == "Migraine"


def test_same_phone_is_flagged_but_not_revealed(client, db):
    first = client.post("/api/intake", json={**FORM, "name": "Ramesh Patel", "phone": "7000022222"})
    second = client.post("/api/intake", json={**FORM, "name": "Rekha Patel", "phone": "+91 70000-22222"})
    assert first.status_code == second.status_code == 201
    # Same shape either way: nothing tells the public page the number was already known.
    assert set(first.json()) == set(second.json())
    assert "Ramesh" not in second.text
    assert intake_svc.SAME_PHONE_NOTE not in _visit(db, first.json()["token"]).note
    note = _visit(db, second.json()["token"]).note
    assert intake_svc.SELF_FILLED_NOTE in note and intake_svc.SAME_PHONE_NOTE in note


def test_honeypot_rejects(client, db):
    before = db.query(Patient).count()
    r = client.post("/api/intake", json={**FORM, "phone": "7000033333", "website": "http://spam.example"})
    assert r.status_code == 400
    assert db.query(Patient).count() == before


def test_rate_limit(client, monkeypatch):
    monkeypatch.setattr(settings, "INTAKE_RATE_LIMIT", 2)
    for i in range(2):
        assert client.post("/api/intake", json={**FORM, "phone": f"700004444{i}"}).status_code == 201
    r = client.post("/api/intake", json={**FORM, "phone": "7000044449"})
    assert r.status_code == 429
    assert "reception" in r.json()["detail"]


def test_rate_limiter_window():
    lim = intake_svc.RateLimiter()
    assert lim.allow("a", 2, 600, now=0) and lim.allow("a", 2, 600, now=1)
    assert not lim.allow("a", 2, 600, now=2)
    assert lim.allow("b", 2, 600, now=2)  # per address
    assert lim.allow("a", 2, 600, now=601)  # the window moves on


@pytest.mark.parametrize("patch", [
    {"name": ""},
    {"name": "   "},
    {"name": "x" * 121},
    {"phone": ""},  # the public page needs a mobile number
    {"phone": "12345"},
    {"phone": "98250<script>"},
    {"age": 300},
    {"dob": "2999-01-01"},
    {"sex": "X"},
    {"language": "french"},
    {"screenHours": 99},
    {"address": "a" * 256},
    {"elsewhereNote": "a" * 501},
    {"referralSource": "nope"},
    {"existingConditions": ["Not a listed condition"]},
    {"existingConditions": ["Diabetes"] * 21},
    {"website": "x" * 201},
])
def test_invalid_input_is_422(client, patch):
    r = client.post("/api/intake", json={**FORM, "phone": "7000055555", **patch})
    assert r.status_code == 422, (patch, r.text)


def test_staff_submit_skips_limit_and_note(client, db, admin_headers, monkeypatch):
    monkeypatch.setattr(settings, "INTAKE_RATE_LIMIT", 1)
    for i in range(3):
        r = client.post("/api/intake", json={**FORM, "name": f"Staff Entry {i}", "phone": "",
                                             "sex": "Other"}, headers=admin_headers)
        assert r.status_code == 201, r.text
    body = r.json()
    assert body["patientId"] and body["visitId"]
    visit = db.get(Visit, body["visitId"])
    assert visit.note == "" and db.get(Patient, body["patientId"]).sex == "O"


def test_stale_token_is_treated_as_public(client):
    r = client.post("/api/intake", json={**FORM, "phone": "7000066666"},
                    headers={"Authorization": "Bearer not-a-real-token"})
    assert r.status_code == 201 and r.json()["patientId"] is None


def test_staff_can_add_as_family_member(client, db, admin_headers):
    owner = client.post("/api/intake", json={**FORM, "name": "Hasmukh Joshi", "phone": "7000077777"},
                        headers=admin_headers).json()
    r = client.post("/api/intake", json={**FORM, "name": "Mira Joshi", "phone": "70000 77777",
                                         "familyOwnerId": owner["patientId"], "relationKey": "daughter"},
                    headers=admin_headers)
    assert r.status_code == 201, r.text
    kid = db.get(Patient, r.json()["patientId"])
    assert kid.family_owner_id == owner["patientId"] and kid.relation_key == "daughter"
    r = client.post("/api/intake", json={**FORM, "name": "Bad Relation", "phone": "7000077777",
                                         "familyOwnerId": owner["patientId"], "relationKey": "cousin"},
                    headers=admin_headers)
    assert r.status_code == 422


def test_public_page_never_links_a_family(client, db, admin_headers):
    owner = client.post("/api/intake", json={**FORM, "name": "Public Owner", "phone": "7000088888"},
                        headers=admin_headers).json()
    r = client.post("/api/intake", json={**FORM, "name": "Public Kid", "phone": "7000088888",
                                         "familyOwnerId": owner["patientId"], "relationKey": "son"})
    assert r.status_code == 201, r.text
    assert set(r.json()) == {"token", "patientId", "visitId"} and r.json()["patientId"] is None
    assert "Public Owner" not in r.text
    visit = _visit(db, r.json()["token"])
    kid = db.get(Patient, visit.patient_id)
    assert kid.family_owner_id is None and kid.relation_key is None
    assert intake_svc.SAME_PHONE_NOTE in visit.note  # still flagged for reception, as before
