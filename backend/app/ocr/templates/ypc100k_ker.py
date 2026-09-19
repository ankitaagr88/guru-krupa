"""YPC-100K — keratometry (KER) printout."""
from app.ocr.templates import _keratometry as _shared

KEY = "ypc100k_ker"
LABEL = "YPC-100K — Keratometry (KER)"
FIELDS = _shared.FIELDS
MANUAL_ONLY = False
TESS_CONFIG = _shared.TESS_CONFIG
parse = _shared.parse
