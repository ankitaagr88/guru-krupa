"""Destination: append each completed form as a row to a CSV file (opens in Excel)."""
from __future__ import annotations

import csv
import threading
from pathlib import Path

from app.config import ClinicConfig, DestinationConfig
from app.destinations.base import DestinationError, Record

_lock = threading.Lock()


class CsvDestination:
    name = "csv"

    def __init__(self, cfg: DestinationConfig, clinic: ClinicConfig):
        self.path = Path(cfg.path or f"data/{clinic.id}-intake.csv")
        self.columns = ["submitted_at", "whatsapp", "language", *(q.key for q in clinic.questions)]

    def save(self, record: Record) -> None:
        row = {
            "submitted_at": record["submitted_at"],
            "whatsapp": record["phone"],
            "language": record["language"],
            **record["answers"],
        }
        try:
            with _lock:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                new = not self.path.exists() or self.path.stat().st_size == 0
                # utf-8-sig so Excel shows Gujarati/Hindi correctly.
                with open(self.path, "a", newline="", encoding="utf-8-sig") as fh:
                    w = csv.DictWriter(fh, fieldnames=self.columns, extrasaction="ignore")
                    if new:
                        w.writeheader()
                    w.writerow(row)
        except OSError as exc:
            raise DestinationError(f"csv write failed: {exc}") from exc
