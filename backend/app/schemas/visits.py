from datetime import date, date as date_type, datetime

from pydantic import Field

from app.schemas.common import CamelModel
from app.schemas.patients import PatientOut


class VisitCreate(CamelModel):
    patient_id: int
    note: str | None = None  # defaults to the patient's note
    elsewhere: bool | None = None  # defaults to the patient's flag
    elsewhere_note: str | None = None


class StageMove(CamelModel):
    stage: str


class VaIn(CamelModel):
    R: str = ""
    L: str = ""


class VisitPatch(CamelModel):
    note: str | None = None
    doctor_notes: str | None = None
    elsewhere: bool | None = None
    elsewhere_note: str | None = None
    # Doctor's panel: an explicit null clears the diagnosis (the prescription's follows it).
    diagnosis_id: int | None = None


class FollowUpIn(CamelModel):
    """`PUT /visits/{id}/follow-up`: the day to come back; books (or moves) the appointment."""

    date: date_type
    note: str = Field(default="", max_length=255)


class DilationStepOut(CamelModel):
    name: str
    min: int = Field(validation_alias="minutes")
    given: bool
    started_at: datetime | None
    done: bool


class DilationOut(CamelModel):
    current_index: int
    started_at: datetime
    steps: list[DilationStepOut]


class VisitOut(CamelModel):
    id: int
    patient_id: int
    date: date
    token: str
    stage: str
    stage_entered_at: datetime
    waiting_seconds: int  # server-side now - stageEnteredAt; client renders fmtElapsed (amber >=20 min, coral >=45)
    status: str
    va: dict[str, str]
    elsewhere: bool
    elsewhere_note: str
    note: str
    doctor_notes: str
    created_at: datetime
    completed_at: datetime | None
    patient: PatientOut
    dilation: DilationOut | None
    has_bill: bool
    has_prescription: bool
    readings_count: int
    diagnosis_id: int | None = None
    diagnosis_name: str | None = None
    follow_up_date: date_type | None = None
    follow_up_note: str = ""
    follow_up_appointment_id: int | None = None  # the appointment the follow-up booked
    # Visit kind + fee (lane E2): suggested at registration from Admin › Visit types & fee rules.
    visit_kind_key: str | None = None
    visit_kind_label: str | None = None
    visit_kind_charge: int | None = None  # the kind's fee; None = free
    emergency: bool = False  # night / Sunday emergency fee applies
    days_since_last_visit: int | None = None  # None = no earlier visit (new patient)
    fee_reason: str = ""  # "Last visit 12 days ago"
