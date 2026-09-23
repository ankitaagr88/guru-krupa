"""New-patient form (`/register`): the public self-fill page and the same page used by staff.

Same questions as the reception "New patient" form (`PatientIn`), but every field has a length
limit because the public endpoint is open to anyone with the link.
"""
from datetime import date
from typing import Literal

from pydantic import Field, field_validator

from app.schemas.common import CamelModel


class IntakeReferralSource(CamelModel):
    key: str
    label: str
    needs_detail: bool


class IntakeListsOut(CamelModel):
    """The admin-configured lists the form shows. Nothing about any patient."""

    referral_sources: list[IntakeReferralSource]
    conditions: list[str]


class IntakeIn(CamelModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(default="", max_length=20, pattern=r"^[0-9+\-() .]*$")
    dob: date | None = None
    age: int | None = Field(default=None, ge=0, le=120)
    sex: Literal["M", "F", "O", "Other"] | None = None
    address: str = Field(default="", max_length=255)
    occupation: str = Field(default="", max_length=120)
    screen_hours: int | None = Field(default=None, ge=0, le=24)
    language: Literal["english", "gujarati", "hindi"] | None = None
    elsewhere: bool = False
    elsewhere_note: str = Field(default="", max_length=500)
    referral_source: str | None = Field(default=None, max_length=30)
    referral_detail: str = Field(default="", max_length=120)
    existing_conditions: list[str] = Field(default=[], max_length=20)
    condition_other: str = Field(default="", max_length=120)
    # Honeypot: hidden on the page, so only a bot fills it in.
    website: str = Field(default="", max_length=200)

    @field_validator("name", "phone", "address", "occupation", "elsewhere_note", "referral_detail",
                     "condition_other")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, v: str) -> str:
        if not v:
            raise ValueError("Name is needed")
        return v

    @field_validator("sex")
    @classmethod
    def _sex_letter(cls, v: str | None) -> str | None:
        return "O" if v == "Other" else v  # the column holds one letter

    @field_validator("existing_conditions")
    @classmethod
    def _conditions_short(cls, v: list[str]) -> list[str]:
        if any(len(c) > 80 for c in v):
            raise ValueError("Condition name too long")
        return list(dict.fromkeys(v))


class IntakeOut(CamelModel):
    """The public page gets the token only. Staff also get the new ids."""

    token: str
    patient_id: int | None = None
    visit_id: int | None = None
