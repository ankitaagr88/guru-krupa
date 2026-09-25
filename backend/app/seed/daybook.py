"""Starting data for the day book: its columns (account heads, matching the clinic's cash sheet:
OPD / MED / TEST / GLASSES / OT / OTHER), the head of every seeded standard charge, a Glasses charge
and the day-book settings. Lane M owns this module. Called from `seed_reference`; idempotent — once a
head list exists, Admin owns it and a re-seed only fills gaps (a charge with no head yet).
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.billing import AccountHead, StandardCharge
from app.models.config import ClinicSetting

SETTINGS_KEY = "daybook"

HEADS = [
    ("opd", "OPD"),
    ("med", "MED"),
    ("test", "TEST"),
    ("glasses", "GLASSES"),
    ("ot", "OT"),
    ("other", "OTHER"),
]

# Charge group (as seeded in app.seed.fees) -> head.
GROUP_HEADS = {"visit fees": "opd", "tests": "test", "packages": "test", "glasses": "glasses"}

# Glasses are priced per order, so the charge starts at ₹0 and reception types the amount.
GLASSES_CHARGES = [("Glasses", 0, "Glasses")]

DEFAULT_SETTINGS = {"medicineHead": "med", "otherHead": "other", "otHead": "ot"}


def seed_daybook(db: Session) -> None:
    if db.scalar(select(AccountHead)) is None:
        for i, (key, label) in enumerate(HEADS):
            db.add(AccountHead(key=key, label=label, sort_order=i, active=True))
        db.flush()
    existing = {c.label.lower() for c in db.scalars(select(StandardCharge))}
    order = max((c.sort_order for c in db.scalars(select(StandardCharge))), default=0)
    for label, amount, group in GLASSES_CHARGES:
        if label.lower() not in existing:
            order += 1
            db.add(StandardCharge(label=label, amount=amount, group_label=group, account_head_key="glasses",
                                  active=True, sort_order=order))
    db.flush()
    for charge in db.scalars(select(StandardCharge).where(StandardCharge.account_head_key.is_(None))):
        charge.account_head_key = GROUP_HEADS.get((charge.group_label or "").strip().lower(), "other")
    if db.get(ClinicSetting, SETTINGS_KEY) is None:
        db.add(ClinicSetting(key=SETTINGS_KEY, value=dict(DEFAULT_SETTINGS)))
    db.flush()
