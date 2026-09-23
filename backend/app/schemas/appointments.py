from datetime import date as date_type, datetime
from typing import Literal

from pydantic import Field

from app.schemas.common import CamelModel
from app.schemas.visits import VisitOut

Channel = Literal["whatsapp", "call", "walkin"]


class AppointmentIn(CamelModel):
    """`addAppointment`: a name, optional phone, the day and how they told us (no time slots)."""

    name: str = Field(min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=20)
    date: date_type | None = None  # defaults to today (clinic TZ)
    channel: Channel = "whatsapp"
    patient_id: int | None = None  # link to an existing patient (used on check-in)
    note: str = Field(default="", max_length=255)


class AppointmentPatch(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=20)
    date: date_type | None = None
    channel: Channel | None = None
    patient_id: int | None = None
    note: str | None = Field(default=None, max_length=255)


class AppointmentOut(CamelModel):
    id: int
    name: str
    phone: str | None
    date: date_type
    channel: str
    checked_in: bool
    patient_id: int | None
    visit_id: int | None  # the visit created on check-in (same patient + same day), if any
    created_at: datetime
    note: str = ""
    # Booked by the doctor's follow-up date on this visit (the screen tags it "Follow-up").
    source_visit_id: int | None = None


class CheckinOut(CamelModel):
    appointment: AppointmentOut
    visit: VisitOut


class DayCount(CamelModel):
    total: int
    checked_in: int
