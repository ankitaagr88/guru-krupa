"""Admin configuration (`renderAdmin`): stages, dilation protocol, referral sources, lens tiers, staff.

Every write appends an AuditLog row. Errors are raised as AdminError subclasses and mapped to
HTTP status codes by the route layer.
"""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.security import hash_password
from app.models.audit import AuditLog
from app.models.config import LensTier, ProtocolStep, ReferralSource, Stage
from app.models.patients import Patient, Visit
from app.models.staff import ROLES, Staff
from app.seed.reference import CONDITIONS

MIN_STAGES = 2  # mockup `deleteStage`: "Keep at least two stages."
MIN_PROTOCOL_STEPS = 1
MIN_REFERRAL_SOURCES = 1


class AdminError(Exception):
    pass


class NotFound(AdminError):
    pass


class Conflict(AdminError):
    pass


class BadValue(AdminError):
    pass


def _audit(db: Session, by: Staff | int | None, action: str, entity: str, entity_id: int | None, **detail) -> None:
    db.add(AuditLog(staff_id=by.id if isinstance(by, Staff) else by, action=action, entity=entity,
                    entity_id=entity_id, detail=detail))


def _ordered(db: Session, model):
    return list(db.scalars(select(model).order_by(model.sort_order, model.id)))


def _next_order(db: Session, model) -> int:
    return (db.scalar(select(func.max(model.sort_order))) or 0) + 1


def _reorder(db: Session, model, ids: list, id_attr: str, by, action: str, entity: str) -> list:
    rows = {getattr(r, id_attr): r for r in db.scalars(select(model))}
    if set(ids) != set(rows) or len(ids) != len(rows):
        raise BadValue(f"order must list every existing {entity} exactly once")
    for i, key in enumerate(ids):
        rows[key].sort_order = i
    _audit(db, by, action, entity, None, order=[str(k) for k in ids])
    db.commit()
    return _ordered(db, model)


def _get_or_404(db: Session, model, ident, what: str):
    row = db.get(model, ident)
    if row is None:
        raise NotFound(f"{what} not found")
    return row


def _apply(row, values: dict) -> dict:
    changed = {}
    for k, v in values.items():
        if v is not None and getattr(row, k) != v:
            setattr(row, k, v)
            changed[k] = v
    return changed


# --------------------------------------------------------------------------- stages
def stages(db: Session) -> list[Stage]:
    return _ordered(db, Stage)


def get_stage(db: Session, key: str) -> Stage:
    stage = db.scalar(select(Stage).filter_by(key=key))
    if stage is None:
        raise NotFound("Stage not found")
    return stage


def create_stage(db: Session, *, key: str, label: str, cls: str | None, by) -> Stage:
    """`addStage`: new stage goes just before the last one (`done`) like the mockup."""
    if db.scalar(select(Stage).filter_by(key=key)):
        raise Conflict(f"Stage '{key}' already exists")
    existing = stages(db)
    stage = Stage(key=key, label=label, cls=cls or key, sort_order=0)
    order = existing[:-1] + [stage] + existing[-1:] if existing else [stage]
    for i, s in enumerate(order):
        s.sort_order = i
    db.add(stage)
    db.flush()
    _audit(db, by, "stage.create", "stage", stage.id, key=key, label=label)
    db.commit()
    return stage


def update_stage(db: Session, stage: Stage, values: dict, by) -> Stage:
    changed = _apply(stage, values)
    _audit(db, by, "stage.update", "stage", stage.id, key=stage.key, **changed)
    db.commit()
    return stage


def delete_stage(db: Session, stage: Stage, by) -> None:
    if db.scalar(select(func.count()).select_from(Stage)) <= MIN_STAGES:
        raise Conflict(f"Keep at least {MIN_STAGES} stages")
    active = db.scalar(select(func.count()).select_from(Visit)
                       .where(Visit.stage_key == stage.key, Visit.status == "active"))
    if active:
        raise Conflict(f"{active} active visit(s) are on stage '{stage.key}'")
    _audit(db, by, "stage.delete", "stage", stage.id, key=stage.key)
    db.delete(stage)
    db.commit()


def reorder_stages(db: Session, keys: list[str], by) -> list[Stage]:
    return _reorder(db, Stage, keys, "key", by, "stage.reorder", "stage")


# --------------------------------------------------------------------------- protocol steps
def protocol_steps(db: Session) -> list[ProtocolStep]:
    return _ordered(db, ProtocolStep)


def get_step(db: Session, step_id: int) -> ProtocolStep:
    return _get_or_404(db, ProtocolStep, step_id, "Protocol step")


def create_step(db: Session, *, name: str, minutes: int, by) -> ProtocolStep:
    if db.scalar(select(ProtocolStep).filter_by(name=name)):
        raise Conflict(f"Protocol step '{name}' already exists")
    step = ProtocolStep(name=name, minutes=minutes, sort_order=_next_order(db, ProtocolStep))
    db.add(step)
    db.flush()
    _audit(db, by, "protocol_step.create", "protocol_step", step.id, name=name, minutes=minutes)
    db.commit()
    return step


def update_step(db: Session, step: ProtocolStep, values: dict, by) -> ProtocolStep:
    name = values.get("name")
    if name and db.scalar(select(ProtocolStep).where(ProtocolStep.name == name, ProtocolStep.id != step.id)):
        raise Conflict(f"Protocol step '{name}' already exists")
    changed = _apply(step, values)
    _audit(db, by, "protocol_step.update", "protocol_step", step.id, **changed)
    db.commit()
    return step


def delete_step(db: Session, step: ProtocolStep, by) -> None:
    if db.scalar(select(func.count()).select_from(ProtocolStep)) <= MIN_PROTOCOL_STEPS:
        raise Conflict(f"Keep at least {MIN_PROTOCOL_STEPS} protocol step")
    _audit(db, by, "protocol_step.delete", "protocol_step", step.id, name=step.name)
    db.delete(step)
    db.commit()


def reorder_steps(db: Session, ids: list[int], by) -> list[ProtocolStep]:
    return _reorder(db, ProtocolStep, ids, "id", by, "protocol_step.reorder", "protocol_step")


# --------------------------------------------------------------------------- referral sources
def referral_sources(db: Session) -> list[ReferralSource]:
    return _ordered(db, ReferralSource)


def get_referral_source(db: Session, key: str) -> ReferralSource:
    src = db.scalar(select(ReferralSource).filter_by(key=key))
    if src is None:
        raise NotFound("Referral source not found")
    return src


def create_referral_source(db: Session, *, key: str, label: str, needs_detail: bool, by) -> ReferralSource:
    if db.scalar(select(ReferralSource).filter_by(key=key)):
        raise Conflict(f"Referral source '{key}' already exists")
    src = ReferralSource(key=key, label=label, needs_detail=needs_detail, sort_order=_next_order(db, ReferralSource))
    db.add(src)
    db.flush()
    _audit(db, by, "referral_source.create", "referral_source", src.id, key=key, label=label)
    db.commit()
    return src


def update_referral_source(db: Session, src: ReferralSource, values: dict, by) -> ReferralSource:
    changed = _apply(src, values)
    _audit(db, by, "referral_source.update", "referral_source", src.id, key=src.key, **changed)
    db.commit()
    return src


def delete_referral_source(db: Session, src: ReferralSource, by) -> None:
    if db.scalar(select(func.count()).select_from(ReferralSource)) <= MIN_REFERRAL_SOURCES:
        raise Conflict(f"Keep at least {MIN_REFERRAL_SOURCES} referral source")
    used = db.scalar(select(func.count()).select_from(Patient).where(Patient.referral_source_id == src.id))
    if used:
        raise Conflict(f"{used} patient(s) reference referral source '{src.key}'")
    _audit(db, by, "referral_source.delete", "referral_source", src.id, key=src.key)
    db.delete(src)
    db.commit()


# --------------------------------------------------------------------------- lens tiers
def lens_tiers(db: Session) -> list[LensTier]:
    return _ordered(db, LensTier)


def get_lens_tier(db: Session, key: str) -> LensTier:
    tier = db.scalar(select(LensTier).filter_by(key=key))
    if tier is None:
        raise NotFound("Lens tier not found")
    return tier


def create_lens_tier(db: Session, *, key: str, label: str, price: int, by) -> LensTier:
    if db.scalar(select(LensTier).filter_by(key=key)):
        raise Conflict(f"Lens tier '{key}' already exists")
    tier = LensTier(key=key, label=label, price=price, sort_order=_next_order(db, LensTier))
    db.add(tier)
    db.flush()
    _audit(db, by, "lens_tier.create", "lens_tier", tier.id, key=key, label=label, price=price)
    db.commit()
    return tier


def update_lens_tier(db: Session, tier: LensTier, values: dict, by) -> LensTier:
    changed = _apply(tier, values)
    _audit(db, by, "lens_tier.update", "lens_tier", tier.id, key=tier.key, **changed)
    db.commit()
    return tier


def delete_lens_tier(db: Session, tier: LensTier, by) -> None:
    _audit(db, by, "lens_tier.delete", "lens_tier", tier.id, key=tier.key)
    db.delete(tier)
    db.commit()


# --------------------------------------------------------------------------- staff
def staff_list(db: Session) -> list[Staff]:
    return list(db.scalars(select(Staff).order_by(Staff.name, Staff.id)))


def get_staff(db: Session, staff_id: int) -> Staff:
    return _get_or_404(db, Staff, staff_id, "Staff member")


def _check_role(role: str) -> None:
    if role not in ROLES:
        raise BadValue(f"role must be one of {ROLES}")


def create_staff(db: Session, *, name: str, username: str, password: str, role: str, by) -> Staff:
    _check_role(role)
    username = username.strip().lower()
    if db.scalar(select(Staff).where(func.lower(Staff.username) == username)):
        raise Conflict(f"Username '{username}' is already taken")
    user = Staff(name=name.strip(), username=username, password_hash=hash_password(password), role=role)
    db.add(user)
    db.flush()
    _audit(db, by, "staff.create", "staff", user.id, username=username, role=role)
    db.commit()
    return user


def _other_active_admins(db: Session, user: Staff) -> int:
    return db.scalar(select(func.count()).select_from(Staff)
                     .where(Staff.role == "admin", Staff.active.is_(True), Staff.id != user.id))


def update_staff(db: Session, user: Staff, values: dict, by) -> Staff:
    actor_id = by.id if isinstance(by, Staff) else by
    if "role" in values and values["role"] is not None:
        _check_role(values["role"])
    deactivating = values.get("active") is False and user.active
    demoting = values.get("role") not in (None, "admin") and user.role == "admin"
    if (deactivating or demoting) and user.id == actor_id:
        raise Conflict("You cannot deactivate or demote your own account")
    if (deactivating or demoting) and user.role == "admin" and user.active and _other_active_admins(db, user) == 0:
        raise Conflict("Cannot remove the last active admin")
    changed = _apply(user, values)
    _audit(db, by, "staff.update", "staff", user.id, **changed)
    db.commit()
    return user


def reset_password(db: Session, user: Staff, password: str, by) -> Staff:
    user.password_hash = hash_password(password)
    _audit(db, by, "staff.reset_password", "staff", user.id)
    db.commit()
    return user


# --------------------------------------------------------------------------- /config
def config(db: Session) -> dict:
    return {"stages": stages(db), "protocol_steps": protocol_steps(db), "referral_sources": referral_sources(db),
            "lens_tiers": lens_tiers(db), "conditions": list(CONDITIONS)}
