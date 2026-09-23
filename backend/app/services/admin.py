"""Admin configuration (`renderAdmin`): stages, dilation protocol, referral sources, lens tiers, staff,
medicine types and the medicine master list.

Every write appends an AuditLog row. Errors are raised as AdminError subclasses and mapped to
HTTP status codes by the route layer.
"""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.security import hash_password
from app.models.audit import AuditLog
from app.models.config import LensTier, ProtocolStep, ReferralSource, Stage
from app.models.ot import OtCase, OtProcedure, OtSlot
from app.models.patients import Patient, Visit
from app.models.pharmacy import Medicine, MedicineForm
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


def normalise_phone(value: str | None) -> str | None:
    """Indian mobile: keep the last 10 digits (drops +91 / 0 / spaces); BadValue if not 10 digits."""
    if value is None:
        return None
    import re

    digits = re.sub(r"\D", "", value)
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) != 10:
        raise BadValue("Mobile number must be 10 digits")
    return digits


def _phone_taken(db: Session, phone: str, except_id: int | None = None) -> bool:
    q = select(Staff).where(Staff.phone == phone)
    if except_id is not None:
        q = q.where(Staff.id != except_id)
    return db.scalar(q) is not None


def create_staff(db: Session, *, name: str, username: str, password: str, role: str, by,
                 phone: str | None = None) -> Staff:
    _check_role(role)
    username = username.strip().lower()
    if db.scalar(select(Staff).where(func.lower(Staff.username) == username)):
        raise Conflict(f"Username '{username}' is already taken")
    phone = normalise_phone(phone)
    if phone and _phone_taken(db, phone):
        raise Conflict(f"Mobile number {phone} already belongs to another staff login")
    user = Staff(name=name.strip(), username=username, password_hash=hash_password(password), role=role,
                 phone=phone)
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
    if values.get("phone") is not None:
        values["phone"] = normalise_phone(values["phone"])
        if _phone_taken(db, values["phone"], user.id):
            raise Conflict(f"Mobile number {values['phone']} already belongs to another staff login")
    changed = _apply(user, values)
    _audit(db, by, "staff.update", "staff", user.id, **changed)
    db.commit()
    return user


def reset_password(db: Session, user: Staff, password: str, by) -> Staff:
    user.password_hash = hash_password(password)
    _audit(db, by, "staff.reset_password", "staff", user.id)
    db.commit()
    return user


# --------------------------------------------------------------------------- medicine forms
def medicine_forms(db: Session, active_only: bool = False) -> list[MedicineForm]:
    stmt = select(MedicineForm).order_by(MedicineForm.sort_order, MedicineForm.id)
    if active_only:
        stmt = stmt.where(MedicineForm.active.is_(True))
    return list(db.scalars(stmt))


def get_medicine_form(db: Session, key: str) -> MedicineForm:
    form = db.scalar(select(MedicineForm).filter_by(key=key))
    if form is None:
        raise NotFound("Medicine form not found")
    return form


def check_medicine_form(db: Session, key: str) -> MedicineForm:
    """`Medicine.form` must be an existing *active* type key (no FK: types are plain admin config)."""
    form = db.scalar(select(MedicineForm).where(MedicineForm.key == key, MedicineForm.active.is_(True)))
    if form is None:
        keys = [f.key for f in medicine_forms(db, active_only=True)]
        raise BadValue(f"form must be one of {keys}")
    return form


def create_medicine_form(db: Session, *, key: str, label: str, by) -> MedicineForm:
    if db.scalar(select(MedicineForm).filter_by(key=key)):
        raise Conflict(f"Medicine form '{key}' already exists")
    form = MedicineForm(key=key, label=label.strip(), sort_order=_next_order(db, MedicineForm), active=True)
    db.add(form)
    db.flush()
    _audit(db, by, "medicine_form.create", "medicine_form", form.id, key=key, label=form.label)
    db.commit()
    return form


def update_medicine_form(db: Session, form: MedicineForm, values: dict, by) -> MedicineForm:
    changed = _apply(form, values)
    _audit(db, by, "medicine_form.update", "medicine_form", form.id, key=form.key, **changed)
    db.commit()
    return form


def delete_medicine_form(db: Session, form: MedicineForm, by) -> None:
    used = db.scalar(select(func.count()).select_from(Medicine).where(Medicine.form == form.key))
    if used:
        raise Conflict(f"{used} medicine(s) use form '{form.key}'")
    _audit(db, by, "medicine_form.delete", "medicine_form", form.id, key=form.key)
    db.delete(form)
    db.commit()


def reorder_medicine_forms(db: Session, keys: list[str], by) -> list[MedicineForm]:
    return _reorder(db, MedicineForm, keys, "key", by, "medicine_form.reorder", "medicine_form")


# --------------------------------------------------------------------------- medicines
def medicines(db: Session, include_inactive: bool = False) -> list[Medicine]:
    stmt = select(Medicine).order_by(Medicine.name, Medicine.id)
    if not include_inactive:
        stmt = stmt.where(Medicine.active.is_(True))
    return list(db.scalars(stmt))


def get_medicine(db: Session, medicine_id: int) -> Medicine:
    return _get_or_404(db, Medicine, medicine_id, "Medicine")


def _medicine_name_taken(db: Session, name: str, exclude_id: int | None = None) -> bool:
    stmt = select(Medicine).where(func.lower(Medicine.name) == name.lower())
    if exclude_id is not None:
        stmt = stmt.where(Medicine.id != exclude_id)
    return db.scalar(stmt) is not None


def create_medicine(db: Session, *, name: str | None, brand: str | None, composition: str, form: str,
                    strength: str | None, pack_size: str | None, manufacturer: str | None, by,
                    price: int | None = None) -> Medicine:
    """A pack as an MR brings it. `name` (unique display name) defaults to brand, else composition."""
    brand = (brand or "").strip() or None
    composition = composition.strip()
    name = (name or "").strip() or brand or composition
    check_medicine_form(db, form)
    if _medicine_name_taken(db, name):
        raise Conflict(f"Medicine '{name}' already exists")
    med = Medicine(name=name, brand=brand, composition=composition, form=form,
                   strength=(strength or "").strip() or None, pack_size=(pack_size or "").strip() or None,
                   manufacturer=(manufacturer or "").strip() or None, price=price, active=True)
    db.add(med)
    db.flush()
    _audit(db, by, "medicine.create", "medicine", med.id, name=name, brand=brand, composition=composition, form=form)
    db.commit()
    return med


def update_medicine(db: Session, med: Medicine, values: dict, by) -> Medicine:
    values = dict(values)
    changed = {}
    if "price" in values:  # null is meaningful here: it clears the price
        price = values.pop("price")
        if price != med.price:
            med.price = changed["price"] = price
    for k in ("name", "brand", "composition", "strength", "pack_size", "manufacturer"):
        if isinstance(values.get(k), str):
            values[k] = values[k].strip()
    if "form" in values and values["form"] is not None:
        check_medicine_form(db, values["form"])
    if values.get("name") and _medicine_name_taken(db, values["name"], exclude_id=med.id):
        raise Conflict(f"Medicine '{values['name']}' already exists")
    if values.get("name") == "":
        del values["name"]
    if values.get("composition") == "":
        del values["composition"]
    for k, v in values.items():
        if v is None:
            continue
        if k in ("brand", "strength", "pack_size", "manufacturer") and v == "":
            v = None  # "" clears an optional field (None in the payload means "leave unchanged")
        if getattr(med, k) != v:
            setattr(med, k, v)
            changed[k] = v
    _audit(db, by, "medicine.update", "medicine", med.id, name=med.name, **changed)
    db.commit()
    return med


def delete_medicine(db: Session, med: Medicine, by) -> None:
    """Soft delete: prescription lines keep pointing at the row; it just leaves the picker."""
    med.active = False
    _audit(db, by, "medicine.delete", "medicine", med.id, name=med.name)
    db.commit()


# --------------------------------------------------------------------------- /config
def config(db: Session) -> dict:
    return {"stages": stages(db), "protocol_steps": protocol_steps(db), "referral_sources": referral_sources(db),
            "lens_tiers": lens_tiers(db), "conditions": list(CONDITIONS),
            "medicine_forms": medicine_forms(db, active_only=True),
            "ot_procedures": [p.name for p in ot_procedures(db) if p.active],
            "ot_slots": ot_slot_labels(db)}


# --------------------------------------------------------------------------- OT slots
def _parse_slot(label: str) -> str:
    """Normalise "9:00 am" / "09:00 AM" / "14:15" to the app's "H:MM AM" form; BadValue otherwise."""
    from datetime import datetime as _dt

    text = " ".join((label or "").split()).upper()
    for fmt in ("%I:%M %p", "%I:%M%p", "%H:%M"):
        try:
            return _dt.strptime(text, fmt).strftime("%I:%M %p").lstrip("0")
        except ValueError:
            continue
    raise BadValue(f"'{label}' is not a time — use e.g. 9:00 AM or 14:15")


def ot_slots(db: Session) -> list[OtSlot]:
    from app.services.ot import slot_sort_key

    return sorted(db.scalars(select(OtSlot)), key=lambda r: (slot_sort_key(r.label), r.id))


def ot_slot_labels(db: Session) -> list[str]:
    from app.services.ot import configured_slots

    return configured_slots(db)


def get_ot_slot(db: Session, slot_id: int) -> OtSlot:
    return _get_or_404(db, OtSlot, slot_id, "OT slot")


def _slot_in_use(db: Session, label: str) -> int:
    from app.services.ot import ACTIVE_STATUSES
    from app.services.queue import today

    return db.scalar(select(func.count()).select_from(OtCase).where(
        OtCase.time_slot == label, OtCase.date >= today(), OtCase.status.in_(ACTIVE_STATUSES))) or 0


def create_ot_slot(db: Session, label: str, by) -> OtSlot:
    label = _parse_slot(label)
    if db.scalar(select(OtSlot).filter_by(label=label)):
        raise Conflict(f"Slot {label} already exists")
    row = OtSlot(label=label, active=True, sort_order=_next_order(db, OtSlot))
    db.add(row)
    db.flush()
    _audit(db, by, "ot_slot.create", "ot_slot", row.id, label=label)
    db.commit()
    return row


def update_ot_slot(db: Session, row: OtSlot, values: dict, by) -> OtSlot:
    changed = {}
    if values.get("label") is not None:
        label = _parse_slot(values["label"])
        if label != row.label:
            if db.scalar(select(OtSlot).filter_by(label=label)):
                raise Conflict(f"Slot {label} already exists")
            if _slot_in_use(db, row.label):
                raise Conflict(f"Upcoming surgeries are booked at {row.label} — add a new slot instead of renaming")
            row.label = changed["label"] = label
    if values.get("active") is not None and values["active"] != row.active:
        row.active = changed["active"] = values["active"]
    if changed:
        _audit(db, by, "ot_slot.update", "ot_slot", row.id, **changed)
        db.commit()
    return row


def delete_ot_slot(db: Session, row: OtSlot, by) -> None:
    n = _slot_in_use(db, row.label)
    if n:
        raise Conflict(f"{n} upcoming surger{'y is' if n == 1 else 'ies are'} booked at {row.label} — switch it off instead")
    _audit(db, by, "ot_slot.delete", "ot_slot", row.id, label=row.label)
    db.delete(row)
    db.commit()


def generate_ot_slots(db: Session, start: str, end: str, every_min: int, by) -> list[OtSlot]:
    """Replace the slot list with a regular grid. Slots holding upcoming surgeries are kept."""
    from datetime import date as _date, datetime as _dt, timedelta

    try:
        t = _dt.combine(_date(2000, 1, 1), _dt.strptime(start, "%H:%M").time())
        end_dt = _dt.combine(_date(2000, 1, 1), _dt.strptime(end, "%H:%M").time())
    except ValueError:
        raise BadValue("start and end must be HH:MM (24-hour)")
    if end_dt < t:
        raise BadValue("end must be after start")
    labels = []
    while t <= end_dt:
        labels.append(t.strftime("%I:%M %p").lstrip("0"))
        t += timedelta(minutes=every_min)
    keep = {r.label for r in db.scalars(select(OtSlot)) if _slot_in_use(db, r.label)}
    for r in list(db.scalars(select(OtSlot))):
        if r.label not in keep:
            db.delete(r)
    db.flush()
    existing = {r.label for r in db.scalars(select(OtSlot))}
    for i, label in enumerate(labels):
        if label not in existing:
            db.add(OtSlot(label=label, active=True, sort_order=i))
    _audit(db, by, "ot_slot.generate", "ot_slot", None, start=start, end=end, every_min=every_min, count=len(labels))
    db.commit()
    return ot_slots(db)


# --------------------------------------------------------------------------- OT procedures
def ot_procedures(db: Session) -> list[OtProcedure]:
    return _ordered(db, OtProcedure)


def get_ot_procedure(db: Session, procedure_id: int) -> OtProcedure:
    return _get_or_404(db, OtProcedure, procedure_id, "Procedure")


def _procedure_name(db: Session, name: str, except_id: int | None = None) -> str:
    name = " ".join((name or "").split())
    if not name:
        raise BadValue("Procedure name is required")
    q = select(OtProcedure).where(func.lower(OtProcedure.name) == name.lower())
    if except_id is not None:
        q = q.where(OtProcedure.id != except_id)
    if db.scalar(q):
        raise Conflict(f"Procedure '{name}' already exists")
    return name


def create_ot_procedure(db: Session, name: str, by) -> OtProcedure:
    name = _procedure_name(db, name)
    row = OtProcedure(name=name, active=True, sort_order=_next_order(db, OtProcedure))
    db.add(row)
    db.flush()
    _audit(db, by, "ot_procedure.create", "ot_procedure", row.id, name=name)
    db.commit()
    return row


def update_ot_procedure(db: Session, row: OtProcedure, values: dict, by) -> OtProcedure:
    changed = {}
    if values.get("name") is not None:
        name = _procedure_name(db, values["name"], row.id)
        if name != row.name:
            row.name = changed["name"] = name
    if values.get("active") is not None and values["active"] != row.active:
        row.active = changed["active"] = values["active"]
    if changed:
        _audit(db, by, "ot_procedure.update", "ot_procedure", row.id, **changed)
        db.commit()
    return row


def delete_ot_procedure(db: Session, row: OtProcedure, by) -> None:
    n = db.scalar(select(func.count()).select_from(OtCase).where(OtCase.procedure == row.name)) or 0
    if n:
        raise Conflict(f"{n} surger{'y uses' if n == 1 else 'ies use'} '{row.name}' — switch it off instead")
    _audit(db, by, "ot_procedure.delete", "ot_procedure", row.id, name=row.name)
    db.delete(row)
    db.commit()


def reorder_ot_procedures(db: Session, ids: list[int], by) -> list[OtProcedure]:
    return _reorder(db, OtProcedure, ids, "id", by, "ot_procedure.reorder", "ot_procedure")
