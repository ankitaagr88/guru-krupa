from datetime import datetime

from pydantic import Field

from app.schemas.common import CamelModel


class MachineOut(CamelModel):
    key: str
    label: str
    fields: list[str]
    manual_only: bool


class ReadingValue(CamelModel):
    l: str = Field(min_length=1, max_length=40)  # noqa: E741 - mockup's {l, v}
    v: str = Field(max_length=40)
    ok: bool | None = None  # False when the OCR value failed its sanity range


class ReadingOut(CamelModel):
    id: int
    visit_id: int
    machine_key: str
    machine: str  # display label from app.ocr.templates
    source: str  # "scanned" | "manual"
    corrected: bool = False  # staff edited the values after OCR (PATCH /readings/{id}/values)
    captured_at: datetime
    image_path: str | None
    image_url: str | None
    status: str  # pending | processing | done | failed
    values: list[ReadingValue]
    confidence: float | None
    client_uuid: str | None
    error: str | None
    approved: bool = False  # a person approved the values; the printout photo has been deleted
    approved_at: datetime | None = None
    approved_by: str | None = None  # staff name
    approved_by_id: int | None = None


class ReadingApproveIn(CamelModel):
    """`POST /readings/{id}/approve`: optionally correct the values in the same step."""

    values: list[ReadingValue] | None = None


class ManualReadingIn(CamelModel):
    visit_id: int
    machine_key: str
    values: list[ReadingValue] = Field(min_length=1)
    captured_at: datetime | None = None


class ReadingValuesPatch(CamelModel):
    values: list[ReadingValue]


class ExamPhotoOut(CamelModel):
    id: int
    visit_id: int
    image_path: str
    captured_at: datetime
    url: str
