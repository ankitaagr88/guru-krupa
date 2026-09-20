from datetime import date, datetime

from pydantic import Field

from app.schemas.common import CamelModel

Sex = str | None  # "M" | "F" | "O"


class PatientIn(CamelModel):
    """Fields of the mockup's `addNewPatient` form."""

    name: str = Field(min_length=1, max_length=120)
    age: int | None = None
    sex: Sex = None
    phone: str | None = None
    address: str | None = None
    occupation: str | None = None
    screen_hours: int | None = None
    language: str | None = None
    elsewhere: bool = False
    elsewhere_note: str = ""
    note: str = ""
    referral_source: str | None = None  # ReferralSource.key, e.g. "doctor"
    referral_detail: str = ""
    existing_conditions: list[str] = []
    condition_other: str = ""


class PatientPatch(CamelModel):
    """Partial update (`onDetailInput`, setSex, setLanguage, conditions, referral)."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    age: int | None = None
    sex: Sex = None
    phone: str | None = None
    address: str | None = None
    occupation: str | None = None
    screen_hours: int | None = None
    language: str | None = None
    elsewhere: bool | None = None
    elsewhere_note: str | None = None
    note: str | None = None
    referral_source: str | None = None
    referral_detail: str | None = None
    existing_conditions: list[str] | None = None
    condition_other: str | None = None


class PatientOut(CamelModel):
    id: int
    name: str
    external_id: str | None = None  # id in the previous system (KiviHealth Local Id)
    age: int | None
    sex: Sex
    phone: str | None
    address: str | None
    occupation: str | None
    screen_hours: int | None
    language: str | None
    elsewhere: bool
    elsewhere_note: str
    note: str
    referral_source: str | None
    referral_detail: str
    existing_conditions: list[str]
    condition_other: str
    created_at: datetime
    last_visit_date: date | None = None  # latest completed visit (`lookupLastVisit`)
    # Today's active visit, if any (search modal shows token + stage).
    visit_id: int | None = None
    token: str | None = None
    stage: str | None = None


class VisitHistoryItem(CamelModel):
    id: int
    date: date
    token: str
    stage: str
    status: str
    va: dict[str, str]
    readings_count: int
    has_prescription: bool
    has_bill: bool
    completed_at: datetime | None


class PatientDetail(PatientOut):
    visits: list[VisitHistoryItem]  # newest first
