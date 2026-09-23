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
    price: int | None = None  # whole rupees per pack; None = not priced yet


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
    diagnosis_id: int | None = None  # what this prescription treats (feeds the treatment standards)


class PrescriptionLineOut(CamelModel):
    id: int
    medicine_id: int | None
    name: str
    matched: bool
    dosage: str
    qty_given: int  # the doctor's "to give from clinic"
    dispensed_qty: int = 0  # confirmed bought here by the front desk (this is what moved stock)
    dispensed_at: datetime | None = None
    dispensed_by: str | None = None
    in_stock: int | None = None  # current clinic stock of this medicine, None when not stocked
    price: int | None = None  # the matched medicine's price per pack (what "Bought here" bills)
    form: str | None = None  # from the matched medicine; None for free-text lines
    form_label: str | None = None


class PrescriptionOut(CamelModel):
    id: int
    visit_id: int
    print_language: str
    created_at: datetime
    diagnosis_id: int | None = None
    diagnosis_name: str | None = None
    lines: list[PrescriptionLineOut]
    low_stock: list[str] = []  # item names now at/below reorder level (`pushLowStockToast`)


class DispenseIn(CamelModel):
    """`POST /visits/{id}/prescription/lines/{line_id}/dispense`: the patient bought `qty` here."""

    qty: int = Field(ge=1)


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
    ordered_at: datetime | None = None  # "order placed" — alerts stay quiet until stock is received
    ordered_qty: int | None = None  # still to arrive
    on_order: bool = False
    last_received_at: datetime | None = None  # last "received" movement
    auto_deducted: bool = False  # used by the dilation protocol, comes off the stock automatically


class OrderPlacedIn(CamelModel):
    qty: int = Field(ge=1)


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
