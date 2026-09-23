from datetime import date, datetime
from typing import Annotated

from pydantic import BeforeValidator, Field

from app.schemas.common import CamelModel

Sex = str | None  # "M" | "F" | "O"


def _sex(v):
    """The column holds one letter: accept "M"/"F"/"O" (any case) or the word "Other"."""
    if v is None or v == "":
        return None
    s = str(v).strip().upper()
    s = {"OTHER": "O", "MALE": "M", "FEMALE": "F"}.get(s, s)
    if s not in ("M", "F", "O"):
        raise ValueError("Sex must be F, M or Other")
    return s


SexIn = Annotated[str | None, BeforeValidator(_sex)]
MAX_AGE_YEARS = 120


def check_dob(v: date | None) -> date | None:
    """A date of birth must be a real past day, and not more than 120 years back."""
    if v is None:
        return v
    today = date.today()
    if v > today:
        raise ValueError("Date of birth cannot be in the future")
    try:
        oldest = today.replace(year=today.year - MAX_AGE_YEARS)
    except ValueError:  # 29 Feb
        oldest = today.replace(year=today.year - MAX_AGE_YEARS, day=28)
    if v < oldest:
        raise ValueError(f"Date of birth is more than {MAX_AGE_YEARS} years ago - please check it")
    return v


class PatientIn(CamelModel):
    """Fields of the mockup's `addNewPatient` form. When both `dob` and `age` are sent, the DOB wins."""

    name: str = Field(min_length=1, max_length=120)
    dob: date | None = None
    age: int | None = None
    sex: SexIn = None
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
    # "Add as a family member": link the new patient to the owner of the shared number (or to the
    # owner of the family `family_owner_id` belongs to) with their relation (Relation.key; None = not set).
    family_owner_id: int | None = None
    relation_key: str | None = None


class PatientPatch(CamelModel):
    """Partial update (`onDetailInput`, setSex, setLanguage, conditions, referral)."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    dob: date | None = None
    age: int | None = None
    sex: SexIn = None
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
    dob: date | None = None
    age: int | None  # age today (from the DOB, or the told age grown with the calendar)
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
    # Family on this mobile number: a member points at the owner with their relation to them
    # ("Son of Rasila Patel"); the owner has neither. familySize counts the owner too (1 = no family).
    family_owner_id: int | None = None
    relation_key: str | None = None
    relation_label: str | None = None
    family_owner_name: str | None = None
    family_size: int = 1
    # PATCH only: how many family members' phones followed the owner's new number.
    family_phone_updated: int = 0


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
