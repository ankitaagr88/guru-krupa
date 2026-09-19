from datetime import date, datetime

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
