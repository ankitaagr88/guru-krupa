"""Huvitz HRK-8000A — refraction (REF) half of the combined REF+KER slip (see _hrk.py)."""
from app.ocr.templates import _hrk, _refraction as _shared

KEY = "hrk8000a_ref"
LABEL = "HRK-8000A — Refraction (REF)"
FIELDS = _shared.FIELDS
MANUAL_ONLY = False
TESS_CONFIG = _shared.TESS_CONFIG
TWIN_KEY = "hrk8000a_ker"  # the same photo also carries the KER section
parse = _shared.parse
parse_page = _hrk.parse_ref_page
parse_twin = _hrk.parse_ker_page
