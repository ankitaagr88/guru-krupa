"""Visit kinds, the clinic's fee rules and a visit's suggested fee (lane E2 owns this module)."""
import re

from pydantic import Field, field_validator, model_validator

from app.schemas.common import CamelModel

_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


# --------------------------------------------------------------------------- visit kinds
class VisitKindIn(CamelModel):
    label: str = Field(min_length=1, max_length=80)
    standard_charge_id: int | None = None  # None = free


class VisitKindPatch(CamelModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    standard_charge_id: int | None = None  # explicit null = free
    active: bool | None = None


class VisitKindOut(CamelModel):
    id: int
    key: str
    label: str
    standard_charge_id: int | None
    charge_label: str | None = None
    charge_amount: int | None = None  # None = free
    sort_order: int
    active: bool
    in_use: int = 0  # visits carrying this kind (admin list only)


# --------------------------------------------------------------------------- rules
class FeeRules(CamelModel):
    """Stored as ClinicSetting "fee_rules" (camelCase JSON). Every field has a default so older
    rows keep working when a rule is added."""

    free_follow_up_days: int = Field(default=6, ge=0, le=3650)  # back within N days -> free
    new_case_after_days: int = Field(default=182, ge=1, le=3650)  # more than N days -> new case
    post_op_days: int = Field(default=30, ge=0, le=3650)  # after a surgery, for N days -> post_op_kind
    emergency_from: str = "20:00"  # clinic time; the window may cross midnight
    emergency_to: str = "08:00"
    emergency_on_sunday: bool = True
    emergency_charge_id: int | None = None  # None = no emergency fee suggested
    # Which visit kind each outcome uses (VisitKind.key).
    new_patient_kind: str = "new"
    free_follow_up_kind: str = "free_follow_up"
    follow_up_kind: str = "follow_up"
    new_case_kind: str = "new_case"
    post_op_kind: str = "post_op"

    @field_validator("emergency_from", "emergency_to")
    @classmethod
    def _hhmm(cls, v: str) -> str:
        v = (v or "").strip()
        if len(v) == 4 and v[1] == ":":
            v = "0" + v
        if not _HHMM.match(v):
            raise ValueError("time must be HH:MM (24-hour), e.g. 20:00")
        return v

    @model_validator(mode="after")
    def _order(self):
        if self.new_case_after_days <= self.free_follow_up_days:
            raise ValueError("'New case after' must be more days than the free follow-up")
        return self


class FeeRulesPatch(CamelModel):
    """PUT /admin/fee-rules: any subset; merged onto the stored rules, then validated as a whole."""

    free_follow_up_days: int | None = None
    new_case_after_days: int | None = None
    post_op_days: int | None = None
    emergency_from: str | None = None
    emergency_to: str | None = None
    emergency_on_sunday: bool | None = None
    emergency_charge_id: int | None = None  # explicit null = no emergency fee
    new_patient_kind: str | None = None
    free_follow_up_kind: str | None = None
    follow_up_kind: str | None = None
    new_case_kind: str | None = None
    post_op_kind: str | None = None


# --------------------------------------------------------------------------- per visit
class VisitKindSet(CamelModel):
    """PUT /visits/{id}/kind — reception (or the doctor: "Different problem") changes the kind."""

    visit_kind_key: str | None = None
    emergency: bool | None = None


class FeeLine(CamelModel):
    label: str
    amount: int
    standard_charge_id: int


class VisitFeeOut(CamelModel):
    visit_id: int
    visit_kind_key: str | None
    visit_kind_label: str | None
    suggested_kind_key: str | None  # what the rules pick today (reception may have changed it)
    emergency: bool
    suggested_emergency: bool
    days_since_last_visit: int | None
    reason: str
    lines: list[FeeLine]  # the bill lines this kind (+ emergency) puts on the bill
    note: str = ""  # "Follow-up within 6 days — no charge" when the kind is free
