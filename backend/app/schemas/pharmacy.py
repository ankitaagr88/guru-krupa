from datetime import datetime

from pydantic import Field

from app.schemas.common import CamelModel


# --------------------------------------------------------------------------- medicines
class MedicineOut(CamelModel):
    """`buildMedDatalist` row: brand-first, generic composition underneath."""

    id: int
    name: str  # display name: brand when present, else composition
    brand: str | None
    composition: str
    form: str  # MedicineForm key (drops, gel, ointment, suspension, tablet, capsule, syrup, gummies, ...)
    form_label: str  # "Drops", "Gel" ... (falls back to the key)
    strength: str | None
    pack_size: str | None
    manufacturer: str | None
    display_name: str  # "Aquaray Gel (Carboxymethylcellulose sodium eye drops IP)"
    active: bool = True


# --------------------------------------------------------------------------- prescriptions
class PrescriptionLineIn(CamelModel):
    """One `med-row`: free-text name (matched against the master list), dosage, qty handed over."""

    name: str = Field(min_length=1, max_length=160)
    medicine_id: int | None = None
    dosage: str = ""
    qty_given: int = Field(default=0, ge=0)


class PrescriptionIn(CamelModel):
    lines: list[PrescriptionLineIn] = []
    print_language: str | None = None  # hinglish|gujlish|english (or hindi|gujarati)


class PrescriptionLineOut(CamelModel):
    id: int
    medicine_id: int | None
    name: str
    matched: bool
    dosage: str
    qty_given: int
    form: str | None = None  # from the matched medicine; None for free-text lines
    form_label: str | None = None


class PrescriptionOut(CamelModel):
    id: int
    visit_id: int
    print_language: str
    created_at: datetime
    lines: list[PrescriptionLineOut]
    low_stock: list[str] = []  # item names now at/below reorder level (`pushLowStockToast`)


class PrintLine(CamelModel):
    name: str  # what was prescribed (brand when matched to a branded row)
    dosage: str
    dosage_local: str
    qty_given: int
    brand: str | None = None  # print bold; None for generic-only / unmatched lines
    composition: str | None = None  # print under the brand in smaller type
    form: str | None = None  # type key, printed next to the medicine ("Drops", "Gel")
    form_label: str | None = None
    pack_size: str | None = None


class PrintPayload(CamelModel):
    hospital: dict[str, str]
    patient: dict  # name, age, sex, token, date
    language: str  # hinglish | gujlish | english
    lines: list[PrintLine]


# --------------------------------------------------------------------------- inventory
class InventoryItemIn(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)  # defaults to the medicine's name
    unit: str = "bottles"
    stock: int = Field(default=0, ge=0)
    reorder_level: int = Field(default=5, ge=0)
    medicine_id: int | None = None


class InventoryItemPatch(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    unit: str | None = None
    reorder_level: int | None = Field(default=None, ge=0)
    medicine_id: int | None = None


class InventoryItemOut(CamelModel):
    id: int
    name: str
    unit: str
    stock: int
    reorder_level: int
    low: bool
    medicine_id: int | None


class StockAdjustIn(CamelModel):
    delta: int
    reason: str = "adjusted"  # dispensed | adjusted | received
    note: str | None = None


class MovementOut(CamelModel):
    id: int
    item_id: int
    delta: int
    reason: str
    ref_prescription_id: int | None
    by_staff_id: int | None
    at: datetime


# --------------------------------------------------------------------------- billing
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
