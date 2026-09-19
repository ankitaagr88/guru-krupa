"""Huvitz HNT-1P non-contact tono-pachymeter: IOP, corrected IOP and central corneal thickness."""
from app.ocr.templates._common import TESS_PSM6, extract, fmt_int, to_values

KEY = "hnt1p_tono"
LABEL = "HNT-1P — Tono-Pachy (IOP & CCT)"
FIELDS = ["IOP (R)", "IOP (L)", "CIOP (R)", "CIOP (L)", "CCT (R)", "CCT (L)"]
MANUAL_ONLY = False
TESS_CONFIG = TESS_PSM6
_ALIASES = {"C1OP": "CIOP", "CI0P": "CIOP", "C10P": "CIOP", "CIO": "CIOP", "I0P": "IOP", "10P": "IOP", "TOP": "IOP", "LOP": "IOP",
            "1OP": "IOP", "CCI": "CCT", "CC1": "CCT", "PACHY": "CCT"}


def parse(text: str) -> list[dict]:
    found = extract(text, ["IOP", "CIOP", "CCT"], _ALIASES)
    return to_values(found, FIELDS, {"IOP": fmt_int, "CIOP": fmt_int, "CCT": fmt_int})
