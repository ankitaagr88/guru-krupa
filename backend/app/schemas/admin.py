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


class StaffPatch(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    role: str | None = None
    active: bool | None = None


class PasswordIn(CamelModel):
    password: str = Field(min_length=4)


# --------------------------------------------------------------------------- /config
class ConfigOut(CamelModel):
    stages: list[StageOut]
    protocol_steps: list[ProtocolStepOut]
    referral_sources: list[ReferralSourceOut]
    lens_tiers: list[LensTierOut]
    conditions: list[str]
