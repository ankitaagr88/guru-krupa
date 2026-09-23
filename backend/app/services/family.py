"""Families on one mobile number (lane E1).

Every family member is a full patient of their own (name, age, visits...). One of them owns the
number (e.g. the parent); every other member points at that owner with their relation to them
(`Patient.family_owner_id` + `relation_key`). Rules kept here:
  - an owner never has an owner itself: linking to a member links to that member's owner;
  - a family never loops (a patient is never linked to themselves or to their own member);
  - a member takes the owner's phone, and when the owner's phone changes the members' follows.
The relations list (Son, Daughter, Spouse...) is admin-configurable (`Relation`).
Errors are the admin service's NotFound / Conflict / BadValue, mapped to 404 / 409 / 422 by routes.
"""
import re
from collections import defaultdict

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, object_session

from app.models.audit import AuditLog
from app.models.config import Relation
from app.models.patients import Patient
from app.models.staff import Staff
from app.schemas.family import FamilyMemberOut, FamilyOut, GroupingOut, GroupSample
from app.services.admin import BadValue, Conflict, NotFound
from app.services.patients import last_visit_dates, patients_by_phone, phone_key

_LABELS = "family_relation_labels"  # per-session cache in Session.info


def _audit(db: Session, by, action: str, entity_id: int | None, entity: str = "patient", **detail) -> None:
    db.add(AuditLog(staff_id=by.id if isinstance(by, Staff) else by, action=action, entity=entity,
                    entity_id=entity_id, detail=detail))


# --------------------------------------------------------------------------- relations list
def relations(db: Session, include_inactive: bool = False) -> list[Relation]:
    stmt = select(Relation).order_by(Relation.sort_order, Relation.id)
    if not include_inactive:
        stmt = stmt.where(Relation.active.is_(True))
    return list(db.scalars(stmt))


def relation_counts(db: Session) -> dict[str, int]:
    rows = db.execute(select(Patient.relation_key, func.count()).where(Patient.relation_key.is_not(None))
                      .group_by(Patient.relation_key))
    return {k: n for k, n in rows}


def relation_labels(db: Session) -> dict[str, str]:
    labels = db.info.get(_LABELS)
    if labels is None:
        labels = {r.key: r.label for r in db.scalars(select(Relation))}
        db.info[_LABELS] = labels
    return labels


def _forget_labels(db: Session) -> None:
    db.info.pop(_LABELS, None)


def get_relation(db: Session, key: str) -> Relation:
    rel = db.scalar(select(Relation).filter_by(key=key))
    if rel is None:
        raise NotFound("Relation not found")
    return rel


def check_relation(db: Session, key: str | None) -> str | None:
    """None / "" = "not set". Otherwise the key of an existing, switched-on relation (else BadValue)."""
    if not key:
        return None
    if db.scalar(select(Relation).where(Relation.key == key, Relation.active.is_(True))) is None:
        raise BadValue(f"Unknown relation '{key}'")
    return key


def _key_from_label(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:30] or "relation"


def create_relation(db: Session, *, label: str, key: str | None, by) -> Relation:
    label = label.strip()
    if not label:
        raise BadValue("A relation needs a name")
    if db.scalar(select(Relation).where(func.lower(Relation.label) == label.lower())):
        raise Conflict(f"'{label}' is already on the list")
    if key is None:
        base = key = _key_from_label(label)
        n = 2
        while db.scalar(select(Relation).filter_by(key=key)):
            key = f"{base[:27]}_{n}"
            n += 1
    elif db.scalar(select(Relation).filter_by(key=key)):
        raise Conflict(f"Relation '{key}' already exists")
    rel = Relation(key=key, label=label, active=True,
                   sort_order=(db.scalar(select(func.max(Relation.sort_order))) or 0) + 1)
    db.add(rel)
    db.flush()
    _audit(db, by, "relation.create", rel.id, entity="relation", key=key, label=label)
    db.commit()
    _forget_labels(db)
    return rel


def update_relation(db: Session, rel: Relation, values: dict, by) -> Relation:
    changed = {}
    if values.get("label") is not None:
        label = values["label"].strip()
        if not label:
            raise BadValue("A relation needs a name")
        clash = db.scalar(select(Relation).where(func.lower(Relation.label) == label.lower(), Relation.id != rel.id))
        if clash is not None:
            raise Conflict(f"'{label}' is already on the list")
        if label != rel.label:
            rel.label = changed["label"] = label
    if values.get("active") is not None and values["active"] != rel.active:
        rel.active = changed["active"] = values["active"]
    _audit(db, by, "relation.update", rel.id, entity="relation", key=rel.key, **changed)
    db.commit()
    _forget_labels(db)
    return rel


def delete_relation(db: Session, rel: Relation, by) -> None:
    used = relation_counts(db).get(rel.key, 0)
    if used:
        raise Conflict(f"{used} patient(s) have the relation '{rel.label}': switch it off instead")
    _audit(db, by, "relation.delete", rel.id, entity="relation", key=rel.key)
    db.delete(rel)
    db.commit()
    _forget_labels(db)


def reorder_relations(db: Session, keys: list[str], by) -> list[Relation]:
    rows = {r.key: r for r in db.scalars(select(Relation))}
    if set(keys) != set(rows) or len(keys) != len(rows):
        raise BadValue("order must list every existing relation exactly once")
    for i, key in enumerate(keys):
        rows[key].sort_order = i
    _audit(db, by, "relation.reorder", None, entity="relation", order=keys)
    db.commit()
    return relations(db, include_inactive=True)


# --------------------------------------------------------------------------- family facts on PatientOut
def family_bits(db: Session | None, patients: list[Patient]) -> dict[int, dict]:
    """patient id -> {family_owner_id, relation_key, relation_label, family_owner_name, family_size}
    for PatientOut. Three small queries for the whole list."""
    if not patients:
        return {}
    if db is None:
        db = object_session(patients[0])
    oid_of = {p.id: p.family_owner_id or p.id for p in patients}
    sizes: dict[int, int] = {}
    names: dict[int, str] = {}
    if db is not None:
        oids = set(oid_of.values())
        sizes = {oid: n for oid, n in db.execute(
            select(Patient.family_owner_id, func.count()).where(Patient.family_owner_id.in_(oids))
            .group_by(Patient.family_owner_id))}
        member_owner_ids = {p.family_owner_id for p in patients if p.family_owner_id}
        if member_owner_ids:
            names = {i: n for i, n in db.execute(select(Patient.id, Patient.name).where(Patient.id.in_(member_owner_ids)))}
    labels = relation_labels(db) if db is not None else {}
    out = {}
    for p in patients:
        key = p.relation_key if p.family_owner_id else None
        out[p.id] = {
            "family_owner_id": p.family_owner_id,
            "relation_key": key,
            "relation_label": labels.get(key, key) if key else None,
            "family_owner_name": names.get(p.family_owner_id) if p.family_owner_id else None,
            "family_size": 1 + sizes.get(oid_of[p.id], 0),
        }
    return out


# --------------------------------------------------------------------------- the family card
def owner_of(patient: Patient) -> Patient:
    return patient.family_owner if patient.family_owner_id else patient


def members_of(db: Session, owner: Patient) -> list[Patient]:
    return list(db.scalars(select(Patient).where(Patient.family_owner_id == owner.id)
                           .order_by(Patient.created_at, Patient.id)))


def _member_out(p: Patient, labels: dict, last: dict, bits: dict | None = None, is_owner: bool = False) -> FamilyMemberOut:
    key = None if is_owner else p.relation_key
    extra = {}
    if bits is not None:
        extra = {"family_owner_id": bits["family_owner_id"], "family_owner_name": bits["family_owner_name"],
                 "family_size": bits["family_size"]}
    return FamilyMemberOut(id=p.id, name=p.name, age=p.age, sex=p.sex, phone=p.phone, is_owner=is_owner,
                           relation_key=key, relation_label=labels.get(key, key) if key else None,
                           last_visit_date=last.get(p.id), **extra)


def family_out(db: Session, patient: Patient, message: str = "") -> FamilyOut:
    owner = owner_of(patient)
    members = members_of(db, owner)
    people = [owner, *members] if members else []
    in_family = {p.id for p in people} | {patient.id}
    others = [p for p in patients_by_phone(db, patient.phone or "", limit=50) if p.id not in in_family]
    last = last_visit_dates(db, [p.id for p in people + others])
    labels = relation_labels(db)
    bits = family_bits(db, others)
    return FamilyOut(
        patient_id=patient.id, owner_id=owner.id if members else None, phone=owner.phone if members else patient.phone,
        members=[_member_out(p, labels, last, is_owner=p.id == owner.id) for p in people],
        same_phone=[_member_out(p, labels, last, bits[p.id], is_owner=False) for p in others],
        message=message)


def _set_phone(member: Patient, owner: Patient) -> str:
    """The member takes the owner's number; returns a sentence when that changed a number on file."""
    if not owner.phone or member.phone == owner.phone:
        return ""
    old = member.phone
    member.phone = owner.phone  # same number written the same way
    if old and phone_key(old) != phone_key(owner.phone):
        return f"{member.name}'s phone changed from {old} to {owner.phone}."
    return ""


def link(db: Session, patient: Patient, owner_id: int, relation_key: str | None, by=None,
         commit: bool = True) -> str:
    """Put `patient` in the family of `owner_id` (or of that person's owner). Returns a sentence about
    anything else that changed. When `patient` owned a family, those members move along with them
    (their relation is cleared: it was to `patient`, not to the new owner)."""
    target = db.get(Patient, owner_id)
    if target is None:
        raise NotFound("That patient was not found")
    target = owner_of(target)
    if target.id == patient.id:
        raise Conflict(f"{patient.name} is already the owner of this family: use \"Make owner of this number\" "
                       "on another member instead")
    key = check_relation(db, relation_key)
    notes = []
    moved = members_of(db, patient)
    for m in moved:
        m.family_owner_id, m.relation_key = target.id, None
        note = _set_phone(m, target)
        if note:
            notes.append(note)
    if moved:
        notes.append(f"{len(moved)} member(s) of {patient.name}'s family moved to {target.name}'s family; "
                     "set their relation.")
    patient.family_owner_id, patient.relation_key = target.id, key
    note = _set_phone(patient, target)
    if note:
        notes.insert(0, note)
    _audit(db, by, "family.link", patient.id, owner_id=target.id, relation=key, moved=[m.id for m in moved])
    if commit:
        db.commit()
    return " ".join(notes)


def set_relation(db: Session, patient: Patient, relation_key: str | None, by=None) -> None:
    if not patient.family_owner_id:
        raise Conflict(f"{patient.name} is not a family member (the owner has no relation)")
    patient.relation_key = check_relation(db, relation_key)
    _audit(db, by, "family.relation", patient.id, relation=patient.relation_key)
    db.commit()


def make_owner(db: Session, patient: Patient, old_owner_relation_key: str | None, by=None) -> str:
    """`patient` (a member) becomes the owner; everyone else re-points to them and the old owner
    becomes a member with the relation given (None = not set)."""
    if not patient.family_owner_id:
        raise Conflict(f"{patient.name} already owns this number (or is not in a family)")
    key = check_relation(db, old_owner_relation_key)
    old = patient.family_owner
    others = [m for m in members_of(db, old) if m.id != patient.id]
    for m in others:
        m.family_owner_id = patient.id
    patient.family_owner_id, patient.relation_key = None, None
    db.flush()
    old.family_owner_id, old.relation_key = patient.id, key
    _audit(db, by, "family.make_owner", patient.id, old_owner_id=old.id, old_owner_relation=key)
    db.commit()
    if others:
        return (f"{patient.name} now owns this number. The others' relations were set against {old.name}: "
                "check they still read right.")
    return f"{patient.name} now owns this number."


def remove(db: Session, patient: Patient, by=None) -> str:
    if patient.family_owner_id:
        patient.family_owner_id, patient.relation_key = None, None
        _audit(db, by, "family.remove", patient.id)
        db.commit()
        return f"{patient.name} is no longer in this family."
    members = members_of(db, patient)
    if not members:
        raise Conflict(f"{patient.name} is not in a family")
    if len(members) > 1:
        raise Conflict(f"{patient.name} owns this number: make another member the owner first, "
                       f"then remove {patient.name}")
    members[0].family_owner_id, members[0].relation_key = None, None
    _audit(db, by, "family.remove", patient.id, dissolved_with=members[0].id)
    db.commit()
    return f"The family is undone: {patient.name} and {members[0].name} are separate again."


def phone_followed(db: Session, owner: Patient) -> int:
    """After the owner's phone changed: members take the new number. Returns how many changed."""
    n = 0
    for m in members_of(db, owner):
        if m.phone != owner.phone:
            m.phone = owner.phone
            n += 1
    return n


# --------------------------------------------------------------------------- group by shared number
def _grouping_plan(db: Session) -> list[tuple[str, int, str, list[tuple[int, str]], bool]]:
    """[(phone, owner_id, owner_name, [(member_id, name)...], new_family)] for every shared number
    where patients not yet in any family can join one. The owner is the family already on that
    number (the earliest registered owner), else the earliest registered patient."""
    rows = db.execute(select(Patient.id, Patient.name, Patient.phone, Patient.created_at, Patient.family_owner_id)
                      .where(Patient.phone.is_not(None)).order_by(Patient.created_at, Patient.id)).all()
    owners = set(db.scalars(select(Patient.family_owner_id).where(Patient.family_owner_id.is_not(None)).distinct()))
    groups: dict[str, list] = defaultdict(list)
    for r in rows:
        key = phone_key(r.phone)
        if len(key) == 10:
            groups[key].append(r)
    plan = []
    for rs in groups.values():
        if len(rs) < 2:
            continue
        existing = [r for r in rs if r.id in owners]
        free = [r for r in rs if r.family_owner_id is None and r.id not in owners]
        if existing:
            owner, to_link = existing[0], free
        elif len(free) >= 2:
            owner, to_link = free[0], free[1:]
        else:
            continue
        if to_link:
            plan.append((owner.phone, owner.id, owner.name, [(r.id, r.name) for r in to_link], not existing))
    return plan


def group_shared_numbers(db: Session, write: bool, by=None) -> GroupingOut:
    """Preview (write=False) or do: link patients who share a number to that number's owner with the
    relation "not set", so staff fill the relations in later. Running it twice links nobody new."""
    plan = _grouping_plan(db)
    out = GroupingOut(numbers=len(plan), new_families=sum(1 for p in plan if p[4]),
                      members_linked=sum(len(p[3]) for p in plan), written=write,
                      sample=[GroupSample(phone=ph, owner_id=oid, owner_name=on, member_names=[n for _, n in ms])
                              for ph, oid, on, ms, _ in plan[:20]])
    if write and plan:
        for _, oid, _, ms, _ in plan:
            db.execute(update(Patient).where(Patient.id.in_([i for i, _ in ms]), Patient.family_owner_id.is_(None))
                       .values(family_owner_id=oid, relation_key=None))
        _audit(db, by, "family.group_shared_numbers", None, numbers=out.numbers, members_linked=out.members_linked)
        db.commit()
    return out
