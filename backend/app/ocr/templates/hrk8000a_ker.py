"""Huvitz HRK-8000A — keratometry (KER) half of the combined REF+KER slip (see _hrk.py)."""
from app.ocr.templates import _hrk, _keratometry as _shared

KEY = "hrk8000a_ker"
LABEL = "HRK-8000A — Keratometry (KER)"
FIELDS = _shared.FIELDS
MANUAL_ONLY = False
TESS_CONFIG = _shared.TESS_CONFIG
TWIN_KEY = "hrk8000a_ref"  # the same photo also carries the REF section
parse = _shared.parse
parse_page = _hrk.parse_ker_page
parse_twin = _hrk.parse_ref_page
