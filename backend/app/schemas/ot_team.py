"""OT team shapes: the admin list of team roles, the directory of outside doctors / partners, and the
options offered on a case. The team of a case is stored in `OtCase.billing["team"]` as
  [{"roleKey": "anaesthetist", "roleLabel": "Anaesthetist", "name": "Dr. R. Mehta",
    "qualification": "MD Anaesthesia", "regNo": "G-1234", "external": true, "partnerId": 3, "fee": 2500}]
(role label, name, qualification and reg. no. are copies taken when the row was filled, so old
records stay as they were when the lists change). See app.services.ot_team.clean_team.
"""
from datetime import datetime

from pydantic import Field

from app.schemas.common import CamelModel


class OtTeamRoleOut(CamelModel):
    id: int
    key: str
    label: str
    default_fee: int
    sort_order: int
    active: bool


class OtTeamRoleIn(CamelModel):
    label: str = Field(min_length=1, max_length=80)
    default_fee: int = Field(default=0, ge=0)


class OtTeamRolePatch(CamelModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    default_fee: int | None = Field(default=None, ge=0)
    active: bool | None = None


class KeyOrder(CamelModel):
    keys: list[str]


class OtPartnerOut(CamelModel):
    id: int
    name: str
    qualification: str
    reg_no: str
    phone: str
    default_role_key: str | None
    default_fee: int
    note: str
    active: bool
    created_at: datetime | None = None


class OtPartnerIn(CamelModel):
    name: str = Field(min_length=1, max_length=120)
    qualification: str = Field(default="", max_length=120)
    reg_no: str = Field(default="", max_length=60)
    phone: str = Field(default="", max_length=20)
    default_role_key: str | None = Field(default=None, max_length=30)
    default_fee: int = Field(default=0, ge=0)
    note: str = Field(default="", max_length=255)


class OtPartnerPatch(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    qualification: str | None = Field(default=None, max_length=120)
    reg_no: str | None = Field(default=None, max_length=60)
    phone: str | None = Field(default=None, max_length=20)
    default_role_key: str | None = Field(default=None, max_length=30)  # "" clears it
    default_fee: int | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=255)
    active: bool | None = None


class OtStaffOption(CamelModel):
    name: str
    role: str


class OtTeamOptionsOut(CamelModel):
    roles: list[OtTeamRoleOut]  # switched-on roles, in order
    partners: list[OtPartnerOut]  # switched-on outside doctors, by name
    staff: list[OtStaffOption]  # active clinic doctors, OT staff and optometrists, by name
