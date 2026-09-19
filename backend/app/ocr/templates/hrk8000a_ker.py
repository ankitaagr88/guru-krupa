"""Huvitz HRK-8000A — keratometry (KER) printout."""
from app.ocr.templates import _keratometry as _shared

KEY = "hrk8000a_ker"
LABEL = "HRK-8000A — Keratometry (KER)"
FIELDS = _shared.FIELDS
MANUAL_ONLY = False
TESS_CONFIG = _shared.TESS_CONFIG
parse = _shared.parse
