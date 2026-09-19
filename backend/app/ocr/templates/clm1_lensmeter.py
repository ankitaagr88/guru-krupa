"""Huvitz CLM-1 auto lensmeter: the patient's current glasses (SPH / CYL / AXS per eye).

Real slip (tests/ocr_samples/clm1_lensmeter_01.png) is column-major:

    NAME: / NO. / DATE / NORMAL LENS / R-PD: 0.00  L-PD: 41.00 / PD: 41.00   (ignored)
            <RIGHT>        <LEFT>
    SPH :   -0.75          -0.50
    CYL :   -1.75          -1.25
    AXS :   174°           163°
    ==========  CLM-1 / GURU KRUPA DR ANU / phone                          (ignored)
"""
from app.ocr.layout import Page
from app.ocr.templates._common import TESS_PSM6, extract, fmt_diopter, fmt_int, to_values
from app.ocr.templates._page import (AXIS, CYLINDER, DIOPTER, assign_columns, column_tolerance, eye_of, match_label,
                                     numeric_words)

KEY = "clm1_lensmeter"
LABEL = "CLM-1 — Current Glasses (Lensmeter)"
FIELDS = ["SPH (R)", "CYL (R)", "AXS (R)", "SPH (L)", "CYL (L)", "AXS (L)"]
MANUAL_ONLY = False
TESS_CONFIG = TESS_PSM6
_ALIASES = {"5PH": "SPH", "SPN": "SPH", "CYI": "CYL", "CY1": "CYL", "CVL": "CYL",
            "AX": "AXS", "AXIS": "AXS", "AX5": "AXS", "AKS": "AXS"}
_ROWS = {"SPH": ("SPH", "5PH", "SPN", "SPM", "SPH1"), "CYL": ("CYL", "CVL", "CYI", "CY1", "CYL1"),
         "AXS": ("AXS", "AX", "AXS1", "AX5", "AKS", "AXIS")}
_SPECS = {"SPH": DIOPTER, "CYL": CYLINDER, "AXS": AXIS}


def parse(text: str) -> list[dict]:
    found = extract(text, ["SPH", "CYL", "AXS"], _ALIASES)
    return to_values(found, FIELDS, {"SPH": fmt_diopter, "CYL": fmt_diopter, "AXS": fmt_int})


def parse_page(page: Page) -> list[dict]:
    columns: dict[str, float] = {}
    found: dict[str, str] = {}
    for row in page.rows:
        if not row.words:
            continue
        eyes = {eye_of(w): w.cx for w in row.words if eye_of(w)}
        if "R" in eyes and "L" in eyes:
            columns = {"R": eyes["R"], "L": eyes["L"]}
            continue
        field = match_label(row.words[0], _ROWS)
        if field is None:
            continue
        nums = [w for w in numeric_words(row) if _SPECS[field].pick(w) is not None]
        if columns:
            by_eye = assign_columns(row, columns, column_tolerance(columns, page))
        else:  # no header read: left number is the right eye, right number the left eye
            by_eye = {"R": nums[0]} if nums else {}
            if len(nums) >= 2:
                by_eye["L"] = nums[-1]
        for eye, word in by_eye.items():
            value = _SPECS[field].read(word)
            if value is not None:
                found.setdefault(f"{field} ({eye})", value)
    return [{"l": label, "v": found[label]} for label in FIELDS if label in found]
