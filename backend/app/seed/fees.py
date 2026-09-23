"""Starting data for visit fees: Dr Anu's fee list, visit kinds and the fee rules (lane E2 owns
this module). Called from `seed_reference`; must be idempotent.

From Dr Anu's sheets (ref files/Fees.pdf, Eye_Procedure_Charges.pdf). Seeded once (marker
ClinicSetting "fee_seed"); afterwards Admin owns the list. A charge an admin has priced is never
overwritten: the old ₹0 starter charges are turned into the matching new ones, or switched off
when they are not on Dr Anu's sheet.
"""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.billing import StandardCharge
from app.models.config import ClinicSetting, VisitKind
from app.schemas.fees import FeeRules

SEED_KEY = "fee_seed"
EMERGENCY = "Emergency"

# (label, one eye / flat, both eyes or None, heading on the bill)
CHARGES = [
    ("Consultation / new file", 700, None, "Visit fees"),
    ("Follow-up", 350, None, "Visit fees"),
    ("New case", 500, None, "Visit fees"),
    ("OT follow-up", 350, None, "Visit fees"),
    (EMERGENCY, 1000, None, "Visit fees"),
    ("Perimetry", 2500, 4000, "Tests"),
    ("Fundus photo", 500, 1000, "Tests"),
    ("Macular OCT", 1500, 2000, "Tests"),
    ("RNFL (retinal nerve fibre layer)", 1500, 2000, "Tests"),
    ("CCT (central corneal thickness)", 1000, 1500, "Tests"),
    ("Package 1 — Fundus + OCT + RNFL", 3500, 5000, "Packages"),
    ("Package 2 — Fundus + OCT + RNFL + Perimetry", 5000, 7000, "Packages"),
]

# Earlier ₹0 starter charges -> the charge on Dr Anu's sheet they become (still ₹0 = never priced).
STARTER_RENAMES = {"Consultation": "Consultation / new file", "Follow-up consultation": "Follow-up"}
STARTERS_OFF = ["Pre-test", "Dilation"]  # not on the sheet: switched off while still ₹0

# (key, label, charge label or None = free). Keys are what the fee rules point at.
VISIT_KINDS = [
    ("new", "New patient", "Consultation / new file"),
    ("free_follow_up", "Follow-up · free", None),
    ("follow_up", "Follow-up", "Follow-up"),
    ("new_case", "New case", "New case"),
    ("post_op", "After surgery", None),  # to confirm with Dr Anu
]


def _by_label(db: Session, label: str) -> StandardCharge | None:
    return db.scalar(select(StandardCharge).where(func.lower(StandardCharge.label) == label.lower()))


def _seed_charges(db: Session) -> None:
    order = (db.scalar(select(func.max(StandardCharge.sort_order))) or 0) + 1
    starters = {new: old for old, new in STARTER_RENAMES.items()}
    for label, amount, both, group in CHARGES:
        row = _by_label(db, label)
        if row is None and label in starters:
            old = _by_label(db, starters[label])
            if old is not None and old.amount == 0:
                old.label = label
                row = old
        if row is None:
            db.add(StandardCharge(label=label, amount=amount, amount_both_eyes=both, group_label=group,
                                  active=True, sort_order=order))
            order += 1
            continue
        if row.amount == 0:  # never priced by an admin — take Dr Anu's price
            row.amount, row.amount_both_eyes, row.active = amount, both, True
        if not row.group_label:
            row.group_label = group
    for label in STARTERS_OFF:
        row = _by_label(db, label)
        if row is not None and row.amount == 0:
            row.active = False
    db.flush()


def _seed_kinds(db: Session) -> None:
    for i, (key, label, charge) in enumerate(VISIT_KINDS):
        if db.scalar(select(VisitKind).filter_by(key=key)) is not None:
            continue
        row = _by_label(db, charge) if charge else None
        db.add(VisitKind(key=key, label=label, standard_charge_id=row.id if row else None, sort_order=i,
                         active=True))
    db.flush()


def seed_fees(db: Session) -> None:
    if db.get(ClinicSetting, SEED_KEY) is None:
        _seed_charges(db)
        _seed_kinds(db)
        db.add(ClinicSetting(key=SEED_KEY, value={"version": 1}))
    # Rules: created once; a rule added later gets its default without touching the admin's values.
    emergency = _by_label(db, EMERGENCY)
    defaults = FeeRules(emergency_charge_id=emergency.id if emergency else None).model_dump(by_alias=True)
    row = db.get(ClinicSetting, "fee_rules")
    if row is None:
        db.add(ClinicSetting(key="fee_rules", value=defaults))
    else:
        missing = {k: v for k, v in defaults.items() if k not in (row.value or {})}
        if missing:
            row.value = {**(row.value or {}), **missing}
    db.flush()
