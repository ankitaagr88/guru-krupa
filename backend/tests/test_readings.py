"""B6 API: machines list, scanned upload -> background OCR, idempotent retry, manual TBUT reading,
value correction, delete, exam photos and the protected /uploads endpoint."""
import io
import uuid

import numpy as np
import pytest
from PIL import Image
from sqlalchemy import select

from app.config import settings
from app.models import AuditLog, Reading
from app.seed.reference import seed_reference
from app.services import readings as svc


@pytest.fixture(scope="module", autouse=True)
def _seed():
    from app.db import SessionLocal

    with SessionLocal() as db:
        seed_reference(db)


@pytest.fixture(autouse=True)
def upload_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path / "uploads"))
    return tmp_path / "uploads"


@pytest.fixture
def visit_id(client, admin_headers):
    r = client.post("/api/patients", json={"name": f"Reader {uuid.uuid4().hex[:6]}"}, headers=admin_headers)
    assert r.status_code == 201, r.text
    r = client.post("/api/visits", json={"patientId": r.json()["id"]}, headers=admin_headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def png_bytes(size=(8, 8), color=(255, 255, 255)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def printout_png() -> bytes:
    from tests.test_ocr import SYNTHETIC, render_printout

    buf = io.BytesIO()
    render_printout(SYNTHETIC["hnt1p_tono"][0]).save(buf, format="PNG")
    return buf.getvalue()


def upload(client, headers, visit_id, machine_key, data: bytes = None, content_type="image/png", **fields):
    files = {"image": ("shot.png", data if data is not None else png_bytes(), content_type)}
    form = {"visitId": str(visit_id), "machineKey": machine_key, **{k: str(v) for k, v in fields.items()}}
    return client.post("/api/readings", data=form, files=files, headers=headers)


# ---------------------------------------------------------------- machines / auth

def test_unauthenticated(client):
    assert client.get("/api/machines").status_code == 401
    assert client.post("/api/readings").status_code == 401
    assert client.get("/api/uploads/2026/09/x.png").status_code == 401


def test_machines(client, admin_headers):
    r = client.get("/api/machines", headers=admin_headers)
    assert r.status_code == 200
    rows = r.json()
    assert [m["key"] for m in rows] == ["hnt1p_tono", "hrk8000a_ref", "hrk8000a_ker", "clm1_lensmeter",
                                        "ypc100k_ref", "ypc100k_ker", "hbm1_biometry", "tbut_schirmer"]
    assert rows[0] == {"key": "hnt1p_tono", "label": "HNT-1P — Tono-Pachy (IOP & CCT)",
                       "fields": ["IOP (R)", "IOP (L)", "CIOP (R)", "CIOP (L)", "CCT (R)", "CCT (L)"],
                       "manualOnly": False}
    assert rows[-1]["manualOnly"] is True and rows[-1]["fields"] == ["TBUT (R)", "TBUT (L)", "Schimer (R)",
                                                                     "Schimer (L)"]


# ---------------------------------------------------------------- scanned upload flow

def test_upload_runs_background_ocr_and_never_sticks(client, admin_headers, visit_id, upload_dir):
    r = upload(client, admin_headers, visit_id, "hrk8000a_ref", clientCapturedAt="2026-09-19T10:05:00+05:30")
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["status"] == "pending" and body["source"] == "scanned" and body["values"] == []
    assert body["machine"] == "HRK-8000A — Refraction (REF)" and body["machineKey"] == "hrk8000a_ref"
    assert body["capturedAt"].startswith("2026-09-19T04:35:00")
    assert body["imagePath"].endswith(".png") and body["imageUrl"] == f"/api/uploads/{body['imagePath']}"
    assert (upload_dir / body["imagePath"]).is_file()
    assert body["corrected"] is False and "error" not in body

    # TestClient runs BackgroundTasks before returning: the 8x8 blank PNG has no text -> done or failed
    r = client.get(f"/api/readings/{body['id']}", headers=admin_headers)
    assert r.status_code == 200
    got = r.json()
    assert got["status"] in ("done", "failed"), got
    if got["status"] == "failed":
        assert got["error"]
    assert got["status"] != "processing"

    rows = client.get(f"/api/visits/{visit_id}/readings", headers=admin_headers).json()
    assert [x["id"] for x in rows] == [body["id"]]
    assert client.get(f"/api/visits/{visit_id}", headers=admin_headers).json()["readingsCount"] == 1

    # the stored file is served back to authenticated staff
    r = client.get(body["imageUrl"], headers=admin_headers)
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and len(r.content) > 0
    assert client.get("/api/uploads/2099/01/missing.png", headers=admin_headers).status_code == 404
    assert client.get("/api/uploads/../../.env", headers=admin_headers).status_code in (404, 422)


def test_upload_real_printout_extracts_values(client, admin_headers, visit_id):
    from app.ocr import tesseract_available

    if not tesseract_available():
        pytest.skip("Tesseract binary not reachable (set TESSERACT_CMD)")
    r = upload(client, admin_headers, visit_id, "hnt1p_tono", printout_png())
    assert r.status_code == 202, r.text
    got = client.get(f"/api/readings/{r.json()['id']}", headers=admin_headers).json()
    assert got["status"] == "done", got
    assert {v["l"]: v["v"] for v in got["values"]} == {"IOP (R)": "13", "IOP (L)": "12", "CIOP (R)": "15",
                                                       "CIOP (L)": "15", "CCT (R)": "499", "CCT (L)": "508"}
    assert got["confidence"] == 1.0 and all("ok" not in v for v in got["values"])


def test_upload_validation(client, admin_headers, visit_id):
    assert upload(client, admin_headers, 999999, "hrk8000a_ref").status_code == 404
    assert upload(client, admin_headers, visit_id, "nope").status_code == 422
    r = upload(client, admin_headers, visit_id, "tbut_schirmer")
    assert r.status_code == 422 and "manual" in r.json()["detail"]
    assert upload(client, admin_headers, visit_id, "hrk8000a_ref", b"hello", "text/plain").status_code == 415
    assert client.post("/api/readings", data={"visitId": visit_id}, headers=admin_headers).status_code == 422


def test_upload_too_large(client, admin_headers, visit_id, monkeypatch):
    from app.services import uploads

    monkeypatch.setattr(uploads, "MAX_BYTES", 100)
    r = upload(client, admin_headers, visit_id, "hrk8000a_ref", png_bytes((64, 64)))
    assert r.status_code == 413
    assert not list(uploads.upload_root().rglob("*.png"))  # partial file removed


def test_idempotent_client_uuid(client, admin_headers, visit_id, db):
    cu = str(uuid.uuid4())
    r1 = upload(client, admin_headers, visit_id, "hrk8000a_ker", clientUuid=cu)
    assert r1.status_code == 202 and r1.json()["clientUuid"] == cu
    r2 = upload(client, admin_headers, visit_id, "hrk8000a_ker", clientUuid=cu)
    assert r2.status_code == 200 and r2.json()["id"] == r1.json()["id"]
    assert r2.json()["status"] in ("done", "failed")  # the first upload's OCR already ran
    assert db.scalar(select(Reading).where(Reading.client_uuid == cu)) is not None
    assert len(client.get(f"/api/visits/{visit_id}/readings", headers=admin_headers).json()) == 1


def test_process_reading_failure_is_recorded(db, visit_id, monkeypatch):
    """A crash inside OCR must leave `failed` + error, never `processing`."""
    from app.models.patients import Visit

    reading = svc.create_scanned(db, db.get(Visit, visit_id), svc.get_machine("ypc100k_ref"), "2026/09/gone.png")
    svc.process_reading(reading.id)  # file does not exist -> exception path
    db.expire_all()
    got = db.get(Reading, reading.id)
    assert got.status == "failed" and got.error
    svc.delete_reading(db, got)


# ---------------------------------------------------------------- manual + correction + delete

def test_manual_reading_for_tbut(client, admin_headers, visit_id):
    body = {"visitId": visit_id, "machineKey": "tbut_schirmer",
            "values": [{"l": "TBUT (R)", "v": "8s"}, {"l": "TBUT (L)", "v": "9s"},
                       {"l": "Schimer (R)", "v": "12mm"}, {"l": "Schimer (L)", "v": "14mm"}]}
    r = client.post("/api/readings/manual", json=body, headers=admin_headers)
    assert r.status_code == 201, r.text
    got = r.json()
    assert got["source"] == "manual" and got["status"] == "done" and got.get("confidence") is None
    assert got["machine"] == "TBUT / Schimer I" and got["values"] == body["values"]
    assert "imagePath" not in got and "imageUrl" not in got  # exclude_none
    assert client.post("/api/readings/manual", json={**body, "values": []}, headers=admin_headers).status_code == 422
    assert client.post("/api/readings/manual", json={**body, "machineKey": "x"}, headers=admin_headers).status_code == 422
    assert client.post("/api/readings/manual", json={**body, "visitId": 999999}, headers=admin_headers).status_code == 404


def test_patch_values_marks_corrected(client, admin_headers, visit_id, db):
    rid = upload(client, admin_headers, visit_id, "clm1_lensmeter").json()["id"]
    new = [{"l": "SPH (R)", "v": "-0.75"}, {"l": "CYL (R)", "v": "-1.75"}, {"l": "AXS (R)", "v": "174"},
           {"l": "SPH (L)", "v": "-0.50"}, {"l": "CYL (L)", "v": "-1.25"}, {"l": "AXS (L)", "v": "163"}]
    r = client.patch(f"/api/readings/{rid}/values", json={"values": new}, headers=admin_headers)
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["values"] == new and got["status"] == "done" and got["corrected"] is True and "error" not in got
    assert got["source"] in ("scanned", "corrected")
    assert client.get(f"/api/readings/{rid}", headers=admin_headers).json()["corrected"] is True
    audit = db.scalar(select(AuditLog).where(AuditLog.entity == "reading", AuditLog.entity_id == rid))
    assert audit is not None and audit.detail["corrected"] is True and audit.detail["to"] == new
    assert client.patch("/api/readings/999999/values", json={"values": new}, headers=admin_headers).status_code == 404
    assert client.patch(f"/api/readings/{rid}/values", json={"values": [{"l": "", "v": "1"}]},
                        headers=admin_headers).status_code == 422


def test_delete_reading_removes_file(client, admin_headers, visit_id, upload_dir):
    body = upload(client, admin_headers, visit_id, "ypc100k_ker").json()
    path = upload_dir / body["imagePath"]
    assert path.is_file()
    assert client.delete(f"/api/readings/{body['id']}", headers=admin_headers).status_code == 204
    assert not path.exists()
    assert client.get(f"/api/readings/{body['id']}", headers=admin_headers).status_code == 404
    assert client.delete(f"/api/readings/{body['id']}", headers=admin_headers).status_code == 404


# ---------------------------------------------------------------- exam photos

def test_exam_photos(client, admin_headers, visit_id, upload_dir):
    files = {"image": ("eye.jpg", png_bytes(), "image/jpeg")}
    r = client.post(f"/api/visits/{visit_id}/exam-photos", files=files, headers=admin_headers)
    assert r.status_code == 201, r.text
    photo = r.json()
    assert photo["visitId"] == visit_id and photo["imagePath"].endswith(".jpg") and photo["capturedAt"]
    assert photo["url"] == f"/api/uploads/{photo['imagePath']}"
    assert (upload_dir / photo["imagePath"]).is_file()

    r = client.post(f"/api/visits/{visit_id}/exam-photos", files={"image": ("eye.png", png_bytes(), "image/png")},
                    data={"capturedAt": "2026-09-19T11:00:00Z"}, headers=admin_headers)
    assert r.status_code == 201 and r.json()["capturedAt"].startswith("2026-09-19T11:00:00")

    rows = client.get(f"/api/visits/{visit_id}/exam-photos", headers=admin_headers).json()
    assert [p["id"] for p in rows] == [photo["id"], r.json()["id"]]
    assert client.get(photo["url"], headers=admin_headers).status_code == 200

    assert client.delete(f"/api/exam-photos/{photo['id']}", headers=admin_headers).status_code == 204
    assert not (upload_dir / photo["imagePath"]).exists()
    assert client.delete(f"/api/exam-photos/{photo['id']}", headers=admin_headers).status_code == 404
    assert len(client.get(f"/api/visits/{visit_id}/exam-photos", headers=admin_headers).json()) == 1
    assert client.post("/api/visits/999999/exam-photos", files=files, headers=admin_headers).status_code == 404
    assert client.post(f"/api/visits/{visit_id}/exam-photos", files={"image": ("a.gif", b"GIF89a", "image/gif")},
                       headers=admin_headers).status_code == 415


# ---------------------------------------------------------------- nginx hand-off

def test_uploads_x_accel(client, admin_headers, monkeypatch):
    monkeypatch.setattr(settings, "USE_X_ACCEL", True)
    r = client.get("/api/uploads/2026/09/whatever.jpg", headers=admin_headers)
    assert r.status_code == 200 and r.content == b""
    assert r.headers["x-accel-redirect"] == "/uploads/2026/09/whatever.jpg"


def test_preprocess_on_uploaded_file_shape(upload_dir):
    """Sanity: the array the engine gets is a binary 2-D image of the stored upload."""
    from app.ocr.preprocess import preprocess

    upload_dir.mkdir(parents=True)
    p = upload_dir / "x.png"
    Image.fromarray(np.full((300, 500, 3), 240, np.uint8)).save(p)
    out = preprocess(p)
    assert out.ndim == 2 and set(np.unique(out)) <= {0, 255}


# ---------------------------------------------------------------- approval / image retention

def test_approve_deletes_image_and_audits(client, admin_headers, visit_id, upload_dir, db):
    r = upload(client, admin_headers, visit_id, "hrk8000a_ref")
    rid, path = r.json()["id"], r.json()["imagePath"]
    assert (upload_dir / path).is_file()
    got = client.get(f"/api/readings/{rid}", headers=admin_headers).json()
    assert got["status"] in ("done", "failed") and got["approved"] is False

    new = [{"l": "SPH (R)", "v": "-0.25"}, {"l": "CYL (R)", "v": "-2.00"}]
    r = client.post(f"/api/readings/{rid}/approve", json={"values": new}, headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["approved"] is True and body["approvedAt"] and body["approvedBy"] == "Admin" and body["approvedById"]
    assert body["status"] == "done" and body["values"] == new and body["corrected"] is True
    assert "imagePath" not in body and "imageUrl" not in body  # null -> excluded
    assert not (upload_dir / path).exists()
    row = db.get(Reading, rid)
    assert row.image_path is None and row.approved_at is not None
    audit = db.scalar(select(AuditLog).where(AuditLog.entity == "reading", AuditLog.entity_id == rid,
                                             AuditLog.action == "reading.approve"))
    assert audit is not None and audit.detail["imageDeleted"] is True and audit.detail["values"] == new
    # approving again (no body) is harmless
    assert client.post(f"/api/readings/{rid}/approve", headers=admin_headers).status_code == 200
    assert client.post("/api/readings/999999/approve", headers=admin_headers).status_code == 404


def test_approve_while_processing_is_409(client, admin_headers, visit_id, db):
    r = upload(client, admin_headers, visit_id, "hrk8000a_ref")
    rid = r.json()["id"]
    row = db.get(Reading, rid)
    row.status = "processing"
    db.commit()
    assert client.post(f"/api/readings/{rid}/approve", headers=admin_headers).status_code == 409
    row.status = "pending"
    db.commit()
    assert client.post(f"/api/readings/{rid}/approve", headers=admin_headers).status_code == 409
    assert db.get(Reading, rid).image_path  # untouched


def test_purge_stale_images(client, admin_headers, visit_id, upload_dir, db):
    from datetime import datetime, timedelta, timezone

    old = upload(client, admin_headers, visit_id, "hrk8000a_ref").json()
    fresh = upload(client, admin_headers, visit_id, "hnt1p_tono").json()
    twin_a = upload(client, admin_headers, visit_id, "clm1_lensmeter").json()
    for body in (old, twin_a):
        row = db.get(Reading, body["id"])
        row.captured_at = datetime.now(timezone.utc) - timedelta(days=10)
        row.status = "done"
    # a second reading sharing twin_a's photo (REF/KER twin): the file must survive until both are gone
    shared = Reading(visit_id=visit_id, machine_key="hrk8000a_ker", source="scanned", status="done",
                     image_path=twin_a["imagePath"], captured_at=datetime.now(timezone.utc), values=[])
    db.add(shared)
    db.commit()

    assert svc.purge_stale_images(db, older_than_days=7) == 2
    assert db.get(Reading, old["id"]).image_path is None and not (upload_dir / old["imagePath"]).exists()
    assert db.get(Reading, twin_a["id"]).image_path is None and (upload_dir / twin_a["imagePath"]).is_file()
    assert db.get(Reading, fresh["id"]).image_path == fresh["imagePath"] and (upload_dir / fresh["imagePath"]).is_file()
    assert db.scalar(select(AuditLog).where(AuditLog.action == "reading.purge_image",
                                            AuditLog.entity_id == old["id"])) is not None
    assert svc.purge_stale_images(db, older_than_days=7) == 0  # idempotent

    # the CLI entry point uses the configured retention
    from app.maintenance import main

    assert main(["--days", "7"]) == 0


def test_hrk_upload_derives_twin_ker_reading(client, admin_headers, visit_id, upload_dir, db):
    """One HRK-8000A photo carries [REF] and [KER]: uploading it as hrk8000a_ref also stores a
    hrk8000a_ker reading (same image, source scanned, no client_uuid)."""
    from pathlib import Path

    from app.ocr import tesseract_available

    if not tesseract_available():
        pytest.skip("Tesseract binary not reachable (set TESSERACT_CMD)")
    sample = Path(__file__).parent / "ocr_samples" / "hrk8000a_ref_ker_01.png"
    r = upload(client, admin_headers, visit_id, "hrk8000a_ref", sample.read_bytes(), clientUuid=str(uuid.uuid4()))
    assert r.status_code == 202, r.text
    rows = client.get(f"/api/visits/{visit_id}/readings", headers=admin_headers).json()
    by_key = {x["machineKey"]: x for x in rows}
    assert set(by_key) == {"hrk8000a_ref", "hrk8000a_ker"}
    ref, ker = by_key["hrk8000a_ref"], by_key["hrk8000a_ker"]
    assert ref["status"] == "done" and {v["l"]: v["v"] for v in ref["values"]} == {
        "SPH (R)": "+0.00", "CYL (R)": "-1.75", "AX (R)": "170", "SPH (L)": "+0.25", "CYL (L)": "-2.00",
        "AX (L)": "161", "PD": "66mm"}
    assert ker["status"] == "done" and ker["source"] == "scanned" and ker["confidence"] == 1.0
    assert {v["l"]: v["v"] for v in ker["values"]} == {"K1 (R)": "41.40", "K2 (R)": "43.85", "K1 (L)": "42.15",
                                                       "K2 (L)": "44.65"}
    assert ker["imagePath"] == ref["imagePath"] and "clientUuid" not in ker and ref["clientUuid"]
    assert ker["machine"] == "HRK-8000A — Keratometry (KER)"
    # deleting one twin keeps the shared photo for the other
    assert client.delete(f"/api/readings/{ker['id']}", headers=admin_headers).status_code == 204
    assert (upload_dir / ref["imagePath"]).is_file()
    assert client.delete(f"/api/readings/{ref['id']}", headers=admin_headers).status_code == 204
    assert not (upload_dir / ref["imagePath"]).exists()
