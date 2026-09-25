"""Printed-prescription extras (lane R): exam findings + glasses on a visit, the lists behind them,
the print settings, and the extra blocks on the print payload."""
import pytest
from sqlalchemy import select

from app.models import AuditLog
from app.models.config import ClinicSetting, ExamFinding, LensType
from app.models.patients import Visit
from app.seed.reference import seed_reference
from app.seed.rx import DEFAULT_SETTINGS, SETTINGS_KEY
from app.services.admin import BadValue
from app.services.rx_print import REFRACTION_MACHINES, fmt_axis, fmt_ipd, fmt_power


@pytest.fixture(scope="module", autouse=True)
def _seed():
    from app.db import SessionLocal

    with SessionLocal() as db:
        seed_reference(db)
        db.commit()
    yield
    with SessionLocal() as db:  # leave the lists and settings as seeded for other modules
        for model in (ExamFinding, LensType):
            for row in db.scalars(select(model).where(model.key.like("t_%"))):
                db.delete(row)
        row = db.get(ClinicSetting, SETTINGS_KEY)
        if row is not None:
            row.value = dict(DEFAULT_SETTINGS)
        db.commit()


def _login(client, db, username, role):
    from app.auth.service import ensure_user

    ensure_user(db, username=username, password="pw12345", name=username.title(), role=role)
    r = client.post("/api/auth/login", json={"username": username, "password": "pw12345"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def doctor_headers(client, db):
    return _login(client, db, "rpdoctor", "doctor")


@pytest.fixture
def reception_headers(client, db):
    return _login(client, db, "rprecep", "reception")


def _visit(client, headers, name="Glasses Patient", **patient):
    pid = client.post("/api/patients", json={"name": name, "age": 34, "sex": "M", **patient},
                      headers=headers).json()["id"]
    r = client.post("/api/visits", json={"patientId": pid}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _eye(dist=None, near=None):
    return {"dist": dist or {}, "near": near or {}}


GLASSES = {
    "r": _eye({"sph": "-2.75", "va": "6/6"}, {"va": "N6"}),
    "l": _eye({"sph": "-4", "cyl": "-0.5", "axis": "90°", "va": "6/6"}, {"va": "N6"}),
    "lensTypes": ["arc", "arc", "blue_cut"],
    "ipd": "66 mm",
}


# --------------------------------------------------------------------------- tidy values
@pytest.mark.parametrize("raw,out", [("-2.5", "-2.50"), ("1", "+1.00"), ("+.75", "+0.75"), ("−3.25", "-3.25"),
                                     ("0", "Plano"), ("plano", "Plano"), (" -0.25 D", "-0.25"), ("", ""),
                                     (None, "")])
def test_fmt_power(raw, out):
    assert fmt_power(raw, "Sph") == out


@pytest.mark.parametrize("raw", ["-2.3", "abc", "45", "nan", "1.125"])
def test_fmt_power_refuses(raw):
    with pytest.raises(BadValue):
        fmt_power(raw, "Sph")


def test_fmt_axis_and_ipd():
    assert fmt_axis("090", "Axis") == "90" and fmt_axis("180°", "Axis") == "180" and fmt_axis("", "Axis") == ""
    for bad in ("181", "-5", "9.5", "x"):
        with pytest.raises(BadValue):
            fmt_axis(bad, "Axis")
    assert fmt_ipd("66mm") == "66" and fmt_ipd("63.50") == "63.5" and fmt_ipd("60") == "60"
    for bad in ("12", "abc"):
        with pytest.raises(BadValue):
            fmt_ipd(bad)


# --------------------------------------------------------------------------- lists
def test_lists_any_staff(client, reception_headers):
    assert client.get("/api/rx-print/lists").status_code == 401
    body = client.get("/api/rx-print/lists", headers=reception_headers).json()
    keys = [f["key"] for f in body["examFindings"]]
    assert keys[:2] == ["lids", "anterior"] and "fundus" in keys
    fundus = next(f for f in body["examFindings"] if f["key"] == "fundus")
    assert fundus["label"] == "Fundus" and fundus["defaultValue"] == "Normal"
    assert [t["key"] for t in body["lensTypes"]][:2] == ["arc", "blue_cut"]
    s = client.get("/api/rx-print/settings", headers=reception_headers).json()
    assert s["footerNote"]["gujarati"].startswith("ફરી") and "regNo" in s and s["doctorName"]


# --------------------------------------------------------------------------- exam + glasses on a visit
def test_exam_glasses_roundtrip_and_tidy(client, admin_headers, doctor_headers, reception_headers, db):
    vid = _visit(client, admin_headers)
    empty = client.get(f"/api/visits/{vid}/exam-glasses", headers=reception_headers).json()
    assert empty == {"visitId": vid, "exam": [], "glasses": None, "fromReading": None, "va": {"r": "", "l": ""}}

    body = {"exam": [{"key": "fundus", "r": "Normal", "l": " Normal "}, {"key": "lids", "r": "", "l": ""},
                     {"key": "iop", "r": 18, "l": "20"}],
            "glasses": GLASSES}
    r = client.put(f"/api/visits/{vid}/exam-glasses", json=body, headers=doctor_headers)
    assert r.status_code == 200, r.text
    out = r.json()
    # admin order (IOP before Fundus), empty rows dropped, labels added
    assert out["exam"] == [{"key": "iop", "label": "IOP (mmHg)", "r": "18", "l": "20"},
                           {"key": "fundus", "label": "Fundus", "r": "Normal", "l": "Normal"}]
    g = out["glasses"]
    assert g["r"]["dist"] == {"sph": "-2.75", "cyl": "", "axis": "", "va": "6/6"}
    assert g["l"]["dist"] == {"sph": "-4.00", "cyl": "-0.50", "axis": "90", "va": "6/6"}
    assert g["r"]["near"]["va"] == "N6" and g["lensTypes"] == ["arc", "blue_cut"] and g["ipd"] == "66"

    db.expire_all()
    visit = db.get(Visit, vid)
    assert visit.glasses["l"]["dist"]["sph"] == "-4.00" and len(visit.exam) == 2
    assert db.scalar(select(AuditLog).where(AuditLog.action == "visit.exam_glasses", AuditLog.entity_id == vid))

    # clearing everything stores "no glasses" (None), not an empty shell
    r = client.put(f"/api/visits/{vid}/exam-glasses", json={"exam": [], "glasses": {"r": _eye(), "l": _eye()}},
                   headers=admin_headers)
    assert r.status_code == 200 and r.json()["glasses"] is None and r.json()["exam"] == []
    db.expire_all()
    assert db.get(Visit, vid).glasses is None


@pytest.mark.parametrize("glasses,exam,msg", [
    ({"r": _eye({"sph": "-2.30"})}, [], "quarter"),
    ({"r": _eye({"axis": "200"})}, [], "0 to 180"),
    ({"l": _eye({"cyl": "-1.00"})}, [], "needs an axis"),
    ({"lensTypes": ["zzz"]}, [], "Unknown lens type"),
    ({"ipd": "5"}, [], "IPD"),
    (None, [{"key": "nope", "r": "x"}], "Unknown exam finding"),
    (None, [{"key": "fundus", "r": "x" * 81}], "80 characters"),
])
def test_exam_glasses_validation(client, doctor_headers, admin_headers, glasses, exam, msg):
    vid = _visit(client, admin_headers)
    r = client.put(f"/api/visits/{vid}/exam-glasses", json={"exam": exam, "glasses": glasses}, headers=doctor_headers)
    assert r.status_code == 422 and msg in r.json()["detail"], r.text


def test_exam_glasses_roles(client, reception_headers, admin_headers):
    vid = _visit(client, admin_headers)
    assert client.put(f"/api/visits/{vid}/exam-glasses", json={"exam": []}, headers=reception_headers).status_code == 403
    assert client.get("/api/visits/999999/exam-glasses", headers=admin_headers).status_code == 404
    assert client.put("/api/visits/999999/exam-glasses", json={}, headers=admin_headers).status_code == 404


def test_fill_from_approved_refraction_reading(client, admin_headers, reception_headers):
    assert set(REFRACTION_MACHINES) == {"hrk8000a_ref", "ypc100k_ref"}  # not the lensmeter (current glasses)
    vid = _visit(client, admin_headers)
    client.patch(f"/api/visits/{vid}/va", json={"R": "6/9", "L": "6/6"}, headers=admin_headers)
    values = [{"l": "SPH (R)", "v": "-1.00"}, {"l": "CYL (R)", "v": "-0.50"}, {"l": "AX (R)", "v": "90"},
              {"l": "SPH (L)", "v": "-0.75"}, {"l": "CYL (L)", "v": "+0.00"}, {"l": "AX (L)", "v": "85"},
              {"l": "PD", "v": "64mm"}]
    rid = client.post("/api/readings/manual", json={"visitId": vid, "machineKey": "hrk8000a_ref", "values": values},
                      headers=admin_headers).json()["id"]
    # not approved yet: nothing to fill from
    assert client.get(f"/api/visits/{vid}/exam-glasses", headers=reception_headers).json()["fromReading"] is None
    assert client.post(f"/api/readings/{rid}/approve", headers=admin_headers).status_code == 200
    out = client.get(f"/api/visits/{vid}/exam-glasses", headers=reception_headers).json()
    fill = out["fromReading"]
    assert fill["readingId"] == rid and fill["machine"].startswith("HRK-8000A")
    assert fill["r"] == {"sph": "-1.00", "cyl": "-0.50", "axis": "90", "va": ""}
    assert fill["l"]["cyl"] == "" and fill["l"]["sph"] == "-0.75" and fill["ipd"] == "64"
    assert out["va"] == {"r": "6/9", "l": "6/6"}


# --------------------------------------------------------------------------- print payload
def _rx(client, headers, vid, lang="english"):
    r = client.post(f"/api/visits/{vid}/prescription", json={"lines": [], "printLanguage": lang}, headers=headers)
    assert r.status_code == 201, r.text


def test_print_payload_blocks_absent_when_empty(client, admin_headers, db):
    vid = _visit(client, admin_headers, name="Plain Print", address="Vesu, Surat")
    _rx(client, admin_headers, vid)
    p = client.get(f"/api/visits/{vid}/prescription/print", headers=admin_headers).json()
    assert p["exam"] == [] and p["glasses"] is None
    pid = db.get(Visit, vid).patient_id
    assert p["patient"]["patientId"] == str(pid) and p["patient"]["area"] == "Vesu, Surat"
    assert p["doctor"]["name"] == DEFAULT_SETTINGS["doctorName"] == p["hospital"]["doctor"]
    assert p["doctor"]["degrees"] == DEFAULT_SETTINGS["degrees"] and p["doctor"]["regNo"] == ""
    assert p["footerNote"] == DEFAULT_SETTINGS["footerNote"]["english"]


def test_print_payload_blocks_present(client, admin_headers, doctor_headers, db):
    vid = _visit(client, admin_headers, name="Full Print")
    patient = db.get(Visit, vid).patient
    patient.external_id = "GK1234"
    db.commit()
    client.put(f"/api/visits/{vid}/exam-glasses", json={
        "exam": [{"key": "fundus", "r": "Normal", "l": "Normal"}],
        "glasses": {"r": _eye({"sph": "-2.75", "va": "6/6"}), "l": _eye({"sph": "-4.00", "va": "6/6"}),
                    "lensTypes": ["arc"], "ipd": "66"}}, headers=doctor_headers)
    _rx(client, doctor_headers, vid, "gujlish")
    p = client.get(f"/api/visits/{vid}/prescription/print", headers=admin_headers).json()
    assert p["patient"]["patientId"] == "GK1234" and p["patient"]["area"] == ""
    assert p["exam"] == [{"label": "Fundus", "r": "Normal", "l": "Normal"}]
    g = p["glasses"]
    assert [row["key"] for row in g["rows"]] == ["dist"]  # Near is empty: not printed
    assert g["rows"][0]["label"] == "Dist" and g["rows"][0]["r"]["sph"] == "-2.75" and g["rows"][0]["l"]["va"] == "6/6"
    assert g["lensTypes"] == ["ARC"] and g["ipd"] == "66"
    assert p["footerNote"] == DEFAULT_SETTINGS["footerNote"]["gujarati"]
    assert p["language"] == "gujlish"


def test_footer_falls_back_to_english_and_settings_admin(client, admin_headers, doctor_headers, db):
    new = {"doctorName": "Dr. Anu Juneja Pathak", "degrees": "M.B.B.S., M.S. (Ophth.)", "regNo": " G-12345 ",
           "footerNote": {"english": "Bring your medicines.", "hindi": "", "gujarati": "દવા સાથે લાવવી."}}
    assert client.put("/api/admin/rx-print/settings", json=new, headers=doctor_headers).status_code == 403
    r = client.put("/api/admin/rx-print/settings", json=new, headers=admin_headers)
    assert r.status_code == 200 and r.json()["regNo"] == "G-12345"
    vid = _visit(client, admin_headers, name="Hindi Print")
    _rx(client, admin_headers, vid, "hinglish")
    p = client.get(f"/api/visits/{vid}/prescription/print", headers=admin_headers).json()
    assert p["footerNote"] == "Bring your medicines."  # no Hindi note: English
    assert p["doctor"] == {"name": "Dr. Anu Juneja Pathak", "degrees": "M.B.B.S., M.S. (Ophth.)", "regNo": "G-12345"}
    g = client.get(f"/api/visits/{vid}/prescription/print?lang=gujlish", headers=admin_headers).json()
    assert g["footerNote"] == "દવા સાથે લાવવી."
    assert db.scalar(select(AuditLog).where(AuditLog.action == "rx_print.settings"))
    client.put("/api/admin/rx-print/settings", json=DEFAULT_SETTINGS, headers=admin_headers)


# --------------------------------------------------------------------------- admin lists
@pytest.mark.parametrize("path,entity", [("exam-findings", "exam_finding"), ("lens-types", "lens_type")])
def test_admin_list_crud_and_reorder(client, admin_headers, doctor_headers, path, entity, db):
    base = f"/api/admin/{path}"
    assert client.get(base, headers=doctor_headers).status_code == 403
    assert client.post(base, json={"label": "X"}, headers=doctor_headers).status_code == 403
    body = {"label": "T Cornea", "key": "t_cornea"}
    if entity == "exam_finding":
        body["defaultValue"] = "Clear"
    r = client.post(base, json=body, headers=admin_headers)
    assert r.status_code == 201, r.text
    row = r.json()
    assert row["key"] == "t_cornea" and row["active"] is True
    if entity == "exam_finding":
        assert row["defaultValue"] == "Clear"
    assert client.post(base, json={"label": "t cornea", "key": "t_other"}, headers=admin_headers).status_code == 409
    assert client.post(base, json={"label": "Another", "key": "t_cornea"}, headers=admin_headers).status_code == 409

    patch = {"label": "T Cornea (clear?)", "active": False}
    if entity == "exam_finding":
        patch["defaultValue"] = "Clear, no scar"
    r = client.patch(f"{base}/t_cornea", json=patch, headers=admin_headers)
    assert r.status_code == 200 and r.json()["label"] == "T Cornea (clear?)" and r.json()["active"] is False
    assert client.patch(f"{base}/nope", json={"label": "Y"}, headers=admin_headers).status_code == 404
    lists = client.get("/api/rx-print/lists", headers=admin_headers).json()
    assert "t_cornea" not in [x["key"] for x in lists["examFindings"] + lists["lensTypes"]]  # switched off
    every = [x["key"] for x in client.get(base, headers=admin_headers).json()]
    assert "t_cornea" in every

    order = ["t_cornea"] + [k for k in every if k != "t_cornea"]
    r = client.put(f"{base}/order", json={"keys": order}, headers=admin_headers)
    assert r.status_code == 200 and [x["key"] for x in r.json()] == order
    assert client.put(f"{base}/order", json={"keys": order[1:]}, headers=admin_headers).status_code == 422
    assert db.scalar(select(AuditLog).where(AuditLog.action == f"{entity}.reorder"))
    # put the seeded order back for the other tests
    client.put(f"{base}/order", json={"keys": every}, headers=admin_headers)


def test_admin_key_from_label(client, admin_headers):
    r = client.post("/api/admin/lens-types", json={"label": "T Anti glare+"}, headers=admin_headers)
    assert r.status_code == 201 and r.json()["key"] == "t_anti_glare"


def test_switched_off_finding_still_prints_on_old_visit(client, admin_headers, doctor_headers):
    vid = _visit(client, admin_headers, name="Old Finding")
    client.post("/api/admin/exam-findings", json={"label": "T Gonioscopy", "key": "t_gonio"}, headers=admin_headers)
    client.put(f"/api/visits/{vid}/exam-glasses", json={"exam": [{"key": "t_gonio", "r": "Open", "l": "Open"}]},
               headers=doctor_headers)
    client.patch("/api/admin/exam-findings/t_gonio", json={"active": False}, headers=admin_headers)
    _rx(client, admin_headers, vid)
    p = client.get(f"/api/visits/{vid}/prescription/print", headers=admin_headers).json()
    assert p["exam"] == [{"label": "T Gonioscopy", "r": "Open", "l": "Open"}]

