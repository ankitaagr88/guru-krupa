"""YPC-100K — refraction (REF) half of the combined REF+KER slip (see _hrk.py)."""
from app.ocr.templates import _hrk, _refraction as _shared

KEY = "ypc100k_ref"
LABEL = "YPC-100K — Refraction (REF)"
FIELDS = _shared.FIELDS
MANUAL_ONLY = False
TESS_CONFIG = _shared.TESS_CONFIG
TWIN_KEY = "ypc100k_ker"  # the same photo also carries the KER section
parse = _shared.parse
parse_page = _hrk.parse_ref_page
parse_twin = _hrk.parse_ker_page
