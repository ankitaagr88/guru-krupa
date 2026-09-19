"""YPC-100K — refraction (REF) printout (same layout family as the HRK)."""
from app.ocr.templates import _refraction as _shared

KEY = "ypc100k_ref"
LABEL = "YPC-100K — Refraction (REF)"
FIELDS = _shared.FIELDS
MANUAL_ONLY = False
TESS_CONFIG = _shared.TESS_CONFIG
parse = _shared.parse
