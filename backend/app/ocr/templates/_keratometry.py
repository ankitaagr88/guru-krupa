"""Shared KER parser (HRK-8000A / YPC-100K): K1 / K2 in dioptres per eye."""
from app.ocr.templates._common import TESS_PSM6, extract, fmt_diopter, to_values

FIELDS = ["K1 (R)", "K2 (R)", "K1 (L)", "K2 (L)"]
TESS_CONFIG = TESS_PSM6
ALIASES = {"KI": "K1", "KL": "K1", "K|": "K1", "KZ": "K2", "R1": "K1", "R2": "K2"}


def parse(text: str) -> list[dict]:
    found = extract(text, ["K1", "K2"], ALIASES)
    return to_values(found, FIELDS, {"K1": fmt_diopter, "K2": fmt_diopter})
