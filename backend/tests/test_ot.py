from datetime import date, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select

from app.config import settings
from app.models.ot import OtCase, OtConsentPhoto
from app.seed.reference import seed_reference
from app.services import ot as svc

D0 = date(2031, 3, 10)  # fixed far-future dates so tests never collide with "today" data
D1 = D0 + timedelta(days=1)
PROC = "Cataract — Phaco with IOL (OD)"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


@pytest.fixture(scope="module", autouse=True)
def _seed_and_clear():
    from app.db import SessionLocal

    with SessionLocal() as db:
        seed_reference(db)
        for p in db.scalars(select(OtConsentPhoto)):
            db.delete(p)
        for c in db.scalars(select(OtCase)):
            db.delete(c)
        db.commit()


@pytest.fixture
def reception_headers(client, db):
    from app.auth.service import ensure_user

    ensure_user(db, username="ot_recep", password="recep123", name="Front Desk", role="reception")
    r = client.post("/api/auth/login", json={"username": "ot_recep", "password": "recep123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _case(client, headers, **body):
    payload = {"date": D0.isoformat(), "timeSlot": "9:00 AM", "procedure": PROC, "patientName": "Free Text"}
    payload.update(body)
    r = client.post("/api/ot/cases", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def test_slots_constant():
    assert svc.DEFAULT_OT_SLOTS[0] == "9:00 AM" and svc.DEFAULT_OT_SLOTS[1] == "9:45 AM" and svc.DEFAULT_OT_SLOTS[-1] == "4:30 PM"
    assert "12:00 PM" in svc.DEFAULT_OT_SLOTS and "12:45 PM" in svc.DEFAULT_OT_SLOTS and len(svc.DEFAULT_OT_SLOTS) == 11


def test_unauthenticated(client):
    assert client.get("/api/ot/cases").status_code == 401
    assert client.get("/api/lens-tiers").status_code == 401


def test_lens_tiers(client, admin_headers):
    r = client.get("/api/lens-tiers", headers=admin_headers)
    assert r.status_code == 200
    assert [t["key"] for t in r.json()] == ["monofocal", "multifocal", "toric"]
    assert r.json()[0] == {"key": "monofocal", "label": "Monofocal IOL", "price": 28500}


def test_create_copies_patient_and_defaults(client, admin_headers):
    r = client.post("/api/patients", json={"name": "Rujavana Madhani", "age": 52, "sex": "F"}, headers=admin_headers)
    pid = r.json()["id"]
    c = _case(client, admin_headers, patientId=pid, patientName=None, timeSlot="10:30 AM",
              preOpBiometry={"AL": {"R": "22.90mm", "L": "22.80mm"}})
    assert c["patientId"] == pid and c["patientName"] == "Rujavana Madhani" and c["age"] == 52 and c["sex"] == "F"
    assert c["status"] == "scheduled" and c["timeSlot"] == "10:30 AM" and c["date"] == D0.isoformat()
    assert c["preOpBiometry"]["AL"] == {"R": "22.90mm", "L": "22.80mm"}
    assert c["preOpBiometry"]["K1"] == {"R": "", "L": ""}  # merged onto the empty template
    assert c["operative"]["surgeon"] == "Dr. Anu Juneja Pathak"
    assert c["postOp"]["finalRx"]["R"] == {"sph": "", "cyl": "", "axis": "", "va": ""}
    assert c["billing"] == {"lensTier": None, "mediclaim": False, "paymentMode": None, "lensPrice": 0, "total": 0}
    assert c["consentPhotos"] == [] and c["createdAt"] and c["updatedAt"]

    assert client.post("/api/ot/cases", json={"date": D0.isoformat(), "timeSlot": "11:15 AM", "procedure": PROC},
                       headers=admin_headers).status_code == 422
    assert client.post("/api/ot/cases", json={"patientId": 999999, "date": D0.isoformat(), "timeSlot": "11:15 AM",
                                              "procedure": PROC}, headers=admin_headers).status_code == 404


def test_slot_conflict_and_slots_endpoint(client, admin_headers):
    a = _case(client, admin_headers, patientName="Slot Holder", timeSlot="2:15 PM")
    r = client.post("/api/ot/cases", json={"patientName": "Late Comer", "date": D0.isoformat(), "timeSlot": "2:15 PM",
                                           "procedure": PROC}, headers=admin_headers)
    assert r.status_code == 409
    # same slot on another day is fine
    _case(client, admin_headers, patientName="Other Day", timeSlot="2:15 PM", date=D1.isoformat())

    slots = client.get(f"/api/ot/slots?date={D0.isoformat()}", headers=admin_headers).json()
    assert [s["timeSlot"] for s in slots] == svc.DEFAULT_OT_SLOTS
    by = {s["timeSlot"]: s for s in slots}
    assert by["2:15 PM"] == {"timeSlot": "2:15 PM", "caseId": a["id"], "patientName": "Slot Holder"}
    assert by["3:00 PM"] == {"timeSlot": "3:00 PM", "caseId": None, "patientName": None}

    # cancelling frees the slot
    client.delete(f"/api/ot/cases/{a['id']}", headers=admin_headers)
    by = {s["timeSlot"]: s for s in client.get(f"/api/ot/slots?date={D0.isoformat()}", headers=admin_headers).json()}
    assert by["2:15 PM"]["caseId"] is None
    assert client.post("/api/ot/cases", json={"patientName": "Late Comer", "date": D0.isoformat(),
                                              "timeSlot": "2:15 PM", "procedure": PROC},
                       headers=admin_headers).status_code == 201


def test_list_ordered_by_slot(client, admin_headers):
    day = D0 + timedelta(days=5)
    for slot in ("3:00 PM", "9:45 AM", "11:15 AM"):
        _case(client, admin_headers, patientName=f"P {slot}", timeSlot=slot, date=day.isoformat())
    rows = client.get(f"/api/ot/cases?date={day.isoformat()}", headers=admin_headers).json()
    assert [r["timeSlot"] for r in rows] == ["9:45 AM", "11:15 AM", "3:00 PM"]
    assert client.get("/api/ot/cases", headers=admin_headers).status_code == 200  # defaults to today


def test_patch_deep_merge_and_move(client, admin_headers):
    c = _case(client, admin_headers, patientName="Merge Me", timeSlot="12:00 PM")
    cid = c["id"]
    r = client.patch(f"/api/ot/cases/{cid}", json={"postOp": {"finalRx": {"R": {"sph": "-0.25"}}}}, headers=admin_headers)
    assert r.status_code == 200, r.text
    po = r.json()["postOp"]
    assert po["finalRx"]["R"] == {"sph": "-0.25", "cyl": "", "axis": "", "va": ""}
    assert po["finalRx"]["L"] == {"sph": "", "cyl": "", "axis": "", "va": ""}
    assert po["followUpVA"] == {"R": "", "L": ""} and po["followUpNotes"] == ""

    r = client.patch(f"/api/ot/cases/{cid}", json={"postOp": {"finalRx": {"R": {"cyl": "-0.50"}}, "nextFollowUp": "1 week"},
                                                   "operative": {"iolPower": "22.5D"},
                                                   "preOpBiometry": {"K1": {"R": "43.27D"}},
                                                   "procedure": "LASIK"}, headers=admin_headers)
    body = r.json()
    assert body["postOp"]["finalRx"]["R"] == {"sph": "-0.25", "cyl": "-0.50", "axis": "", "va": ""}
    assert body["postOp"]["nextFollowUp"] == "1 week"
    assert body["operative"]["iolPower"] == "22.5D" and body["operative"]["surgeon"] == "Dr. Anu Juneja Pathak"
    assert body["preOpBiometry"]["K1"] == {"R": "43.27D", "L": ""} and body["procedure"] == "LASIK"

    # persisted (fresh GET)
    g = client.get(f"/api/ot/cases/{cid}", headers=admin_headers).json()
    assert g["postOp"]["finalRx"]["R"]["sph"] == "-0.25" and g["operative"]["iolPower"] == "22.5D"

    # billing: lens tier drives lensPrice/total; unknown tier -> 400
    b = client.patch(f"/api/ot/cases/{cid}", json={"billing": {"lensTier": "toric", "mediclaim": True}},
                     headers=admin_headers).json()["billing"]
    assert b == {"lensTier": "toric", "mediclaim": True, "paymentMode": None, "lensPrice": 38000, "total": 38000}
    b = client.patch(f"/api/ot/cases/{cid}", json={"billing": {"paymentMode": "mediclaim"}}, headers=admin_headers).json()["billing"]
    assert b["lensTier"] == "toric" and b["paymentMode"] == "mediclaim" and b["total"] == 38000
    assert client.patch(f"/api/ot/cases/{cid}", json={"billing": {"lensTier": "diamond"}},
                        headers=admin_headers).status_code == 400

    # moving into an occupied slot -> 409; into a free one -> 200
    _case(client, admin_headers, patientName="Blocker", timeSlot="12:45 PM")
    assert client.patch(f"/api/ot/cases/{cid}", json={"timeSlot": "12:45 PM"}, headers=admin_headers).status_code == 409
    assert client.patch(f"/api/ot/cases/{cid}", json={"timeSlot": "12:45 PM", "date": D1.isoformat()},
                        headers=admin_headers).status_code == 200
    assert client.patch("/api/ot/cases/999999", json={"procedure": "x"}, headers=admin_headers).status_code == 404


def test_status(client, admin_headers):
    c = _case(client, admin_headers, patientName="Status Person", timeSlot="3:45 PM")
    cid = c["id"]
    for s in ("in_progress", "completed"):
        r = client.post(f"/api/ot/cases/{cid}/status", json={"status": s}, headers=admin_headers)
        assert r.status_code == 200 and r.json()["status"] == s
    assert client.post(f"/api/ot/cases/{cid}/status", json={"status": "bogus"}, headers=admin_headers).status_code == 400
    assert client.post("/api/ot/cases/999999/status", json={"status": "completed"}, headers=admin_headers).status_code == 404

    r = client.delete(f"/api/ot/cases/{cid}", headers=admin_headers)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    # un-cancelling into a slot that has since been taken -> 409
    _case(client, admin_headers, patientName="Took The Slot", timeSlot="3:45 PM")
    assert client.post(f"/api/ot/cases/{cid}/status", json={"status": "scheduled"}, headers=admin_headers).status_code == 409


def test_consent_photos(client, admin_headers, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    c = _case(client, admin_headers, patientName="Consent Person", timeSlot="4:30 PM")
    cid = c["id"]
    r = client.post(f"/api/ot/cases/{cid}/consent-photos", files={"file": ("consent.png", PNG, "image/png")},
                    headers=admin_headers)
    assert r.status_code == 201, r.text
    photos = r.json()["consentPhotos"]
    assert len(photos) == 1 and photos[0]["capturedAt"] and photos[0]["id"]
    rel = photos[0]["imagePath"]
    assert rel.startswith("ot/") and rel.endswith(".png") and Path(rel).parts[1:3] == tuple(
        f"{x}" for x in (f"{date.today():%Y}", f"{date.today():%m}"))
    assert (tmp_path / rel).read_bytes() == PNG

    assert client.post(f"/api/ot/cases/{cid}/consent-photos", files={"file": ("x.txt", b"hello", "text/plain")},
                       headers=admin_headers).status_code == 415
    assert client.post("/api/ot/cases/999999/consent-photos", files={"file": ("c.png", PNG, "image/png")},
                       headers=admin_headers).status_code == 404

    g = client.get(f"/api/ot/cases/{cid}", headers=admin_headers).json()
    assert len(g["consentPhotos"]) == 1
    r = client.delete(f"/api/ot/consent-photos/{photos[0]['id']}", headers=admin_headers)
    assert r.status_code == 204
    assert not (tmp_path / rel).exists()
    assert client.get(f"/api/ot/cases/{cid}", headers=admin_headers).json()["consentPhotos"] == []
    assert client.delete(f"/api/ot/consent-photos/{photos[0]['id']}", headers=admin_headers).status_code == 404


def test_role_denials(client, admin_headers, reception_headers):
    c = _case(client, reception_headers, patientName="Recep Booked", timeSlot="9:00 AM", date=(D0 + timedelta(days=9)).isoformat())
    cid = c["id"]
    # reception can edit scheduling / biometry / billing, not operative or post-op notes
    assert client.patch(f"/api/ot/cases/{cid}", json={"procedure": "LASIK", "billing": {"mediclaim": True}},
                        headers=reception_headers).status_code == 200
    assert client.patch(f"/api/ot/cases/{cid}", json={"operative": {"notes": "x"}}, headers=reception_headers).status_code == 403
    assert client.patch(f"/api/ot/cases/{cid}", json={"postOp": {"followUpNotes": "x"}}, headers=reception_headers).status_code == 403
    assert client.patch(f"/api/ot/cases/{cid}", json={"operative": {"notes": "x"}}, headers=admin_headers).status_code == 200
    # cancel is admin/doctor only
    assert client.delete(f"/api/ot/cases/{cid}", headers=reception_headers).status_code == 403
    assert client.get("/api/lens-tiers", headers=reception_headers).status_code == 200


def test_counts_and_range(client, admin_headers):
    base = D0 + timedelta(days=20)
    _case(client, admin_headers, patientName="C1", timeSlot="9:00 AM", date=base.isoformat())
    _case(client, admin_headers, patientName="C2", timeSlot="9:45 AM", date=base.isoformat())
    x = _case(client, admin_headers, patientName="C3", timeSlot="10:30 AM", date=base.isoformat())
    _case(client, admin_headers, patientName="C4", timeSlot="9:00 AM", date=(base + timedelta(days=2)).isoformat())
    client.delete(f"/api/ot/cases/{x['id']}", headers=admin_headers)  # cancelled: not counted

    r = client.get(f"/api/ot/counts?from={base.isoformat()}&to={(base + timedelta(days=3)).isoformat()}", headers=admin_headers)
    assert r.status_code == 200
    assert r.json() == {base.isoformat(): 2, (base + timedelta(days=2)).isoformat(): 1}
    assert client.get(f"/api/ot/counts?from={base.isoformat()}", headers=admin_headers).status_code == 422
    assert client.get(f"/api/ot/counts?from={base.isoformat()}&to={(base - timedelta(days=1)).isoformat()}",
                      headers=admin_headers).status_code == 400

    rows = client.get(f"/api/ot/cases?from={base.isoformat()}&to={(base + timedelta(days=3)).isoformat()}",
                      headers=admin_headers).json()
    assert [(r["date"], r["timeSlot"]) for r in rows] == [
        (base.isoformat(), "9:00 AM"), (base.isoformat(), "9:45 AM"), (base.isoformat(), "10:30 AM"),
        ((base + timedelta(days=2)).isoformat(), "9:00 AM")]
    assert client.get(f"/api/ot/cases?from={base.isoformat()}", headers=admin_headers).status_code == 400


def test_deep_merge_unit():
    base = {"a": {"b": 1, "c": {"d": 2}}, "e": [1]}
    out = svc.deep_merge(base, {"a": {"c": {"x": 3}}, "e": [2], "f": None})
    assert out == {"a": {"b": 1, "c": {"d": 2, "x": 3}}, "e": [2], "f": None}
    assert base == {"a": {"b": 1, "c": {"d": 2}}, "e": [1]}  # input untouched


def test_biometry_patch_unit():
    values = [{"l": "AL (R)", "v": "22.90"}, {"l": "AL (L)", "v": "22.80"}, {"l": "ACD (R)", "v": "2.70"},
              {"l": "K1 (R)", "v": "43.27"}, {"l": "K2 (L)", "v": "43.93"}, {"l": "Target (R)", "v": "0.00"},
              {"l": "Axis (R)", "v": "65"},  # no slot in preOpBiometry
              {"l": "K1 (L)", "v": "99.00", "ok": False}]  # failed sanity -> not merged
    assert svc.biometry_patch(values) == {"AL": {"R": "22.90mm", "L": "22.80mm"}, "ACD": {"R": "2.70mm"},
                                         "K1": {"R": "43.27D"}, "K2": {"L": "43.93D"},
                                         "targetRefraction": {"R": "0.00D"}}


def test_biometry_scan_real_iol_report(client, admin_headers, tmp_path, monkeypatch):
    from app.ocr import tesseract_available

    if not tesseract_available():
        pytest.skip("Tesseract binary not reachable (set TESSERACT_CMD)")
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    c = _case(client, admin_headers, patientName="Rujavana Madhani", timeSlot="3:45 PM",
              date=(D0 + timedelta(days=40)).isoformat(), preOpBiometry={"AL": {"R": "old", "L": ""}})
    cid = c["id"]
    sample = Path(__file__).parent / "ocr_samples" / "hbm1_iol_report_01.png"
    r = client.post(f"/api/ot/cases/{cid}/biometry/scan",
                    files={"image": ("iol.png", sample.read_bytes(), "image/png")}, headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"case", "values", "confidence"}
    got = {v["l"]: v["v"] for v in body["values"]}
    assert got["AL (R)"] == "22.90" and got["AL (L)"] == "22.80" and got["K1 (R)"] == "43.27"
    assert got["K2 (L)"] == "43.93" and got["Target (R)"] == "0.00" and got["Axis (L)"] == "166"
    assert body["confidence"] >= 0.9 and all("ok" not in v for v in body["values"])
    bio = body["case"]["preOpBiometry"]
    assert bio["AL"] == {"R": "22.90mm", "L": "22.80mm"} and bio["ACD"] == {"R": "2.70mm", "L": "2.77mm"}
    assert bio["K1"] == {"R": "43.27D", "L": "43.34D"} and bio["K2"] == {"R": "43.48D", "L": "43.93D"}
    assert bio["targetRefraction"] == {"R": "0.00D", "L": "0.00D"}
    assert "Axis" not in bio
    # persisted
    assert client.get(f"/api/ot/cases/{cid}", headers=admin_headers).json()["preOpBiometry"]["K1"]["R"] == "43.27D"
    # the report photo is kept under UPLOAD_DIR/ot/
    assert list((tmp_path / "ot").rglob("*.png"))
    # validation
    assert client.post(f"/api/ot/cases/{cid}/biometry/scan", files={"image": ("x.txt", b"hi", "text/plain")},
                       headers=admin_headers).status_code == 415
    assert client.post(f"/api/ot/cases/{cid}/biometry/scan", files={"image": ("e.png", b"", "image/png")},
                       headers=admin_headers).status_code == 400
    assert client.post("/api/ot/cases/999999/biometry/scan", files={"image": ("iol.png", PNG, "image/png")},
                       headers=admin_headers).status_code == 404
    assert client.post(f"/api/ot/cases/{cid}/biometry/scan", files={"image": ("junk.png", PNG, "image/png")},
                       headers=admin_headers).status_code in (200, 422)  # unreadable 8x8 png: no values or 422
