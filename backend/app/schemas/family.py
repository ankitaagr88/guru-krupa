"""Families on one mobile number: the family card, the link / relation / owner changes, the admin
relations list and "group patients who share a number"."""
from datetime import date

from pydantic import Field

from app.schemas.common import CamelModel


# --------------------------------------------------------------------------- relations (admin list)
class RelationOut(CamelModel):
    id: int
    key: str
    label: str
    sort_order: int
    active: bool
    patient_count: int = 0  # members with this relation (the admin table shows it; delete needs 0)


class RelationIn(CamelModel):
    label: str = Field(min_length=1, max_length=60)
    # Optional: worked out from the label ("Son-in-law" -> "son_in_law") when left out.
    key: str | None = Field(default=None, min_length=1, max_length=30, pattern=r"^[a-z0-9_\-]+$")


class RelationPatch(CamelModel):
    label: str | None = Field(default=None, min_length=1, max_length=60)
    active: bool | None = None


class RelationOrder(CamelModel):
    keys: list[str]


# --------------------------------------------------------------------------- the family card
class FamilyMemberOut(CamelModel):
    id: int
    name: str
    age: int | None
    sex: str | None
    phone: str | None
    is_owner: bool = False
    relation_key: str | None = None  # relation to the owner; None for the owner, or "not set"
    relation_label: str | None = None
    last_visit_date: date | None = None
    # Only on `samePhone` rows: the family this person already belongs to (another one on the number).
    family_owner_id: int | None = None
    family_owner_name: str | None = None
    family_size: int = 1


class FamilyOut(CamelModel):
    """A patient's family: the owner first, then the members (earliest registered first). A patient
    in no family gets `ownerId: null` and no members. `samePhone` = others on this number who are
    not in this family (for "Part of the ... family?")."""

    patient_id: int
    owner_id: int | None
    phone: str | None
    members: list[FamilyMemberOut]
    same_phone: list[FamilyMemberOut] = []
    message: str = ""  # what else changed (phone followed the owner, relations to check...)


class FamilyLinkIn(CamelModel):
    owner_id: int
    relation_key: str | None = None  # None / "" = not set yet


class FamilyRelationIn(CamelModel):
    relation_key: str | None = None


class MakeOwnerIn(CamelModel):
    # The old owner becomes a member: their relation to the new owner (None = not set).
    old_owner_relation_key: str | None = None


# --------------------------------------------------------------------------- group by shared number
class GroupSample(CamelModel):
    phone: str
    owner_id: int
    owner_name: str
    member_names: list[str]


class GroupingOut(CamelModel):
    """Preview (nothing written) or result of "Group patients who share a number"."""

    numbers: int  # shared numbers that would gain (or gained) links
    new_families: int  # of those, numbers where no family existed yet
    members_linked: int  # patients linked to an owner, relation "not set"
    written: bool
    sample: list[GroupSample] = []
