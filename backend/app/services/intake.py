"""New-patient form (`/register`): create the patient and put them in today's queue.

The public page (a QR code at the front desk) only ever creates. It never says whether a phone
number is already registered: a same-phone match is still registered, with a line in the visit
note so reception can check for a duplicate. Staff using the same page get the duplicate prompt
in the app instead (`GET /patients/by-phone`), so their entries carry no note.
"""
import threading
import time
from collections import deque

from sqlalchemy.orm import Session

from app.models.patients import Patient, Visit
from app.schemas.intake import IntakeIn
from app.schemas.patients import PatientIn, check_dob
from app.seed.reference import CONDITIONS
from app.services import admin as admin_svc
from app.services.admin import AdminError
from app.services import patients as patients_svc
from app.services import queue as queue_svc

SELF_FILLED_NOTE = "Filled the new-patient form themselves: please check the details with them."
SAME_PHONE_NOTE = "Same phone as an existing patient: check for a duplicate."


class IntakeError(ValueError):
    pass


class RateLimiter:
    """At most `limit` submissions per `window` seconds from one address. In memory, per process:
    enough to stop someone hammering the public page, not a security boundary."""

    def __init__(self):
        self._hits: dict[str, deque] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window: int, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            while hits and hits[0] <= now - window:
                hits.popleft()
            if len(hits) >= limit:
                return False
            hits.append(now)
            if len(self._hits) > 10_000:  # forget idle addresses so memory stays small
                self._hits = {k: v for k, v in self._hits.items() if v and v[-1] > now - window}
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


def lists(db: Session) -> dict:
    return {"referral_sources": admin_svc.referral_sources(db), "conditions": list(CONDITIONS)}


def submit(db: Session, data: IntakeIn, *, by_staff: bool, staff=None) -> tuple[Patient, Visit]:
    """Create the patient and today's visit at the first stage. Raises IntakeError (-> 422)."""
    try:
        check_dob(data.dob)
    except ValueError as exc:
        raise IntakeError(str(exc))
    key = patients_svc.phone_key(data.phone)
    if not by_staff and len(key) < 10:
        raise IntakeError("A 10-digit mobile number is needed")
    unknown = [c for c in data.existing_conditions if c not in CONDITIONS]
    if unknown:
        raise IntakeError(f"Unknown condition '{unknown[0]}'")

    notes = []
    if not by_staff:
        notes.append(SELF_FILLED_NOTE)
        if patients_svc.patients_by_phone(db, data.phone, limit=1):
            notes.append(SAME_PHONE_NOTE)

    fields = data.model_dump(exclude={"website"})
    if not by_staff:
        fields.pop("family_owner_id", None)  # the public page never links anyone to a family
        fields.pop("relation_key", None)
    body = PatientIn(**fields)
    if body.dob is not None:
        body.age = None  # the DOB wins over a told age
    try:
        patient = patients_svc.create_patient(db, body, by=staff)
    except patients_svc.UnknownReferralSource as exc:
        raise IntakeError(f"Unknown referral source '{exc}'")
    except AdminError as exc:  # staff "Add as a family member": unknown owner or relation
        raise IntakeError(str(exc))
    visit = queue_svc.register_visit(db, patient, note=" ".join(notes))
    return patient, visit
