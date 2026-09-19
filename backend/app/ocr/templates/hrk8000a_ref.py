"""Huvitz HRK-8000A — refraction (REF) printout."""
from app.ocr.templates import _refraction as _shared

KEY = "hrk8000a_ref"
LABEL = "HRK-8000A — Refraction (REF)"
FIELDS = _shared.FIELDS
MANUAL_ONLY = False
TESS_CONFIG = _shared.TESS_CONFIG
parse = _shared.parse
