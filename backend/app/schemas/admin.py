from pydantic import Field

from app.schemas.common import CamelModel


# --------------------------------------------------------------------------- stages
class StageIn(CamelModel):
    key: str = Field(min_length=1, max_length=30, pattern=r"^[a-z0-9_\-]+$")
    label: str = Field(min_length=1, max_length=80)
    cls: str | None = Field(default=None, max_length=30)  # defaults to key


class StagePatch(CamelModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    cls: str | None = Field(default=None, max_length=30)


class StageOut(CamelModel):
    id: int
    key: str
    label: str
    cls: str
    sort_order: int


class StageOrder(CamelModel):
    keys: list[str]


# --------------------------------------------------------------------------- protocol steps
class ProtocolStepIn(CamelModel):
    name: str = Field(min_length=1, max_length=120)
    minutes: int = Field(gt=0)


class ProtocolStepPatch(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    minutes: int | None = Field(default=None, gt=0)


class ProtocolStepOut(CamelModel):
    id: int
    name: str
    minutes: int
    sort_order: int


class IdOrder(CamelModel):
    ids: list[int]


# --------------------------------------------------------------------------- referral sources
class ReferralSourceIn(CamelModel):
    key: str = Field(min_length=1, max_length=30, pattern=r"^[a-z0-9_\-]+$")
    label: str = Field(min_length=1, max_length=120)
    needs_detail: bool = False


class ReferralSourcePatch(CamelModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    needs_detail: bool | None = None


class ReferralSourceOut(CamelModel):
    id: int
    key: str
    label: str
    needs_detail: bool
    sort_order: int


# --------------------------------------------------------------------------- lens tiers
class LensTierIn(CamelModel):
    key: str = Field(min_length=1, max_length=30, pattern=r"^[a-z0-9_\-]+$")
    label: str = Field(min_length=1, max_length=120)
    price: int = Field(ge=0)


class LensTierPatch(CamelModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    price: int | None = Field(default=None, ge=0)


class LensTierOut(CamelModel):
    id: int
    key: str
    label: str
    price: int
    sort_order: int


# --------------------------------------------------------------------------- staff
class StaffIn(CamelModel):
    name: str = Field(min_length=1, max_length=120)
    username: str = Field(min_length=1, max_length=60)
    password: str = Field(min_length=4)
    role: str
    phone: str = Field(min_length=10, max_length=20)  # mobile number, required for identification


class StaffPatch(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    role: str | None = None
    active: bool | None = None
    phone: str | None = Field(default=None, min_length=10, max_length=20)


class PasswordIn(CamelModel):
    password: str = Field(min_length=4)


# --------------------------------------------------------------------------- medicine forms
class MedicineFormIn(CamelModel):
    key: str = Field(min_length=1, max_length=40, pattern=r"^[a-z0-9_\-]+$")
    label: str = Field(min_length=1, max_length=60)


class MedicineFormPatch(CamelModel):
    label: str | None = Field(default=None, min_length=1, max_length=60)
    active: bool | None = None


class MedicineFormOut(CamelModel):
    id: int
    key: str
    label: str
    sort_order: int
    active: bool


class MedicineFormBrief(CamelModel):
    key: str
    label: str


# --------------------------------------------------------------------------- medicines
class MedicineIn(CamelModel):
    """A pack as an MR brings it: brand + generic composition (+ form / strength / pack / maker).

    `name` (the unique display name) defaults to the brand, else the composition.
    """

    name: str | None = Field(default=None, min_length=1, max_length=160)
    brand: str | None = Field(default=None, min_length=1, max_length=120)
    composition: str = Field(min_length=1)
    form: str = "drops"  # an active MedicineForm key (GET /config -> medicineForms)
    strength: str | None = Field(default=None, max_length=40)
    pack_size: str | None = Field(default=None, max_length=30)
    manufacturer: str | None = Field(default=None, max_length=120)
    price: int | None = Field(default=None, ge=0)  # whole rupees per pack; "Bought here" bills it


class MedicinePatch(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    brand: str | None = Field(default=None, max_length=120)  # "" clears the brand
    composition: str | None = Field(default=None, min_length=1)
    form: str | None = None
    strength: str | None = Field(default=None, max_length=40)
    pack_size: str | None = Field(default=None, max_length=30)
    manufacturer: str | None = Field(default=None, max_length=120)
    active: bool | None = None
    price: int | None = Field(default=None, ge=0)  # null clears it (not priced)


# --------------------------------------------------------------------------- /config
class OtSlotIn(CamelModel):
    label: str = Field(min_length=1, max_length=20)  # "9:00 AM" — must parse as a time


class OtSlotPatch(CamelModel):
    label: str | None = Field(default=None, min_length=1, max_length=20)
    active: bool | None = None


class OtSlotOutAdmin(CamelModel):
    id: int
    label: str
    active: bool
    sort_order: int


class OtSlotsGenerateIn(CamelModel):
    """Replace the slot list with a regular grid: start/end "HH:MM" 24h, every N minutes."""

    start: str = Field(pattern=r"^\d{1,2}:\d{2}$")
    end: str = Field(pattern=r"^\d{1,2}:\d{2}$")
    every_min: int = Field(ge=5, le=240)


class OtProcedureIn(CamelModel):
    name: str = Field(min_length=1, max_length=160)


class OtProcedurePatch(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    active: bool | None = None


class OtProcedureOut(CamelModel):
    id: int
    name: str
    active: bool
    sort_order: int


class ConfigOut(CamelModel):
    stages: list[StageOut]
    protocol_steps: list[ProtocolStepOut]
    referral_sources: list[ReferralSourceOut]
    lens_tiers: list[LensTierOut]
    conditions: list[str]
    medicine_forms: list[MedicineFormBrief]  # active types for the medicine picker / admin form
    ot_procedures: list[str] = []  # active procedure names for the Schedule-surgery form
    ot_slots: list[str] = []  # active OT time slots in time order
