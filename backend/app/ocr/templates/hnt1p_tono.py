"""Huvitz HNT-1P non-contact tono-pachymeter: IOP, corrected IOP and central corneal thickness.

Real slip (tests/ocr_samples/hnt1p_tono_01.png), `[TONO-PACHY Mode]`:

    IOP      <R>     <L>
             13*     12*          several starred readings per column (R may have more rows
             13*                  than L, so columns are assigned by x-position, not word order)
    AVG      0.0     0.0 (mmHg)   <- the IOP / CIOP AVG rows print 0.0 and are IGNORED
    CIOP     <R>     <L>          same shape
    CCT      <R>     <L>
             499     512 ...      AVG 499.0 508.0 (um) is valid -> preferred over the mean

IOP / CIOP per eye = median of that column's readings (rounded); CCT = the AVG row, else the mean.
"""
from app.ocr.layout import Page
from app.ocr.templates._common import TESS_PSM6, extract, fmt_int, to_values
from app.ocr.templates._page import (Spec, assign_columns, column_tolerance, eye_of, labels_of, match_label, median,
                                     numeric_words)

KEY = "hnt1p_tono"
LABEL = "HNT-1P — Tono-Pachy (IOP & CCT)"
FIELDS = ["IOP (R)", "IOP (L)", "CIOP (R)", "CIOP (L)", "CCT (R)", "CCT (L)"]
MANUAL_ONLY = False
TESS_CONFIG = TESS_PSM6
_ALIASES = {"C1OP": "CIOP", "CI0P": "CIOP", "C10P": "CIOP", "CIO": "CIOP", "I0P": "IOP", "10P": "IOP", "TOP": "IOP", "LOP": "IOP",
            "1OP": "IOP", "CCI": "CCT", "CC1": "CCT", "PACHY": "CCT"}
_SECTIONS = {"IOP": ("IOP", "I0P", "10P", "TOP", "LOP", "1OP", "IOR", "IQP"),
             "CIOP": ("CIOP", "C1OP", "CI0P", "C10P", "CIO", "CIQP", "CIOR", "C1OR"),
             "CCT": ("CCT", "CCI", "CC1", "CCJ", "CET", "OCT", "CCTT")}
_SPECS = {"IOP": Spec(1, 5, 60), "CIOP": Spec(1, 5, 60), "CCT": Spec(1, 350, 700)}
_AVG = ("AVG", "AYG", "AVC", "AV", "AV6", "AVO")


def parse(text: str) -> list[dict]:
    found = extract(text, ["IOP", "CIOP", "CCT"], _ALIASES)
    return to_values(found, FIELDS, {"IOP": fmt_int, "CIOP": fmt_int, "CCT": fmt_int})


def parse_page(page: Page) -> list[dict]:
    readings: dict[str, dict[str, list[float]]] = {s: {"R": [], "L": []} for s in _SECTIONS}
    avg: dict[str, dict[str, float]] = {s: {} for s in _SECTIONS}
    section: str | None = None
    columns: dict[str, float] = {}
    for row in page.rows:
        if not row.words:
            continue
        eyes = {eye_of(w) or w.text: w.cx for w in row.words if eye_of(w) or w.text in ("R", "L")}
        if len(row.words) == 2 and "R" in eyes and "L" in eyes:  # bare "R  L" header row
            columns = {"R": eyes["R"], "L": eyes["L"]}
            continue
        firsts = labels_of(row.words[0])
        sec = match_label(row.words[0], _SECTIONS)
        if sec:
            section = sec
            eyes = {eye_of(w) or w.text: w.cx for w in row.words[1:] if eye_of(w) or w.text in ("R", "L")}
            if "R" in eyes and "L" in eyes:
                columns = {"R": eyes["R"], "L": eyes["L"]}
            if not numeric_words(row):
                continue  # values follow on their own rows (the real slip)
        if section is None or not columns:
            continue
        spec = _SPECS[section]
        assigned = assign_columns(row, columns, column_tolerance(columns, page))
        if any(f in _AVG or f.startswith("AV") for f in firsts):
            for eye, word in assigned.items():
                v = spec.pick(word)
                if v is not None and v > 0:
                    avg[section][eye] = v
            section = None  # AVG closes the section; anything until the next label is a unit line
            continue
        for eye, word in assigned.items():
            v = spec.pick(word)
            if v is not None:
                readings[section][eye].append(v)
    out: list[dict] = []
    for label in FIELDS:
        field, eye = label[:-4], label[-2]
        if field == "CCT" and eye in avg["CCT"]:
            value = avg["CCT"][eye]
        else:
            vals = readings[field][eye]
            value = median(vals) if field != "CCT" else (sum(vals) / len(vals) if vals else None)
        if value is not None:
            out.append({"l": label, "v": str(int(round(value)))})
    return out
