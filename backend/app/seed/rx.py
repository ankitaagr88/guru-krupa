"""Starting data for the printed prescription: examination findings, spectacle lens types and the
print settings (doctor's degrees + registration number, footer note). Lane R owns this module.
Called from `seed_reference`; idempotent — once a list exists, Admin owns it.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.config import ClinicSetting, ExamFinding, LensType

SETTINGS_KEY = "rx_print"

# (key, label, one-tap default)
EXAM_FINDINGS = [
    ("lids", "Lids & adnexa", "Normal"),
    ("anterior", "Anterior segment", "Normal"),
    ("pupil", "Pupil", "Normal"),
    ("lens", "Lens", "Clear"),
    ("iop", "IOP (mmHg)", ""),
    ("fundus", "Fundus", "Normal"),
]

LENS_TYPES = [
    ("arc", "ARC"),
    ("blue_cut", "Blue cut"),
    ("photochromic", "Photochromic"),
    ("bifocal", "Bifocal"),
    ("progressive", "Progressive"),
]

# Degrees and registration number are still to come from Dr Anu (asked 2026-09-25); Admin fills them.
DEFAULT_SETTINGS = {
    "doctorName": "Dr. Anu Juneja Pathak",
    "degrees": "M.S. Ophthalmology",
    "regNo": "",
    "footerNote": {
        "english": "Please bring your medicines when you come for the next visit.",
        "gujarati": "ફરી બતાવવા આવો ત્યારે દવા સાથે લાવવી.",
        "hindi": "अगली बार दिखाने आएँ तब दवाइयाँ साथ लाएँ।",
    },
}


def seed_rx(db: Session) -> None:
    if db.scalar(select(ExamFinding)) is None:
        for i, (key, label, default) in enumerate(EXAM_FINDINGS):
            db.add(ExamFinding(key=key, label=label, default_value=default, sort_order=i, active=True))
    if db.scalar(select(LensType)) is None:
        for i, (key, label) in enumerate(LENS_TYPES):
            db.add(LensType(key=key, label=label, sort_order=i, active=True))
    if db.get(ClinicSetting, SETTINGS_KEY) is None:
        db.add(ClinicSetting(key=SETTINGS_KEY, value=dict(DEFAULT_SETTINGS)))
    db.flush()
