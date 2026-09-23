"""Per-visit bill, standard charges and receipts (lane B owns this module)."""
from datetime import datetime

from pydantic import Field

from app.schemas.common import CamelModel


class BillItemIn(CamelModel):
    label: str = Field(min_length=1, max_length=120)
    amount: int = Field(ge=0)


class BillIn(CamelModel):
    items: list[BillItemIn] = []
    payment_mode: str | None = None  # cash | upi | card | mediclaim


class BillPayIn(CamelModel):
    payment_mode: str


class BillItemOut(CamelModel):
    id: int
    label: str
    amount: int


class BillOut(CamelModel):
    id: int
    visit_id: int
    items: list[BillItemOut]
    total: int
    payment_mode: str | None
    paid_at: datetime | None
    paid: bool
