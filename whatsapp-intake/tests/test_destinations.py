"""Gurukrupa API mapping (mocked HTTP), retries, pending queue, CSV and sheet flattening."""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app.config import CLINICS_DIR, load_clinic
from app.db import IntakeRecord, PendingRecord, make_session_factory
from app.destinations import deliver, retry_pending
from app.destinations.base import DestinationError
from app.destinations.csv_file import CsvDestination
from app.destinations.google_sheet import flatten
from app.destinations.gurukrupa_api import GurukrupaApiDestination, map_record

RECORD = {
    "clinic_id": "gurukrupa", "phone": "919876543210", "language": "gujarati",
    "submitted_at": "2026-09-19T10:31:00+05:30",
    "answers": {"name": "Ramila Patel", "age": 62, "gender": "F", "address": "Vesu, Surat",
                "contact": "9825012345", "source": "social"},
}


@pytest.fixture
def cfg():
    c = load_clinic(CLINICS_DIR / "gurukrupa.yaml").destination
    c.api_url = "http://api.test/api"
    c.username, c.password = "bot", "pw"
    c.backoff_seconds = 0
    return c


class FakeResponse:
    def __init__(self, status_code, body=None):
        self.status_code = status_code
        self._body = body or {}
        self.text = str(body)
        self.content = b"x"

    def json(self):
        return self._body


class FakeClient:
    """Records every POST; scripted responses per path."""

    def __init__(self, patients_responses=None):
        self.calls = []
        self.patients_responses = list(patients_responses or [FakeResponse(201, {"id": 7})])

    def post(self, url, json=None, headers=None):
        self.calls.append((url, json, headers))
        if url.endswith("/auth/login"):
            assert json == {"username": "bot", "password": "pw"}
            return FakeResponse(200, {"access_token": "tok123", "token_type": "bearer"})
        return self.patients_responses.pop(0)


@pytest.mark.parametrize("source,key,detail", [
    ("google", "online", "Google"),
    ("social", "online", "Social media"),
    ("friend_family", "patient", ""),
    ("doctor", "doctor", ""),
])
def test_referral_source_mapping(cfg, source, key, detail):
    rec = {**RECORD, "answers": {**RECORD["answers"], "source": source}}
    body = map_record(rec, cfg)
    assert body["referralSource"] == key and body["referralDetail"] == detail


@pytest.mark.parametrize("gender,sex", [("M", "M"), ("F", "F"), ("O", "O"), (None, None)])
def test_sex_mapping(cfg, gender, sex):
    rec = {**RECORD, "answers": {**RECORD["answers"], "gender": gender}}
    assert map_record(rec, cfg)["sex"] == sex


def test_gurukrupa_api_logs_in_then_posts_patient(cfg):
    client = FakeClient()
    dest = GurukrupaApiDestination(cfg, client=client)
    dest.save(RECORD)
    login, post = client.calls
    assert login[0] == "http://api.test/api/auth/login"
    assert post[0] == "http://api.test/api/patients"
    assert post[2] == {"Authorization": "Bearer tok123"}
    assert post[1] == {
        "name": "Ramila Patel", "age": 62, "sex": "F", "phone": "9825012345", "address": "Vesu, Surat",
        "language": "gujarati", "referralSource": "online", "referralDetail": "Social media",
        "note": "Registered via WhatsApp intake",
    }
    # token is cached: second save does not log in again
    client.patients_responses.append(FakeResponse(201, {"id": 8}))
    dest.save(RECORD)
    assert [c[0] for c in client.calls].count("http://api.test/api/auth/login") == 1


def test_gurukrupa_api_relogs_in_on_401(cfg):
    client = FakeClient(patients_responses=[FakeResponse(401), FakeResponse(201, {"id": 9})])
    GurukrupaApiDestination(cfg, client=client).save(RECORD)
    urls = [c[0] for c in client.calls]
    assert urls == ["http://api.test/api/auth/login", "http://api.test/api/patients",
                    "http://api.test/api/auth/login", "http://api.test/api/patients"]


def test_gurukrupa_api_raises_on_error(cfg):
    client = FakeClient(patients_responses=[FakeResponse(500, {"detail": "boom"})])
    with pytest.raises(DestinationError):
        GurukrupaApiDestination(cfg, client=client).save(RECORD)


class Flaky:
    name = "flaky"

    def __init__(self, fail_times):
        self.fail_times, self.saved = fail_times, []

    def save(self, record):
        if self.fail_times:
            self.fail_times -= 1
            raise DestinationError("down")
        self.saved.append(record)


def _row(db):
    row = IntakeRecord(clinic_id="gurukrupa", phone="919876543210", language="gujarati",
                       answers=RECORD["answers"], submitted_at=RECORD["submitted_at"])
    db.add(row)
    db.commit()
    return row


def test_deliver_retries_with_backoff_then_succeeds():
    sf = make_session_factory("sqlite://")
    sleeps = []
    with sf() as db:
        row = _row(db)
        dest = Flaky(fail_times=2)
        assert deliver(db, row, dest, attempts=3, backoff_seconds=0.5, sleep=sleeps.append) is True
        assert sleeps == [0.5, 1.0]
        assert row.delivered_at is not None
        assert db.query(PendingRecord).count() == 0


def test_deliver_queues_pending_and_retry_delivers_later():
    sf = make_session_factory("sqlite://")
    with sf() as db:
        row = _row(db)
        dest = Flaky(fail_times=3)
        assert deliver(db, row, dest, attempts=3, backoff_seconds=0, sleep=lambda s: None) is False
        pending = db.query(PendingRecord).one()
        assert pending.record_id == row.id and pending.attempts == 3 and "down" in pending.last_error
        assert row.delivered_at is None

        # not due yet -> nothing happens
        assert retry_pending(db, "gurukrupa", dest, now=pending.next_try_at - timedelta(seconds=1)) == 0
        # due, destination healthy now -> delivered and dequeued
        assert retry_pending(db, "gurukrupa", dest, now=pending.next_try_at) == 1
        assert dest.saved[0]["answers"]["name"] == "Ramila Patel"
        assert db.query(PendingRecord).count() == 0
        assert db.get(IntakeRecord, row.id).delivered_at is not None


def test_retry_keeps_pending_when_still_failing():
    sf = make_session_factory("sqlite://")
    with sf() as db:
        row = _row(db)
        dest = Flaky(fail_times=10)
        deliver(db, row, dest, attempts=1, backoff_seconds=0, sleep=lambda s: None)
        pending = db.query(PendingRecord).one()
        due = pending.next_try_at
        assert retry_pending(db, "gurukrupa", dest, now=due) == 0
        pending = db.query(PendingRecord).one()
        assert pending.attempts == 2 and pending.next_try_at > due


def test_csv_destination_appends_rows(tmp_path):
    clinic = load_clinic(CLINICS_DIR / "gurukrupa.yaml")
    clinic.destination.path = str(tmp_path / "out.csv")
    dest = CsvDestination(clinic.destination, clinic)
    dest.save(RECORD)
    dest.save(RECORD)
    lines = (tmp_path / "out.csv").read_text(encoding="utf-8-sig").splitlines()
    assert lines[0] == "submitted_at,whatsapp,language,name,age,gender,address,contact,source"
    assert len(lines) == 3 and "Ramila Patel" in lines[1]


def test_sheet_flatten():
    row = flatten(RECORD)
    assert row["name"] == "Ramila Patel" and row["whatsapp"] == "919876543210" and row["clinic"] == "gurukrupa"
