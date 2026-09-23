"""Per-visit bill, standard charges and receipts (lane B owns this module)."""
from datetime import date, datetime

from pydantic import Field, field_validator

from app.models.billing import BILL_ITEM_KINDS

BILL_EYES = ("one", "both")
from app.schemas.common import CamelModel


# --------------------------------------------------------------------------- standard charges
class StandardChargeIn(CamelModel):
    label: str = Field(min_length=1, max_length=120)
    amount: int = Field(default=0, ge=0)  # whole rupees (one eye, for eye-wise tests)
    amount_both_eyes: int | None = Field(default=None, ge=0)  # set = priced per eye
    group_label: str = Field(default="", max_length=40)  # heading on the bill: Visit fees / Tests / Packages


class StandardChargePatch(CamelModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    amount: int | None = Field(default=None, ge=0)
    amount_both_eyes: int | None = Field(default=None, ge=0)  # explicit null = one price whatever the eyes
    group_label: str | None = Field(default=None, max_length=40)
    active: bool | None = None


class StandardChargeOut(CamelModel):
    id: int
    label: str
    amount: int
    amount_both_eyes: int | None = None
    group_label: str = ""
    active: bool
    sort_order: int


# --------------------------------------------------------------------------- bill
class BillItemIn(CamelModel):
    """A bill line. Only label + amount are required (older clients send just those)."""

    label: str = Field(min_length=1, max_length=120)
    amount: int = Field(ge=0)  # line total, whole rupees
    kind: str = "other"  # charge | medicine | other
    qty: int = Field(default=1, ge=1)
    standard_charge_id: int | None = None  # the one-tap charge it came from
    prescription_line_id: int | None = None  # the "Bought here" medicine it came from
    eyes: str | None = None  # "one" | "both" for a test priced per eye

    @field_validator("kind")
    @classmethod
    def _kind(cls, v: str) -> str:
        if v not in BILL_ITEM_KINDS:
            raise ValueError(f"kind must be one of {BILL_ITEM_KINDS}")
        return v

    @field_validator("eyes")
    @classmethod
    def _eyes(cls, v: str | None) -> str | None:
        if v not in (None, *BILL_EYES):
            raise ValueError(f"eyes must be one of {BILL_EYES}")
        return v


class BillIn(CamelModel):
    items: list[BillItemIn] = []
    payment_mode: str | None = None  # cash | upi | card | mediclaim


class BillPayIn(CamelModel):
    payment_mode: str


class BillItemOut(CamelModel):
    id: int
    label: str
    amount: int
    kind: str = "other"
    qty: int = 1
    standard_charge_id: int | None = None
    prescription_line_id: int | None = None
    price_missing: bool = False  # a "Bought here" medicine with no price in Admin — reception types it
    eyes: str | None = None  # "one" | "both"
    suggested: bool = False  # the visit's fee line (from its visit kind) or the emergency fee


class BillOut(CamelModel):
    id: int
    visit_id: int
    items: list[BillItemOut]
    total: int
    payment_mode: str | None
    paid_at: datetime | None
    paid: bool
    receipt_no: str | None = None  # "GK-2026-00001", given when first paid
    # For the printed receipt.
    patient_name: str | None = None
    token: str | None = None
    visit_date: date | None = None
    # The visit's kind (lane E2) — "Follow-up within 6 days — no charge" explains a ₹0 visit fee.
    visit_kind_key: str | None = None
    visit_kind_label: str | None = None
    emergency: bool = False
    fee_note: str = ""
