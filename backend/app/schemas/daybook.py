"""Day book (the clinic's daily cash sheet), its columns (account heads) and the cash drawer
(lane M). Money is whole rupees."""
from datetime import date, datetime

from pydantic import Field, field_validator

from app.models.billing import CASH_DIRECTIONS
from app.schemas.common import CamelModel


# --------------------------------------------------------------------------- columns (account heads)
class AccountHeadOut(CamelModel):
    id: int
    key: str
    label: str
    sort_order: int
    active: bool
    use_count: int = 0  # standard charges + bill lines under it (delete needs 0)


class AccountHeadIn(CamelModel):
    label: str = Field(min_length=1, max_length=40)
    # Optional: worked out from the label ("Contact lens" -> "contact_lens") when left out.
    key: str | None = Field(default=None, min_length=1, max_length=30, pattern=r"^[a-z0-9_\-]+$")


class AccountHeadPatch(CamelModel):
    label: str | None = Field(default=None, min_length=1, max_length=40)
    active: bool | None = None


class AccountHeadOrder(CamelModel):
    keys: list[str]


class DayBookSettings(CamelModel):
    """Stored as ClinicSetting "daybook" (camelCase JSON): which column medicines, hand-typed bill
    lines and OT (lens) payments are counted under."""

    medicine_head: str = "med"
    other_head: str = "other"
    ot_head: str = "ot"


class DayBookSettingsPatch(CamelModel):
    medicine_head: str | None = Field(default=None, min_length=1, max_length=30)
    other_head: str | None = Field(default=None, min_length=1, max_length=30)
    ot_head: str | None = Field(default=None, min_length=1, max_length=30)


# --------------------------------------------------------------------------- the day's sheet
class HeadColumn(CamelModel):
    key: str
    label: str


class DayBookRow(CamelModel):
    """One line of the sheet. `kind`: "visit" (a visit that day, ₹0 ones included), "old_balance"
    (money received that day for an earlier visit's bill) or "ot" (a surgery that day, its lens
    price under the OT column)."""

    kind: str
    visit_id: int | None = None
    ot_case_id: int | None = None
    patient_id: int | None = None
    name: str
    phone: str | None = None
    age_sex: str = ""  # "20/F"
    area: str = ""  # patient address
    token: str | None = None
    visit_date: date | None = None  # for old-balance rows: the visit the money was owed for
    amounts: dict[str, int] = {}  # head key -> rupees charged under it
    total: int = 0  # visit / OT: the bill total; old balance: the amount received that day
    received: int = 0  # money received that day for this row
    modes: list[str] = []  # payment modes of the money received that day, in order
    left: int = 0  # still owed now (bill balance)
    status: str = ""  # the bill's status (unpaid / part_paid / paid / no_charge / overpaid)
    in_clinic: bool = False  # visit rows: the patient is still in the clinic (visit not completed yet)
    note: str = ""


class ModeAmount(CamelModel):
    mode: str
    payments: int
    amount: int


class CashMovementOut(CamelModel):
    id: int
    direction: str  # out | in
    amount: int
    person: str
    reason: str
    at: datetime
    by_name: str | None = None


class CashBox(CamelModel):
    """closing = opening + cash received + cash put in − cash taken out. Only cash payments count;
    UPI / card / mediclaim never touch the drawer."""

    opening_cash: int
    # "set" = typed for this day; "carried" = the last set day's opening carried forward through the
    # days since (its closing cash); "none" = never set, starts at 0.
    opening_source: str
    opening_set_by: str | None = None
    opening_set_at: datetime | None = None
    opening_note: str = ""
    cash_received: int
    movements: list[CashMovementOut]
    cash_in: int
    cash_out: int
    closing_cash: int


class DayBookTotals(CamelModel):
    amounts: dict[str, int]
    total: int
    received: int
    left: int


class DayBookOut(CamelModel):
    date: date
    heads: list[HeadColumn]  # the columns, in order (switched-off ones only when used that day)
    rows: list[DayBookRow]
    totals: DayBookTotals
    by_mode: list[ModeAmount]  # money received that day by mode (bills + OT)
    received_total: int
    cash: CashBox


class OpeningIn(CamelModel):
    opening_cash: int = Field(ge=0)
    note: str = Field(default="", max_length=255)


class CashMovementIn(CamelModel):
    direction: str = "out"  # out | in
    amount: int = Field(gt=0)
    person: str = Field(default="", max_length=80)  # who took / gave it ("MAAM")
    reason: str = Field(default="", max_length=255)

    @field_validator("direction")
    @classmethod
    def _direction(cls, v: str) -> str:
        if v not in CASH_DIRECTIONS:
            raise ValueError(f"direction must be one of {CASH_DIRECTIONS}")
        return v
