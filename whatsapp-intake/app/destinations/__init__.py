"""Destination factory + delivery with retries and a pending queue.

Delivery never blocks the patient: if the destination keeps failing after ``attempts`` tries,
the record is stored in ``pending_records`` and retried in the background. The patient still
gets the closing message.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import ClinicConfig
from app.db import IntakeRecord, PendingRecord
from app.destinations.base import Destination, DestinationError, Record

log = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class NullDestination:
    name = "none"

    def save(self, record: Record) -> None:
        log.info("no destination configured; record kept only in intake_records: %s", record)


def build_destination(clinic: ClinicConfig) -> Destination:
    cfg = clinic.destination
    if cfg.kind == "gurukrupa_api":
        from app.destinations.gurukrupa_api import GurukrupaApiDestination
        return GurukrupaApiDestination(cfg)
    if cfg.kind == "google_sheet":
        from app.destinations.google_sheet import GoogleSheetDestination
        return GoogleSheetDestination(cfg)
    if cfg.kind == "csv":
        from app.destinations.csv_file import CsvDestination
        return CsvDestination(cfg, clinic)
    return NullDestination()


def record_from_row(row: IntakeRecord) -> Record:
    return {
        "clinic_id": row.clinic_id,
        "phone": row.phone,
        "language": row.language,
        "submitted_at": row.submitted_at,
        "answers": row.answers,
    }


def deliver(
    db: Session,
    row: IntakeRecord,
    destination: Destination,
    attempts: int = 3,
    backoff_seconds: float = 1.0,
    sleep: Callable[[float], None] = time.sleep,
) -> bool:
    """Try ``attempts`` times with exponential backoff; queue in pending_records on failure."""
    record = record_from_row(row)
    error = ""
    for i in range(max(1, attempts)):
        try:
            destination.save(record)
            row.delivered_at = _utcnow()
            db.commit()
            return True
        except Exception as exc:  # noqa: BLE001 - any failure must not reach the patient
            error = f"{type(exc).__name__}: {exc}"
            log.warning("destination %s attempt %d failed: %s", destination.name, i + 1, error)
            if i < attempts - 1:
                sleep(backoff_seconds * (2**i))
    db.add(
        PendingRecord(
            record_id=row.id,
            clinic_id=row.clinic_id,
            attempts=attempts,
            last_error=error,
            created_at=_utcnow(),
            next_try_at=_utcnow() + timedelta(minutes=1),
        )
    )
    db.commit()
    log.error("record %s queued in pending_records after %d attempts", row.id, attempts)
    return False


def retry_pending(db: Session, clinic_id: str, destination: Destination, now: datetime | None = None) -> int:
    """Retry every due pending record for a clinic once. Returns how many were delivered."""
    now = now or _utcnow()
    due = db.scalars(
        select(PendingRecord).where(PendingRecord.clinic_id == clinic_id, PendingRecord.next_try_at <= now)
    ).all()
    delivered = 0
    for pending in due:
        row = db.get(IntakeRecord, pending.record_id)
        if row is None:
            db.delete(pending)
            continue
        try:
            destination.save(record_from_row(row))
        except Exception as exc:  # noqa: BLE001
            pending.attempts += 1
            pending.last_error = f"{type(exc).__name__}: {exc}"
            pending.next_try_at = now + timedelta(minutes=min(2**pending.attempts, 60))
            log.warning("retry of record %s failed (%d attempts)", row.id, pending.attempts)
        else:
            row.delivered_at = now
            db.delete(pending)
            delivered += 1
            log.info("pending record %s delivered", row.id)
    db.commit()
    return delivered


__all__ = ["Destination", "DestinationError", "build_destination", "deliver", "retry_pending", "NullDestination"]
