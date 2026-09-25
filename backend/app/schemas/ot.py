"""OT / surgery schemas (mockup `otCases`). The nested sections (`preOpBiometry`, `operative`,
`postOp`, `billing`) are stored and returned as raw dicts with the mockup's camelCase keys verbatim,
so they are typed `dict` here rather than modelled field-by-field."""
from datetime import date as date_type, datetime
from typing import Any

from pydantic import Field

from app.schemas.common import CamelModel
from app.schemas.readings import ReadingValue


class LensTierOut(CamelModel):
    key: str
    label: str
    price: int


class OtConsentPhotoOut(CamelModel):
    id: int
    image_path: str
    captured_at: datetime


class OtCaseCreate(CamelModel):
    """`addOtCase`: either an existing `patientId` (demographics copied) or free-text name/age/sex."""

    patient_id: int | None = None
    patient_name: str | None = Field(None, max_length=120)
    age: int | None = None
    sex: str | None = None
    date: date_type
    time_slot: str = Field(min_length=1, max_length=20)
    procedure: str = Field(min_length=1, max_length=160)
    pre_op_biometry: dict[str, Any] | None = None


class OtCasePatch(CamelModel):
    """Partial update. Section dicts are deep-merged into the stored JSON, not replaced (a list inside,
    such as `billing.team`, replaces the old list; the team is checked by app.services.ot_team.clean_team).
    Surgery times: `operative.startTime` / `operative.endTime` ("HH:MM"), set by the doctor / OT staff."""

    patient_name: str | None = Field(None, max_length=120)
    age: int | None = None
    sex: str | None = None
    date: date_type | None = None
    time_slot: str | None = Field(None, max_length=20)
    procedure: str | None = Field(None, max_length=160)
    pre_op_biometry: dict[str, Any] | None = None
    operative: dict[str, Any] | None = None
    post_op: dict[str, Any] | None = None
    billing: dict[str, Any] | None = None


class OtStatusIn(CamelModel):
    status: str


class OtSlotOut(CamelModel):
    time_slot: str
    case_id: int | None
    patient_name: str | None


class OtCaseOut(CamelModel):
    id: int
    patient_id: int | None
    patient_name: str
    age: int | None
    sex: str | None
    date: date_type
    time_slot: str
    procedure: str
    status: str
    pre_op_biometry: dict[str, Any]
    operative: dict[str, Any]
    consent_photos: list[OtConsentPhotoOut]
    post_op: dict[str, Any]
    billing: dict[str, Any]  # stored keys + team + computed `lensPrice`, `teamFees`, `total` (= lens + fees)
    created_at: datetime
    updated_at: datetime | None


class OtBiometryScanOut(CamelModel):
    """`POST /ot/cases/{id}/biometry/scan`: the case after merging the readable HBM-1 values, every
    extracted value (`ok: false` = failed its sanity range and was NOT merged) and the OCR confidence."""

    case: OtCaseOut
    values: list[ReadingValue]
    confidence: float
