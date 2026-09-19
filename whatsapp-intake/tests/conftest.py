from __future__ import annotations

from datetime import datetime

import pytest

from app.config import CLINICS_DIR, load_clinic
from app.conversation import Conversation
from app.db import make_session_factory
from app.messages import IncomingMessage


class RecordingDestination:
    """Collects saved records; can be told to fail N times."""
    name = "recording"

    def __init__(self, fail_times: int = 0):
        self.saved: list[dict] = []
        self.fail_times = fail_times
        self.calls = 0

    def save(self, record):
        self.calls += 1
        if self.fail_times > 0:
            self.fail_times -= 1
            raise RuntimeError("destination down")
        self.saved.append(record)


class Clock:
    def __init__(self, start: datetime):
        self.now = start

    def __call__(self):
        return self.now

    def advance(self, **kwargs):
        from datetime import timedelta
        self.now += timedelta(**kwargs)


@pytest.fixture
def gurukrupa():
    cfg = load_clinic(CLINICS_DIR / "gurukrupa.yaml")
    cfg.destination.backoff_seconds = 0
    return cfg


@pytest.fixture
def session_factory():
    return make_session_factory("sqlite://")   # in-memory, fresh per test


@pytest.fixture
def clock():
    return Clock(datetime(2026, 9, 19, 5, 0, 0))   # 10:30 IST


@pytest.fixture
def destination():
    return RecordingDestination()


@pytest.fixture
def convo(gurukrupa, destination, session_factory, clock):
    return Conversation(gurukrupa, destination, session_factory, now=clock, sleep=lambda s: None)


class Patient:
    """Drives a Conversation like a WhatsApp user and keeps every bot message."""

    def __init__(self, convo: Conversation, phone: str = "919876500001"):
        self.convo = convo
        self.phone = phone
        self.outbox = []

    def say(self, text: str):
        out = self.convo.handle(IncomingMessage(from_phone=self.phone, text=text))
        self.outbox.extend(out)
        return out

    def tap(self, option_id: str, title: str = ""):
        out = self.convo.handle(IncomingMessage(from_phone=self.phone, selected_id=option_id, selected_title=title))
        self.outbox.extend(out)
        return out


@pytest.fixture
def patient(convo):
    return Patient(convo)
