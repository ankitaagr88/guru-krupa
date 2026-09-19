"""Shared REF parser for the HRK-8000A and YPC-100K auto-refractors: SPH / CYL / AX per eye + PD."""
from app.ocr.templates._common import TESS_PSM6, extract, fmt_diopter, fmt_int, to_values

FIELDS = ["SPH (R)", "CYL (R)", "AX (R)", "SPH (L)", "CYL (L)", "AX (L)", "PD"]
TESS_CONFIG = TESS_PSM6
ALIASES = {"5PH": "SPH", "SPN": "SPH", "5PN": "SPH", "CYI": "CYL", "CY1": "CYL", "CVL": "CYL",
           "AXIS": "AX", "AXS": "AX", "AK": "AX", "P0": "PD", "PO": "PD"}


def fmt_pd(v: str) -> str:
    n = float(v)
    return (str(int(n)) if n.is_integer() else f"{n:g}") + "mm"


def parse(text: str) -> list[dict]:
    found = extract(text, ["SPH", "CYL", "AX", "PD"], ALIASES)
    return to_values(found, FIELDS, {"SPH": fmt_diopter, "CYL": fmt_diopter, "AX": fmt_int, "PD": fmt_pd})
