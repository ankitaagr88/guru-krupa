"""Per-visit bill, standard charges and receipts (lane B owns this module)."""
from datetime import date, datetime

from pydantic import Field, field_validator

from app.models.billing import BILL_ITEM_KINDS
from app.schemas.common import CamelModel


# --------------------------------------------------------------------------- standard charges
class StandardChargeIn(CamelModel):
    label: str = Field(min_length=1, max_length=120)
    amount: int = Field(default=0, ge=0)  # whole rupees


class StandardChargePatch(CamelModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    amount: int | None = Field(default=None, ge=0)
    active: bool | None = None


class StandardChargeOut(CamelModel):
    id: int
    label: str
    amount: int
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

    @field_validator("kind")
    @classmethod
    def _kind(cls, v: str) -> str:
        if v not in BILL_ITEM_KINDS:
            raise ValueError(f"kind must be one of {BILL_ITEM_KINDS}")
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
