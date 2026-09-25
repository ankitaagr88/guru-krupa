"""Per-visit bill, standard charges, part payments and receipts (lanes B and M)."""
from datetime import date, datetime

from pydantic import Field, field_validator

from app.models.billing import BILL_ITEM_KINDS

BILL_EYES = ("one", "both")
from app.schemas.common import CamelModel


# --------------------------------------------------------------------------- standard charges
class StandardChargeIn(CamelModel):
    label: str = Field(min_length=1, max_length=120)
    amount: int = Field(default=0, ge=0)  # whole rupees (one eye, for eye-wise tests); 0 = typed at billing
    amount_both_eyes: int | None = Field(default=None, ge=0)  # set = priced per eye
    group_label: str = Field(default="", max_length=40)  # heading on the bill: Visit fees / Tests / Packages
    account_head_key: str | None = Field(default=None, max_length=30)  # day-book column (AccountHead.key)


class StandardChargePatch(CamelModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    amount: int | None = Field(default=None, ge=0)
    amount_both_eyes: int | None = Field(default=None, ge=0)  # explicit null = one price whatever the eyes
    group_label: str | None = Field(default=None, max_length=40)
    account_head_key: str | None = Field(default=None, min_length=1, max_length=30)  # day-book column
    active: bool | None = None


class StandardChargeOut(CamelModel):
    id: int
    label: str
    amount: int
    amount_both_eyes: int | None = None
    group_label: str = ""
    account_head_key: str | None = None  # day-book column (Admin › Day book columns)
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
    # Day-book column. Left out: the charge's column; a medicine -> the day-book settings'
    # `medicineHead`; a typed line -> `otherHead`.
    account_head_key: str | None = Field(default=None, max_length=30)

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
    """`POST /bill/pay` (older callers): receive the whole balance in this mode."""

    payment_mode: str


class PaymentIn(CamelModel):
    """`POST /bill/payments`: money received against the bill (part payments allowed)."""

    amount: int = Field(gt=0)  # whole rupees, at most the balance
    mode: str  # cash | upi | card | mediclaim
    note: str = Field(default="", max_length=255)


class PaymentOut(CamelModel):
    id: int
    amount: int
    mode: str
    at: datetime
    by_name: str | None = None  # staff who received it
    note: str = ""


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
    account_head_key: str | None = None  # day-book column (stored, or worked out for older lines)


class BillOut(CamelModel):
    id: int
    visit_id: int
    items: list[BillItemOut]
    total: int
    # Mode of the latest payment (a bill paid in two modes lists both under `payments`); before any
    # payment, the mode reception picked, if any.
    payment_mode: str | None
    paid_at: datetime | None  # when the balance reached 0 (or the ₹0 bill was closed as "No charge")
    paid: bool  # nothing left to collect: paid in full, or a ₹0 bill closed as "No charge"
    receipt_no: str | None = None  # "GK-2026-00001", given with the first payment
    payments: list[PaymentOut] = []
    paid_amount: int = 0  # sum of the payments
    balance: int = 0  # total - paidAmount; below 0 = money to give back (lines taken off after paying)
    # unpaid | part_paid | paid | no_charge | overpaid. A ₹0 bill not closed yet is "unpaid" but owes 0.
    status: str = "unpaid"
    patient_id: int | None = None
    # For the printed receipt.
    patient_name: str | None = None
    token: str | None = None
    visit_date: date | None = None
    # The visit's kind (lane E2) — "Follow-up within 6 days — no charge" explains a ₹0 visit fee.
    visit_kind_key: str | None = None
    visit_kind_label: str | None = None
    emergency: bool = False
    fee_note: str = ""


class OwedBill(CamelModel):
    """A bill with money still to collect (the patient page, the billing drawer, Today)."""

    visit_id: int
    patient_id: int
    name: str
    token: str | None = None
    visit_date: date | None = None
    total: int
    paid_amount: int
    balance: int
