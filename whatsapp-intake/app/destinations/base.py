"""A destination is where a completed form goes. ``save`` raises on failure."""
from __future__ import annotations

from typing import Any, Protocol

# The record every destination receives:
# {
#   "clinic_id": "gurukrupa",
#   "phone": "919876543210",          # WhatsApp number the patient chatted from
#   "language": "gujarati",
#   "submitted_at": "2026-09-19T10:31:00+05:30",
#   "answers": {"name": ..., "age": 45, "gender": "M", "address": ..., "contact": "98765...", "source": "google"}
# }
Record = dict[str, Any]


class DestinationError(Exception):
    """Raised by a destination when the record could not be stored."""


class Destination(Protocol):
    name: str

    def save(self, record: Record) -> None: ...
