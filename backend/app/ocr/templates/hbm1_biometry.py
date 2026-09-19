"""Huvitz HBM-1 optical biometer (upper floor, OT pre-op): the A4 IOL / biometry reports.

IOL REPORT (tests/ocr_samples/hbm1_iol_report_01.png): OD on the left half, OS on the right half,
each with a `Data Measurements` block:

    AL   22.90 mm   ACD   2.70 mm   LT     4.60 mm
    K1   43.27 D    K2   43.48 D    CYL   -0.21 D
    Axis 65 °       K Avg 43.38D    Target 0.00 D
    WTW  12.07 mm   Kappa           Ch u

BIOMETRY REPORT (hbm1_biometry_report_01.png): OD block on top, OS below, same labels in a table
(`AL 22.90 (...) / ACD 2.70 LT 4.60 K1 43.27 CYL ... / AL 22.90 CCT 0.52 K2 43.48 Axis 65 WTW ...`).

A value is the first number to the right of its label in the same row; the eye comes from which
half of the page the label sits in (side-by-side when a row carries the same label twice,
otherwise top/bottom split at the `OS` heading).
"""
from __future__ import annotations

import re

from app.ocr.layout import Page, Word, pick_number
from app.ocr.templates._page import KERATO, Spec, is_label, match_label, numeric_words

KEY = "hbm1_biometry"
LABEL = "HBM-1 — Biometry (IOL report)"
FIELDS = ["AL (R)", "AL (L)", "ACD (R)", "ACD (L)", "K1 (R)", "K1 (L)", "K2 (R)", "K2 (L)",
          "Axis (R)", "Axis (L)", "Target (R)", "Target (L)"]
MANUAL_ONLY = False
TESS_CONFIG = "--psm 6"
PASSES = ((1.0, True), (0.7, False), (1.2, True))  # clean laser print: 3 tile passes keep the sync scan ~5 s

SPECS: dict[str, Spec] = {"AL": Spec(2, 18.0, 32.0), "ACD": Spec(2, 1.5, 5.0), "K1": KERATO, "K2": KERATO,
                          "AXIS": Spec(0, 0, 180), "TARGET": Spec(2, -5.0, 2.0)}
_LABELS = {"AL": ("AL", "AI", "A1"), "ACD": ("ACD", "ACO", "AC0"), "K1": ("K1", "KI", "KL"), "K2": ("K2", "KZ"),
           "AXIS": ("AXIS", "AX1S", "AXIS1"), "TARGET": ("TARGET", "TARGE", "TARGE1")}
_OUT = {"AL": "AL", "ACD": "ACD", "K1": "K1", "K2": "K2", "AXIS": "Axis", "TARGET": "Target"}


def _canon(word: Word | str) -> str | None:
    return match_label(word, _LABELS)


def _value_right_of(label: Word, words: list[Word], spec: Spec, char_h: float) -> float | None:
    """First plausible number to the right of the label in the same row (within ~12 chars)."""
    for w in sorted((w for w in words if w.x0 >= label.x1 - 2), key=lambda w: w.x0):
        if w.x0 - label.x1 > char_h * 12:
            break
        if _canon(w):  # ran into the next label
            break
        v = spec.pick(w)
        if v is not None:
            return v
    return None


def parse_page(page: Page) -> list[dict]:
    hits: list[tuple[str, float, float, float]] = []  # (field, value, label cx, label cy)
    side_by_side = False
    mids: list[float] = []
    os_y: float | None = None
    for row in page.rows:
        labels = [w for w in row.words if _canon(w)]
        for w in row.words:
            if is_label(w, "OS") and os_y is None and len(row.words) <= 3:
                os_y = w.cy
        seen: dict[str, list[Word]] = {}
        for lw in labels:
            seen.setdefault(_canon(lw), []).append(lw)
        for canon, lws in seen.items():
            if len(lws) >= 2:
                side_by_side = True
                mids.append((lws[0].cx + lws[-1].cx) / 2)
        nums = numeric_words(row)
        for lw in labels:
            canon = _canon(lw)
            v = _value_right_of(lw, nums, SPECS[canon], page.char_h)
            if v is not None:
                hits.append((canon, v, lw.cx, lw.cy))
    if not hits:
        return []
    if side_by_side:
        mid = sum(mids) / len(mids) if mids else page.width / 2
        eye_of = lambda cx, cy: "R" if cx < mid else "L"  # noqa: E731
    else:
        if os_y is None:  # no OS heading read: split between the two K1 labels (or the page middle)
            ys = sorted(cy for c, _, _, cy in hits if c == "K1")
            os_y = (ys[0] + ys[1]) / 2 if len(ys) >= 2 else page.height / 2
        eye_of = lambda cx, cy: "R" if cy < os_y else "L"  # noqa: E731
    found: dict[str, str] = {}
    for canon, v, cx, cy in hits:
        label = f"{_OUT[canon]} ({eye_of(cx, cy)})"
        found.setdefault(label, SPECS[canon].format(v))
    return [{"l": label, "v": found[label]} for label in FIELDS if label in found]


_TEXT_PAIR = re.compile(r"\b(AL|ACD|K1|KI|K2|AXIS|TARGET)\b\s*[:=]?\s*([-+]?\d+(?:\.\d+)?)", re.I)


def parse(text: str) -> list[dict]:
    """Plain-text fallback: label/number pairs in reading order; the first occurrence of each
    label is the right eye, the second the left (OD is printed first on both reports)."""
    counts: dict[str, int] = {}
    found: dict[str, str] = {}
    for m in _TEXT_PAIR.finditer(text.upper()):
        canon = "K1" if m.group(1) == "KI" else m.group(1)
        spec = SPECS[canon]
        v = pick_number([m.group(2)], spec.decimals, spec.lo, spec.hi)
        if v is None:
            continue
        n = counts.get(canon, 0)
        if n >= 2:
            continue
        counts[canon] = n + 1
        found.setdefault(f"{_OUT[canon]} ({'R' if n == 0 else 'L'})", spec.format(v))
    return [{"l": label, "v": found[label]} for label in FIELDS if label in found]
