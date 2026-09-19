"""Reference data copied verbatim from the mockup arrays (docs/mockup-reference.html)."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.config import LensTier, ProtocolStep, ReferralSource, Stage
from app.models.pharmacy import InventoryItem, Medicine

STAGES = [
    ("reg", "Registration", "reg"),
    ("pretest", "Pre-testing", "pretest"),
    ("doctor", "With Doctor", "doctor"),
    ("dilate", "Dilating · Wait", "dilate"),
    ("billing", "Billing", "billing"),
    ("done", "Done", "done"),
]

PROTOCOL_STEPS = [
    ("Tropicamide 0.8%", 5),
    ("Cyclopentolate 1%", 20),
]

REFERRAL_SOURCES = [
    ("self", "Self / Walk-in"),
    ("doctor", "Referred by another doctor"),
    ("patient", "Referred by family / another patient"),
    ("online", "Online / Google"),
    ("bni", "BNI"),
    ("insurance", "Insurance / TPA"),
    ("camp", "Camp / Outreach"),
]
REFERRAL_NEEDS_DETAIL = {"doctor", "patient"}

CONDITIONS = ["Diabetes", "Hypertension", "Asthma", "Arthritis", "Thyroid disorder",
              "Heart disease / stroke history", "Allergy", "Acidity / GERD", "BPH"]

MEDICINE_LIST = [
    "Moxifloxacin 0.5% eye drops",
    "Prednisolone acetate 1% eye drops",
    "Ketorolac 0.5% eye drops",
    "Carboxymethylcellulose 0.5% (tear drops)",
    "Timolol 0.5% eye drops",
    "Latanoprost 0.005% eye drops",
    "Homatropine 2% eye drops",
    "Tobramycin + Dexamethasone eye drops",
    "Ofloxacin eye ointment",
    "Acetazolamide 250mg tablets",
]

# (name, unit, stock, reorder_level) — stock only applies on first insert.
INVENTORY = [
    ("Tropicamide 0.8%", "bottles", 8, 5),
    ("Cyclopentolate 1%", "bottles", 3, 5),
    ("Moxifloxacin 0.5% eye drops", "bottles", 12, 6),
    ("Prednisolone acetate 1% eye drops", "bottles", 10, 6),
    ("Ketorolac 0.5% eye drops", "bottles", 7, 6),
    ("Carboxymethylcellulose 0.5% (tear drops)", "bottles", 15, 8),
    ("Timolol 0.5% eye drops", "bottles", 9, 6),
    ("Latanoprost 0.005% eye drops", "bottles", 4, 6),
    ("Homatropine 2% eye drops", "bottles", 6, 5),
    ("Tobramycin + Dexamethasone eye drops", "bottles", 8, 6),
    ("Ofloxacin eye ointment", "tubes", 5, 4),
    ("Acetazolamide 250mg tablets", "strips", 20, 10),
]

LENS_TIERS = [
    ("monofocal", "Monofocal IOL", 28500),
    ("multifocal", "Multifocal / Trifocal IOL", 45000),
    ("toric", "Toric IOL", 38000),
]


def _upsert(db: Session, model, lookup: dict, **values):
    row = db.scalar(select(model).filter_by(**lookup))
    if row is None:
        row = model(**lookup, **values)
        db.add(row)
    else:
        for k, v in values.items():
            setattr(row, k, v)
    return row


def seed_reference(db: Session) -> None:
    for i, (key, label, cls) in enumerate(STAGES):
        _upsert(db, Stage, {"key": key}, label=label, cls=cls, sort_order=i)
    for i, (name, minutes) in enumerate(PROTOCOL_STEPS):
        _upsert(db, ProtocolStep, {"name": name}, minutes=minutes, sort_order=i)
    for i, (key, label) in enumerate(REFERRAL_SOURCES):
        _upsert(db, ReferralSource, {"key": key}, label=label,
                needs_detail=key in REFERRAL_NEEDS_DETAIL, sort_order=i)
    for i, (key, label, price) in enumerate(LENS_TIERS):
        _upsert(db, LensTier, {"key": key}, label=label, price=price, sort_order=i)

    medicines = {name: _upsert(db, Medicine, {"name": name}, active=True) for name in MEDICINE_LIST}
    db.flush()
    for name, unit, stock, reorder in INVENTORY:
        med = medicines.get(name)
        existing = db.scalar(select(InventoryItem).filter_by(name=name))
        if existing is None:
            # Opening stock is only set once; later counts come from stock_movements.
            db.add(InventoryItem(name=name, unit=unit, stock=stock, reorder_level=reorder,
                                 medicine_id=med.id if med else None))
        else:
            existing.unit = unit
            existing.reorder_level = reorder
            if med and existing.medicine_id is None:
                existing.medicine_id = med.id
    db.commit()
