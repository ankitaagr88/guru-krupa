"""Huvitz CLM-1 auto lensmeter: the patient's current glasses (SPH / CYL / AXS per eye)."""
from app.ocr.templates._common import TESS_PSM6, extract, fmt_diopter, fmt_int, to_values

KEY = "clm1_lensmeter"
LABEL = "CLM-1 — Current Glasses (Lensmeter)"
FIELDS = ["SPH (R)", "CYL (R)", "AXS (R)", "SPH (L)", "CYL (L)", "AXS (L)"]
MANUAL_ONLY = False
TESS_CONFIG = TESS_PSM6
_ALIASES = {"5PH": "SPH", "SPN": "SPH", "CYI": "CYL", "CY1": "CYL", "CVL": "CYL",
            "AX": "AXS", "AXIS": "AXS", "AX5": "AXS", "AKS": "AXS"}


def parse(text: str) -> list[dict]:
    found = extract(text, ["SPH", "CYL", "AXS"], _ALIASES)
    return to_values(found, FIELDS, {"SPH": fmt_diopter, "CYL": fmt_diopter, "AXS": fmt_int})
