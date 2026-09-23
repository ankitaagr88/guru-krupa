"""Visit kinds & fees (lane E2): the suggestion rules at each boundary, emergency hours, the suggested
bill line following the kind, eye-wise charges, admin lists + roles, the seed and the Today counts."""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.schemas.fees import FeeRules
from app.services import fees
from app.services.fees import History

IST = ZoneInfo("Asia/Kolkata")
DAY = date(2027, 3, 10)  # a Wednesday; nobody else in the suite uses 2027


def _ist(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=IST)


@pytest.fixture(scope="module", autouse=True)
def _seed():
    from app.db import SessionLocal
    from app.seed.reference import seed_reference

    with SessionLocal() as db:
        seed_reference(db)


@pytest.fixture
def reception_headers(client, db):
    from app.auth.service import ensure_user

    ensure_user(db, username="feerecep", password="rec123", name="Fee Reception", role="reception")
    r = client.post("/api/auth/login", json={"username": "feerecep", "password": "rec123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def keep_rules(db):
    """Tests that change the fee rules put them back."""
    from app.models.config import ClinicSetting

    before = dict(db.get(ClinicSetting, "fee_rules").value)
    yield
    db.expire_all()
    db.get(ClinicSetting, "fee_rules").value = before
    db.commit()


def _patient(db, name):
    from app.models.patients import Patient

    p = Patient(name=name)
    db.add(p)
    db.commit()
    return p


def _past_visit(db, patient, on, status="completed", note=""):
    from app.models.patients import Visit

    n = len(list(db.scalars(select(Visit).where(Visit.date == on)))) + 1
    v = Visit(patient_id=patient.id, date=on, token=f"#9{n:02d}", stage_key="done", status=status, note=note)
    db.add(v)
    db.commit()
    return v


def _register(db, patient, on=DAY, at=None):
    from app.services import queue

    return queue.register_visit(db, patient, on=on, at=at or _ist(2027, 3, 10, 11, 0))


# --------------------------------------------------------------------------- the rules, at each boundary
@pytest.mark.parametrize("days_ago,kind", [(0, "free_follow_up"), (6, "free_follow_up"), (7, "follow_up"),
                                           (182, "follow_up"), (183, "new_case"), (900, "new_case")])
def test_suggest_by_days_since_last_visit(days_ago, kind):
    assert fees.suggest_kind(FeeRules(), History(DAY - timedelta(days=days_ago), None), DAY) == kind


def test_suggest_new_patient_and_post_op_window():
    rules = FeeRules()
    assert fees.suggest_kind(rules, History(None, None), DAY) == "new"
    # after surgery: inside the window (0..30 days) -> post_op, whatever the last visit
    for ago in (0, 12, 30):
        h = History(DAY - timedelta(days=100), DAY - timedelta(days=ago))
        assert fees.suggest_kind(rules, h, DAY) == "post_op"
    h = History(DAY - timedelta(days=20), DAY - timedelta(days=31))
    assert fees.suggest_kind(rules, h, DAY) == "follow_up"
    # admin-editable days and kinds
    custom = FeeRules(free_follow_up_days=3, new_case_after_days=90, post_op_days=10, post_op_kind="follow_up")
    assert fees.suggest_kind(custom, History(DAY - timedelta(days=4), None), DAY) == "follow_up"
    assert fees.suggest_kind(custom, History(DAY - timedelta(days=91), None), DAY) == "new_case"
    assert fees.suggest_kind(custom, History(DAY - timedelta(days=50), DAY - timedelta(days=10)), DAY) == "follow_up"
    assert fees.reason(rules, History(DAY - timedelta(days=12), None), DAY) == "Last visit 12 days ago"
    assert fees.reason(rules, History(None, None), DAY) == "No earlier visit on record"


@pytest.mark.parametrize("at,expected", [
    (_ist(2027, 3, 10, 19, 59), False), (_ist(2027, 3, 10, 20, 0), True), (_ist(2027, 3, 10, 23, 59), True),
    (_ist(2027, 3, 11, 0, 30), True), (_ist(2027, 3, 11, 7, 59), True), (_ist(2027, 3, 11, 8, 0), False),
    (_ist(2027, 3, 10, 12, 0), False),
    (_ist(2027, 3, 14, 12, 0), True),  # Sunday
    # UTC in, clinic time decides: 15:00 UTC = 20:30 IST
    (datetime(2027, 3, 10, 15, 0, tzinfo=timezone.utc), True),
])
def test_emergency_hours_cross_midnight_and_sunday(at, expected):
    assert fees.is_emergency(FeeRules(), at) is expected


def test_emergency_rule_variants():
    no_sunday = FeeRules(emergency_on_sunday=False)
    assert fees.is_emergency(no_sunday, _ist(2027, 3, 14, 12, 0)) is False
    assert fees.is_emergency(no_sunday, _ist(2027, 3, 14, 21, 0)) is True
    lunch = FeeRules(emergency_from="13:00", emergency_to="14:00", emergency_on_sunday=False)
    assert fees.is_emergency(lunch, _ist(2027, 3, 10, 13, 30)) is True
    assert fees.is_emergency(lunch, _ist(2027, 3, 10, 21, 0)) is False
    off = FeeRules(emergency_from="00:00", emergency_to="00:00", emergency_on_sunday=False)
    assert fees.is_emergency(off, _ist(2027, 3, 10, 3, 0)) is False


# --------------------------------------------------------------------------- registration stores the suggestion
def test_registration_suggests_kind_from_history(db, client, admin_headers):
    new = _patient(db, "Fee New")
    v = _register(db, new)
    assert (v.visit_kind_key, v.emergency) == ("new", False)

    back6 = _patient(db, "Fee Back Six")
    _past_visit(db, back6, DAY - timedelta(days=6))
    assert _register(db, back6).visit_kind_key == "free_follow_up"

    back7 = _patient(db, "Fee Back Seven")
    _past_visit(db, back7, DAY - timedelta(days=7))
    v7 = _register(db, back7)
    assert v7.visit_kind_key == "follow_up"

    # a KiviHealth-imported visit counts as an earlier visit; a cancelled one does not
    old = _patient(db, "Fee Imported")
    _past_visit(db, old, DAY - timedelta(days=400), note="Imported from the previous system")
    _past_visit(db, old, DAY - timedelta(days=3), status="cancelled")
    assert _register(db, old).visit_kind_key == "new_case"

    # after surgery (completed OT case within 30 days)
    from app.models.ot import OtCase

    op = _patient(db, "Fee After Surgery")
    _past_visit(db, op, DAY - timedelta(days=40))
    db.add(OtCase(patient_id=op.id, patient_name=op.name, date=DAY - timedelta(days=12), procedure="Cataract",
                  status="completed"))
    db.commit()
    assert _register(db, op).visit_kind_key == "post_op"

    # night registration -> emergency suggested
    night = _patient(db, "Fee Night")
    assert _register(db, night, at=_ist(2027, 3, 10, 22, 15)).emergency is True

    # the board shows the kind, whether it is free, and why
    out = client.get(f"/api/visits/{v7.id}", headers=admin_headers).json()
    assert out["visitKindKey"] == "follow_up" and out["visitKindLabel"] == "Follow-up"
    assert out["visitKindCharge"] == 350 and out["daysSinceLastVisit"] == 7
    assert out["feeReason"] == "Last visit 7 days ago" and out["emergency"] is False
    out = client.get(f"/api/visits/{v.id}", headers=admin_headers).json()
    assert out["daysSinceLastVisit"] is None and out["visitKindCharge"] == 700


# --------------------------------------------------------------------------- the bill follows the kind
def test_bill_starts_with_suggested_fee_and_follows_kind_change(db, client, reception_headers, admin_headers):
    p = _patient(db, "Fee Bill Patient")
    _past_visit(db, p, DAY - timedelta(days=20))
    vid = _register(db, p).id  # follow-up, ₹350
    base = f"/api/visits/{vid}"

    fee = client.get(f"{base}/fee", headers=reception_headers).json()
    assert fee["visitKindKey"] == "follow_up" and fee["suggestedKindKey"] == "follow_up"
    assert [(ln["label"], ln["amount"]) for ln in fee["lines"]] == [("Follow-up", 350)]

    r = client.post(f"{base}/bill/start", headers=reception_headers)
    assert r.status_code == 200, r.text
    bill = r.json()
    assert [(i["label"], i["amount"], i["suggested"]) for i in bill["items"]] == [("Follow-up", 350, True)]
    assert bill["visitKindLabel"] == "Follow-up" and bill["feeNote"] == ""
    # starting again never duplicates
    assert len(client.post(f"{base}/bill/start", headers=reception_headers).json()["items"]) == 1

    # reception adds a typed line and a test
    items = bill["items"] + [{"label": "Eye patch", "amount": 50},
                             {"label": "Perimetry — both eyes", "amount": 4000, "kind": "charge", "eyes": "both",
                              "standardChargeId": _charge(client, admin_headers, "Perimetry")["id"]}]
    client.put(f"{base}/bill", json={"items": items}, headers=reception_headers)

    # "Different problem -> New case": the suggested line changes in place, nothing else moves
    r = client.put(f"{base}/kind", json={"visitKindKey": "new_case"}, headers=reception_headers)
    assert r.status_code == 200, r.text
    assert r.json()["visitKindKey"] == "new_case" and r.json()["visitKindLabel"] == "New case"
    bill = client.get(f"{base}/bill", headers=reception_headers).json()
    assert [(i["label"], i["amount"], i["eyes"]) for i in bill["items"]] == [
        ("New case", 500, None), ("Eye patch", 50, None), ("Perimetry — both eyes", 4000, "both")]
    assert [i["suggested"] for i in bill["items"]] == [True, False, False]

    # free follow-up: the fee line goes and the bill says why
    client.put(f"{base}/kind", json={"visitKindKey": "free_follow_up"}, headers=reception_headers)
    bill = client.get(f"{base}/bill", headers=reception_headers).json()
    assert [i["label"] for i in bill["items"]] == ["Eye patch", "Perimetry — both eyes"]
    assert bill["feeNote"] == "Follow-up within 6 days — no charge"
    # back to a charged kind: one line again, never two
    client.put(f"{base}/kind", json={"visitKindKey": "follow_up"}, headers=reception_headers)
    client.put(f"{base}/kind", json={"visitKindKey": "follow_up"}, headers=reception_headers)
    labels = [i["label"] for i in client.get(f"{base}/bill", headers=reception_headers).json()["items"]]
    assert labels.count("Follow-up") == 1

    # emergency on / off adds / removes the Emergency line only
    client.put(f"{base}/kind", json={"emergency": True}, headers=reception_headers)
    client.put(f"{base}/kind", json={"emergency": True}, headers=reception_headers)
    bill = client.get(f"{base}/bill", headers=reception_headers).json()
    assert [(i["label"], i["amount"]) for i in bill["items"] if i["label"] == "Emergency"] == [("Emergency", 1000)]
    assert client.get(base, headers=reception_headers).json()["emergency"] is True
    client.put(f"{base}/kind", json={"emergency": False}, headers=reception_headers)
    assert "Emergency" not in [i["label"] for i in client.get(f"{base}/bill", headers=reception_headers).json()["items"]]

    # unknown kind -> 422; a paid bill is never rewritten
    assert client.put(f"{base}/kind", json={"visitKindKey": "nope"}, headers=reception_headers).status_code == 422
    client.post(f"{base}/bill/pay", json={"paymentMode": "cash"}, headers=reception_headers)
    before = client.get(f"{base}/bill", headers=reception_headers).json()["items"]
    client.put(f"{base}/kind", json={"visitKindKey": "new_case"}, headers=reception_headers)
    assert client.get(f"{base}/bill", headers=reception_headers).json()["items"] == before


def test_new_bill_with_emergency_starts_with_both_lines(db, client, reception_headers):
    p = _patient(db, "Fee Night Bill")
    vid = _register(db, p, at=_ist(2027, 3, 10, 21, 0)).id
    bill = client.post(f"/api/visits/{vid}/bill/start", headers=reception_headers).json()
    assert [(i["label"], i["amount"], i["suggested"]) for i in bill["items"]] == [
        ("Consultation / new file", 700, True), ("Emergency", 1000, True)]


# --------------------------------------------------------------------------- eye-wise charges
def _charge(client, headers, label):
    return next(c for c in client.get("/api/admin/standard-charges", headers=headers).json() if c["label"] == label)


def test_eye_wise_charges_and_groups(client, admin_headers, reception_headers):
    per = _charge(client, admin_headers, "Perimetry")
    assert (per["amount"], per["amountBothEyes"], per["groupLabel"]) == (2500, 4000, "Tests")
    assert _charge(client, admin_headers, "Package 2 — Fundus + OCT + RNFL + Perimetry")["amountBothEyes"] == 7000
    assert _charge(client, admin_headers, "Consultation / new file")["groupLabel"] == "Visit fees"
    # the one-tap list carries both prices and the heading too
    chips = client.get("/api/standard-charges", headers=reception_headers).json()
    assert any(c["label"] == "Perimetry" and c["amountBothEyes"] == 4000 for c in chips)

    base = "/api/admin/standard-charges"
    r = client.post(base, json={"label": "Fee Test Scan", "amount": 800, "amountBothEyes": 1200,
                                "groupLabel": " Tests "}, headers=admin_headers)
    assert r.status_code == 201 and (r.json()["amountBothEyes"], r.json()["groupLabel"]) == (1200, "Tests")
    cid = r.json()["id"]
    r = client.patch(f"{base}/{cid}", json={"amountBothEyes": None, "groupLabel": "Other"}, headers=admin_headers)
    assert (r.json()["amountBothEyes"], r.json()["groupLabel"]) == (None, "Other")
    client.delete(f"{base}/{cid}", headers=admin_headers)

    # a bill line remembers the eyes; anything else is refused
    p_vid = client.post("/api/patients", json={"name": "Fee Eyes"}, headers=admin_headers).json()["id"]
    vid = client.post("/api/visits", json={"patientId": p_vid}, headers=admin_headers).json()["id"]
    line = {"label": "Perimetry — one eye", "amount": 2500, "kind": "charge", "standardChargeId": per["id"],
            "eyes": "one"}
    r = client.put(f"/api/visits/{vid}/bill", json={"items": [line]}, headers=reception_headers)
    assert r.json()["items"][0]["eyes"] == "one"
    bad = {**line, "eyes": "left"}
    assert client.put(f"/api/visits/{vid}/bill", json={"items": [bad]}, headers=reception_headers).status_code == 422


# --------------------------------------------------------------------------- admin: kinds + rules
def test_visit_kinds_admin_crud_and_roles(client, admin_headers, reception_headers):
    base = "/api/admin/visit-kinds"
    assert client.get(base, headers=reception_headers).status_code == 403
    assert client.post(base, json={"label": "X"}, headers=reception_headers).status_code == 403
    rows = client.get(base, headers=admin_headers).json()
    assert [r["key"] for r in rows][:5] == ["new", "free_follow_up", "follow_up", "new_case", "post_op"]
    assert rows[0]["chargeLabel"] == "Consultation / new file" and rows[0]["chargeAmount"] == 700
    assert rows[1]["standardChargeId"] is None  # free
    # any staff reads the active list (the drawer's choices)
    assert "follow_up" in [k["key"] for k in client.get("/api/visit-kinds", headers=reception_headers).json()]

    ot_fu = _charge(client, admin_headers, "OT follow-up")
    r = client.post(base, json={"label": "OT follow-up visit", "standardChargeId": ot_fu["id"]}, headers=admin_headers)
    assert r.status_code == 201, r.text
    kid, key = r.json()["id"], r.json()["key"]
    assert key == "ot_follow_up_visit" and r.json()["chargeAmount"] == 350
    assert client.post(base, json={"label": "ot follow-up visit"}, headers=admin_headers).status_code == 409
    assert client.post(base, json={"label": "Bad", "standardChargeId": 999999}, headers=admin_headers).status_code == 422

    r = client.patch(f"{base}/{kid}", json={"label": "OT review", "standardChargeId": None}, headers=admin_headers)
    assert (r.json()["label"], r.json()["standardChargeId"]) == ("OT review", None)
    client.patch(f"{base}/{kid}", json={"active": False}, headers=admin_headers)
    assert key not in [k["key"] for k in client.get("/api/visit-kinds", headers=reception_headers).json()]
    # a switched-off kind can't be picked for a visit
    p_vid = client.post("/api/patients", json={"name": "Fee Kind Pick"}, headers=admin_headers).json()["id"]
    vid = client.post("/api/visits", json={"patientId": p_vid}, headers=admin_headers).json()["id"]
    assert client.put(f"/api/visits/{vid}/kind", json={"visitKindKey": key}, headers=reception_headers).status_code == 422

    # reorder: every id once
    ids = [r["id"] for r in client.get(base, headers=admin_headers).json()]
    assert client.put(f"{base}/order", json={"ids": ids[1:]}, headers=admin_headers).status_code == 422
    r = client.put(f"{base}/order", json={"ids": [kid] + [i for i in ids if i != kid]}, headers=admin_headers)
    assert r.status_code == 200 and r.json()[0]["id"] == kid
    client.put(f"{base}/order", json={"ids": ids}, headers=admin_headers)

    # delete: refused while a rule uses it or visits carry it
    new_id = next(r["id"] for r in client.get(base, headers=admin_headers).json() if r["key"] == "new")
    assert client.delete(f"{base}/{new_id}", headers=admin_headers).status_code == 409
    assert client.patch(f"{base}/{new_id}", json={"active": False}, headers=admin_headers).status_code == 409
    client.patch(f"{base}/{kid}", json={"active": True}, headers=admin_headers)
    client.put(f"/api/visits/{vid}/kind", json={"visitKindKey": key}, headers=reception_headers)
    assert client.delete(f"{base}/{kid}", headers=admin_headers).status_code == 409
    client.put(f"/api/visits/{vid}/kind", json={"visitKindKey": "new"}, headers=reception_headers)
    assert client.delete(f"{base}/{kid}", headers=admin_headers).status_code == 204


def test_fee_rules_admin(client, admin_headers, reception_headers, keep_rules):
    assert client.get("/api/admin/fee-rules", headers=reception_headers).status_code == 403
    assert client.put("/api/admin/fee-rules", json={"postOpDays": 10}, headers=reception_headers).status_code == 403
    rules = client.get("/api/fee-rules", headers=reception_headers).json()
    emergency = _charge(client, admin_headers, "Emergency")
    assert rules["freeFollowUpDays"] == 6 and rules["newCaseAfterDays"] == 182 and rules["postOpDays"] == 30
    assert (rules["emergencyFrom"], rules["emergencyTo"], rules["emergencyOnSunday"]) == ("20:00", "08:00", True)
    assert rules["emergencyChargeId"] == emergency["id"] and rules["postOpKind"] == "post_op"

    r = client.put("/api/admin/fee-rules", json={"postOpDays": 45, "postOpKind": "follow_up",
                                                 "emergencyFrom": "9:00", "emergencyTo": "21:00"},
                   headers=admin_headers)
    assert r.status_code == 200, r.text
    assert (r.json()["postOpDays"], r.json()["postOpKind"], r.json()["emergencyFrom"]) == (45, "follow_up", "09:00")
    assert r.json()["freeFollowUpDays"] == 6  # untouched
    assert client.get("/api/admin/fee-rules", headers=admin_headers).json()["postOpDays"] == 45
    for bad in ({"newCaseAfterDays": 5}, {"emergencyTo": "25:00"}, {"followUpKind": "nope"},
                {"emergencyChargeId": 999999}, {"freeFollowUpDays": -1}):
        assert client.put("/api/admin/fee-rules", json=bad, headers=admin_headers).status_code == 422, bad
    r = client.put("/api/admin/fee-rules", json={"emergencyChargeId": None}, headers=admin_headers)
    assert r.json()["emergencyChargeId"] is None


# --------------------------------------------------------------------------- seed
def test_seed_converts_unpriced_starters_and_never_overwrites_prices():
    from app.db import Base
    from app.models.billing import StandardCharge
    from app.models.config import ClinicSetting, VisitKind
    from app.seed.fees import seed_fees

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as db:
        db.add_all([StandardCharge(label="Consultation", amount=0, sort_order=0),
                    StandardCharge(label="Follow-up consultation", amount=250, sort_order=1),  # priced by admin
                    StandardCharge(label="Pre-test", amount=0, sort_order=2),
                    StandardCharge(label="Dilation", amount=100, sort_order=3),
                    StandardCharge(label="Perimetry", amount=2200, sort_order=4)])  # priced by admin
        db.commit()
        seed_fees(db)
        db.commit()
        by = {c.label: c for c in db.scalars(select(StandardCharge))}
        assert "Consultation" not in by and by["Consultation / new file"].amount == 700
        assert by["Follow-up consultation"].amount == 250 and by["Follow-up"].amount == 350
        assert by["Pre-test"].active is False and by["Dilation"].active is True and by["Dilation"].amount == 100
        assert (by["Perimetry"].amount, by["Perimetry"].amount_both_eyes, by["Perimetry"].group_label) == (
            2200, None, "Tests")
        assert by["Macular OCT"].amount_both_eyes == 2000 and by["Emergency"].group_label == "Visit fees"
        kinds = {k.key: k for k in db.scalars(select(VisitKind))}
        assert kinds["new"].standard_charge_id == by["Consultation / new file"].id
        assert kinds["free_follow_up"].standard_charge_id is None
        assert db.get(ClinicSetting, "fee_rules").value["emergencyChargeId"] == by["Emergency"].id

        # admin edits, then the seed runs again (every start-up): nothing comes back or changes
        by["Consultation / new file"].amount = 800
        db.delete(by["CCT (central corneal thickness)"])
        rules = db.get(ClinicSetting, "fee_rules")
        rules.value = {**rules.value, "freeFollowUpDays": 5}
        rules.value.pop("postOpKind")  # a rule added in a later version gets its default
        db.commit()
        n = len(list(db.scalars(select(StandardCharge))))
        seed_fees(db)
        seed_fees(db)
        db.commit()
        assert len(list(db.scalars(select(StandardCharge)))) == n
        assert db.scalar(select(StandardCharge).filter_by(label="Consultation / new file")).amount == 800
        value = db.get(ClinicSetting, "fee_rules").value
        assert value["freeFollowUpDays"] == 5 and value["postOpKind"] == "post_op"
        assert len(list(db.scalars(select(VisitKind)))) == 5
    engine.dispose()


# --------------------------------------------------------------------------- Today counts
def test_today_counts_by_visit_kind(db, client, admin_headers):
    day = date(2027, 5, 5)
    kinds = ["new", "new", "follow_up", "free_follow_up", "new_case"]
    for i, k in enumerate(kinds):
        v = _past_visit(db, _patient(db, f"Fee Today {i}"), day, status="active")
        v.visit_kind_key, v.emergency = k, i == 0
    db.commit()
    rep = client.get("/api/reports/today", params={"date": day.isoformat()}, headers=admin_headers).json()
    counts = {k["key"]: k["count"] for k in rep["visitKinds"]["kinds"]}
    assert counts["new"] == 2 and counts["follow_up"] == 1 and counts["free_follow_up"] == 1
    assert counts["new_case"] == 1 and counts["post_op"] == 0
    assert rep["visitKinds"]["emergencies"] == 1 and rep["visitKinds"]["notSet"] == 0
    assert rep["visitKinds"]["kinds"][0]["label"] == "New patient"
