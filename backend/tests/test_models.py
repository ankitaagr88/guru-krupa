from datetime import date

from sqlalchemy import func, select

from app.models import (InventoryItem, LensTier, Medicine, MedicineForm, OtCase, OtConsentPhoto, Patient,
                        Prescription, PrescriptionLine, ProtocolStep, Reading, ReferralSource, Stage, Visit)
from app.seed.reference import (INVENTORY, LENS_TIERS, MEDICINE_BRANDS, MEDICINE_FORMS, MEDICINE_LIST,
                                PROTOCOL_STEPS, REFERRAL_SOURCES, STAGES)
from app.seed.reference import seed_reference


def _counts(db):
    return {m.__tablename__: db.scalar(select(func.count()).select_from(m))
            for m in (Stage, ProtocolStep, ReferralSource, LensTier, Medicine, MedicineForm, InventoryItem)}


def test_seed_reference_is_idempotent(db):
    seed_reference(db)
    first = _counts(db)
    assert first == {"stages": len(STAGES), "protocol_steps": len(PROTOCOL_STEPS),
                     "referral_sources": len(REFERRAL_SOURCES), "lens_tiers": len(LENS_TIERS),
                     "medicines": len(MEDICINE_LIST) + len(MEDICINE_BRANDS), "medicine_forms": len(MEDICINE_FORMS),
                     "inventory_items": len(INVENTORY)}

    # Opening stock survives a re-seed; labels/prices are re-asserted.
    cyclo = db.scalar(select(InventoryItem).filter_by(name="Cyclopentolate 1%"))
    cyclo.stock = 1
    toric = db.scalar(select(LensTier).filter_by(key="toric"))
    toric.price = 1
    db.commit()

    seed_reference(db)
    assert _counts(db) == first
    db.refresh(cyclo)
    db.refresh(toric)
    assert cyclo.stock == 1
    assert toric.price == 38000
    assert cyclo.medicine_id is None  # dilation drops are stocked but not on the prescription list
    timolol = db.scalar(select(InventoryItem).filter_by(name="Timolol 0.5% eye drops"))
    assert timolol.medicine.name == "Timolol 0.5% eye drops"
    # generic-only rows: name == composition, no brand; form guessed from the name
    assert timolol.medicine.brand is None and timolol.medicine.composition == "Timolol 0.5% eye drops"
    assert timolol.medicine.form == "drops" and timolol.medicine.display_name == "Timolol 0.5% eye drops"
    assert db.scalar(select(Medicine).filter_by(name="Ofloxacin eye ointment")).form == "ointment"
    assert db.scalar(select(Medicine).filter_by(name="Acetazolamide 250mg tablets")).form == "tablet"
    # branded packs from the photos (ref files/med.jpeg, med 1.jpeg)
    aquaray = db.scalar(select(Medicine).filter_by(name="Aquaray Gel"))
    assert (aquaray.brand, aquaray.form, aquaray.strength, aquaray.pack_size, aquaray.manufacturer) == \
        ("Aquaray Gel", "gel", "0.5%", "10 ml", "Raymed")
    assert aquaray.display_name == "Aquaray Gel (Carboxymethylcellulose sodium eye drops IP)"
    mosi = db.scalar(select(Medicine).filter_by(name="MOSI LP"))
    assert mosi.form == "suspension" and mosi.manufacturer == "FDC" and mosi.pack_size == "5 ml"
    assert "Loteprednol" in mosi.composition
    assert [f.key for f in db.scalars(select(MedicineForm).order_by(MedicineForm.sort_order))] == \
        [k for k, _ in MEDICINE_FORMS]
    assert all(db.scalar(select(MedicineForm).filter_by(key=m.form)) for m in db.scalars(select(Medicine)))

    doctor = db.scalar(select(ReferralSource).filter_by(key="doctor"))
    assert doctor.needs_detail is True
    assert db.scalar(select(ReferralSource).filter_by(key="self")).needs_detail is False
    assert [s.key for s in db.scalars(select(Stage).order_by(Stage.sort_order))] == \
        ["reg", "pretest", "doctor", "dilate", "billing", "done"]


def test_patient_visit_reading_prescription(db):
    seed_reference(db)
    doctor = db.scalar(select(ReferralSource).filter_by(key="doctor"))
    patient = Patient(name="Rasilaben Patel", age=62, sex="F", phone="98250 12345", address="Vesu, Surat",
                      occupation="Homemaker", screen_hours=1, language="gujarati",
                      referral_source_id=doctor.id, referral_detail="Dr. Shah",
                      existing_conditions=["Diabetes", "Hypertension"])
    visit = Visit(patient=patient, date=date(2020, 1, 15), token="#014", note="First visit", va_r="6/9", va_l="6/6")
    reading = Reading(visit=visit, machine_key="hrk8000a_ref", source="scanned", status="done", confidence=0.93,
                      values=[{"l": "SPH (R)", "v": "-1.00"}, {"l": "CYL (R)", "v": "-0.50"}, {"l": "PD", "v": "64mm"}])
    timolol = db.scalar(select(Medicine).filter_by(name="Timolol 0.5% eye drops"))
    rx = Prescription(visit=visit, print_language="gujarati", lines=[
        PrescriptionLine(name=timolol.name, medicine_id=timolol.id, matched=True,
                         dosage="1 drop both eyes, twice daily", qty_given=1),
        PrescriptionLine(name="Some unlisted drop", matched=False, dosage="at night"),
    ])
    db.add_all([patient, visit, reading, rx])
    db.commit()

    loaded = db.get(Visit, visit.id)
    assert loaded.patient.name == "Rasilaben Patel"
    assert loaded.patient.existing_conditions == ["Diabetes", "Hypertension"]
    assert loaded.patient.referral_source.label == "Referred by another doctor"
    assert loaded.stage_key == "reg" and loaded.status == "active"
    assert loaded.stage_entered_at.tzinfo is not None
    assert loaded.readings[0].values[2] == {"l": "PD", "v": "64mm"}
    assert [ln.matched for ln in loaded.prescriptions[0].lines] == [True, False]
    assert loaded.prescriptions[0].lines[0].medicine is timolol
    assert db.get(Patient, patient.id).visits == [loaded]


def test_ot_case_json_defaults(db):
    case = OtCase(patient_name="Rujavana Madhani", age=52, sex="F", date=date(2020, 1, 15), time_slot="9:00 AM",
                  procedure="Cataract — Phaco with IOL (OD)",
                  pre_op_biometry={"AL": {"R": "22.90mm", "L": "22.80mm"}, "ACD": {"R": "2.70mm", "L": "2.77mm"},
                                   "K1": {"R": "43.27D", "L": "43.34D"}, "K2": {"R": "43.48D", "L": "43.93D"},
                                   "targetRefraction": {"R": "-0.04D", "L": "0.03D"}},
                  consent_photos=[OtConsentPhoto(image_path="uploads/consent/1.jpg")])
    db.add(case)
    db.commit()

    loaded = db.get(OtCase, case.id)
    assert loaded.status == "scheduled"
    assert loaded.operative["surgeon"] == "Dr. Anu Juneja Pathak"
    assert loaded.post_op["finalRx"]["L"] == {"sph": "", "cyl": "", "axis": "", "va": ""}
    assert loaded.billing == {"lensTier": None, "mediclaim": False, "paymentMode": None, "team": []}
    assert loaded.pre_op_biometry["K2"]["L"] == "43.93D"
    assert len(loaded.consent_photos) == 1
