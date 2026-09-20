"""Reference data copied verbatim from the mockup arrays (docs/mockup-reference.html)."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.config import LensTier, ProtocolStep, ReferralSource, Stage
from app.models.ot import OtProcedure, OtSlot
from app.models.pharmacy import Diagnosis, InventoryItem, Medicine, MedicineForm, guess_medicine_form

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

# Medicine types (`Medicine.form` keys). Admin-editable after seeding; these are just the starting set.
MEDICINE_FORMS = [
    ("drops", "Drops"),
    ("gel", "Gel"),
    ("ointment", "Ointment"),
    ("suspension", "Suspension"),
    ("tablet", "Tablet"),
    ("capsule", "Capsule"),
    ("syrup", "Syrup"),
    ("gummies", "Gummies"),
]

# Generic-only rows from the mockup: name == composition, no brand.
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

# Branded packs (ref files/med.jpeg, med 1.jpeg): the chemist dispenses by brand, the sheet prints
# brand with the composition underneath. name == brand.
# (brand, composition, form, strength, pack_size, manufacturer)
MEDICINE_BRANDS = [
    ("Aquaray Gel", "Carboxymethylcellulose sodium eye drops IP", "gel", "0.5%", "10 ml", "Raymed"),
    ("MOSI LP", "Moxifloxacin Hydrochloride & Loteprednol Etabonate ophthalmic suspension", "suspension",
     "0.5% / 0.5%", "5 ml", "FDC"),
]


def medicine_rows() -> list[dict]:
    """Every seeded medicine as Medicine kwargs (generics first, then brands)."""
    rows = [{"name": n, "brand": None, "composition": n, "form": guess_medicine_form(n), "strength": None,
             "pack_size": None, "manufacturer": None} for n in MEDICINE_LIST]
    rows += [{"name": brand, "brand": brand, "composition": comp, "form": form, "strength": strength,
              "pack_size": pack, "manufacturer": mfr} for brand, comp, form, strength, pack, mfr in MEDICINE_BRANDS]
    return rows

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


# Starter diagnoses / symptoms for the treatment standards. Admin-editable; Dr Anu will
# rename, add and remove as she sets her standards.
DIAGNOSES = [
    "Dry eye",
    "Allergic conjunctivitis",
    "Bacterial conjunctivitis",
    "Viral conjunctivitis",
    "Computer vision syndrome",
    "Refractive error",
    "Cataract",
    "Glaucoma",
    "Blepharitis",
    "Stye (hordeolum)",
    "Post-operative care",
]


# OT procedure list for "Schedule surgery" (admin-editable).
OT_PROCEDURES = [
    "Cataract — Phaco with IOL (OD)",
    "Cataract — Phaco with IOL (OS)",
    "Cataract — Phaco with IOL (OU, staged)",
    "LASIK",
    "Other",
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

    for i, (key, label) in enumerate(MEDICINE_FORMS):
        _upsert(db, MedicineForm, {"key": key}, label=label, sort_order=i, active=True)
    for i, name in enumerate(DIAGNOSES):
        if db.scalar(select(Diagnosis).filter_by(name=name)) is None:
            db.add(Diagnosis(name=name, active=True, sort_order=i))
    # OT slots / procedures are seeded once; afterwards Admin owns them (no upsert).
    if db.scalar(select(OtSlot)) is None:
        from app.services.ot import DEFAULT_OT_SLOTS

        for i, label in enumerate(DEFAULT_OT_SLOTS):
            db.add(OtSlot(label=label, active=True, sort_order=i))
    if db.scalar(select(OtProcedure)) is None:
        for i, name in enumerate(OT_PROCEDURES):
            db.add(OtProcedure(name=name, active=True, sort_order=i))
    medicines = {}
    for row in medicine_rows():
        name = row.pop("name")
        medicines[name] = _upsert(db, Medicine, {"name": name}, active=True, **row)
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
