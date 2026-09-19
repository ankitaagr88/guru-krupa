"""Layout parser for the Huvitz HRK-8000A / YPC-100K slip, which carries BOTH sections:

    [REF]                         [KER]  Index: 1.3375
    <R>   SPH    CYL    AX        <R>    K1      K2     AX
          +0.00  -1.75  170              mm      D      AX
          ...    (several rows)   R1     8.15    41.40  174
    AVG   +0.00  -1.75  170       R2     7.70    43.85   84
    S.E   -0.87                   AVG    7.92    42.62
    <L>   ...                     CYL           -2.45  174
                                  <L>    ...
                                  PD = 66mm

REF takes the AVG row (median of the measurement rows when AVG is unreadable). KER takes the D
column of the R1 row (K1) and R2 row (K2). Values are read by column x-position, so a crumpled slip
whose rows bend still parses. The slip's own redundancy then arbitrates between candidate readings
of an ambiguous glyph (the dot-matrix slashed zero reads as 8/9): S.E = SPH + CYL/2 for REF, and
for KER  AVG = (K1+K2)/2,  CYL = K1-K2,  D = 337.5/mm  (keratometric index 1.3375).
`parse_page` returns both sections; the REF and KER templates each expose their own half and the
other as the twin (see `app.services.readings.process_reading`)."""
from __future__ import annotations

from app.ocr.layout import Page, Row, Word
from app.ocr.templates._page import (AXIS, CYLINDER, DIOPTER, KERATO, PD_MM, Spec, assign_columns, column_tolerance,
                                     eye_of, header_columns, labels_of, median, numeric_words)

REF_FIELDS = ["SPH (R)", "CYL (R)", "AX (R)", "SPH (L)", "CYL (L)", "AX (L)", "PD"]
KER_FIELDS = ["K1 (R)", "K2 (R)", "K1 (L)", "K2 (L)"]

REF_HEADER = {"SPH": ("SPH", "5PH", "SPN", "SPM", "SP"), "CYL": ("CYL", "CVL", "CY", "CYI", "CLY"),
              "AX": ("AX", "AXK", "AXS", "AK", "AX1")}
KER_HEADER = {"MM": ("K1", "KI", "KL", "K", "MM", "MN", "MRN", "MEN", "RM"), "D": ("K2", "KZ", "D", "O"),
              "AX": ("AX", "AXK", "AK")}
REF_SPECS = {"SPH": DIOPTER, "CYL": CYLINDER, "AX": AXIS}
AVG = ("AVG", "AYG", "AVC", "AV", "AVG1", "AV6", "AVO")
SE_ROW = ("SE", "S", "SF", "SE1", "5E")
CYL_ROW = ("CYL", "CVL", "CYI", "CL", "CCVL", "CVLT", "CVVLT", "CYVL", "CVT", "CY1")
SKIP = ("VD", "VO", "FORM", "FORMS", "INDEX")
SE_SPEC = Spec(2, -30.0, 30.0)  # spherical equivalent row
KER_CYL = Spec(2, -12.0, 0.0)  # corneal cylinder row (K1 - K2, always <= 0 as printed)
MM_SPEC = Spec(2, 5.0, 12.0)  # corneal radius
KER_INDEX = 337.5  # D = 337.5 / r(mm) at keratometric index 1.3375


def _section_of(row: Row) -> str | None:
    """`[REF]` / `[KER]` (and their misreads) mark a section; a header row does too."""
    for w in row.words:
        for n in labels_of(w):
            if n in ("REF", "CREF", "IREF", "TREF", "EREF", "REFI", "REF1", "PREF", "REFJ", "LREF"):
                return "REF"
            if n in ("KER", "KFR", "KEP", "KER1", "KERI", "UKER", "UKFP1", "KFP", "KEPI", "KFRI", "KFP1", "UKFRI", "INDEX",
                     "INDEX1"):
                return "KER"
    return None


def _first_labels(row: Row) -> list[str]:
    return labels_of(row.words[0]) if row.words else []


class _Block:
    """One eye's measurements inside a section."""

    def __init__(self, eye: str, columns: dict[str, float], tol: float):
        self.eye = eye
        self.columns = columns
        self.tol = tol
        self.rows: list[dict[str, Word]] = []  # measurement rows, in print order
        self.avg: dict[str, Word] | None = None
        self.se: Word | None = None  # REF: S.E row value
        self.cyl: Word | None = None  # KER: CYL row D value


def _blocks(page: Page) -> tuple[list[_Block], list[_Block], Word | None]:
    ref: list[_Block] = []
    ker: list[_Block] = []
    section: str | None = None
    current: _Block | None = None
    pending_eye: str | None = None
    pd_word: Word | None = None
    for row in page.rows:
        if not row.words:
            continue
        sec = _section_of(row)
        if sec:
            section, current = sec, None
            continue
        firsts = _first_labels(row)
        first = firsts[0] if firsts else ""
        if any(f in ("PD", "PO", "P0", "PDMM") for f in firsts):
            nums = [w for w in numeric_words(row) if PD_MM.pick(w) is not None]
            pd_word = pd_word or (nums[0] if nums else None)
            continue
        eye = next((eye_of(w) for w in row.words if eye_of(w)), None)
        ref_cols = header_columns(row, REF_HEADER)
        ker_cols = header_columns(row, KER_HEADER)
        is_ref_header = len(ref_cols) >= 2 and "SPH" in ref_cols
        is_ker_header = len(ker_cols) >= 2 and not is_ref_header
        if is_ref_header or is_ker_header:
            target = ref if is_ref_header else ker
            if section is None or (is_ref_header and section == "KER") or (is_ker_header and section == "REF"):
                section = "REF" if is_ref_header else "KER"
            if current is not None and current in target and not current.rows and current.avg is None and not eye:
                # second header line ("mm  D  AX" under "K1  K2  AX") refines the same block's columns
                current.columns.update(ref_cols if is_ref_header else ker_cols)
                current.tol = column_tolerance(current.columns, page)
                continue
            eye = eye or pending_eye or ("R" if not target else "L")
            pending_eye = None
            cols = ref_cols if is_ref_header else ker_cols
            current = _Block(eye, cols, column_tolerance(cols, page))
            target.append(current)
            continue
        if eye and not numeric_words(row):
            pending_eye = eye  # bare "<L>" line; header follows
            if current is not None and section == "KER" and current.rows:
                current = None
            continue
        if current is None:
            continue
        if first in SKIP:
            continue
        assigned = assign_columns(row, current.columns, current.tol)
        if any(f in SE_ROW for f in firsts) or first.startswith("S"):
            nums = numeric_words(row)
            if current.se is None and nums:
                current.se = nums[0]
            continue
        if any(f in CYL_ROW for f in firsts):
            if current.cyl is None and "D" in assigned:
                current.cyl = assigned["D"]
            continue
        if not assigned:
            continue
        if any(f in AVG or f.startswith("AV") for f in firsts):
            if current.avg is None:
                current.avg = assigned
            continue
        if current.avg is None:
            current.rows.append(assigned)
            continue
        # After AVG only S.E (REF) and CYL (KER) follow; a crumple can split their label off into its
        # own row, so recognise them by value: a lone number (S.E) / a negative D value (CYL).
        if current in ker and current.cyl is None and "D" in assigned and (KER_CYL.pick(assigned["D"]) or 0) < 0:
            current.cyl = assigned["D"]
        elif current in ref and current.se is None and len(numeric_words(row)) == 1:
            current.se = numeric_words(row)[0]
    return ref, ker, pd_word


def _close(a: float | None, b: float | None, tol: float) -> bool:
    return a is not None and b is not None and abs(a - b) <= tol


def _ref_values(block: _Block) -> dict[str, str]:
    out: dict[str, str] = {}
    picked: dict[str, float] = {}
    for field, spec in REF_SPECS.items():
        value = spec.pick(block.avg.get(field)) if block.avg else None
        if value is None:
            value = median([v for r in block.rows if (v := spec.pick(r.get(field))) is not None])
            if value is not None and spec.step:
                value = round(value / spec.step) * spec.step
        if value is not None:
            picked[field] = value
    # S.E = SPH + CYL/2 arbitrates between candidate readings of the AVG row
    se = SE_SPEC.pick(block.se)
    if se is not None and block.avg and "SPH" in picked and "CYL" in picked:
        best, best_score = None, -1.0
        for sph, s_sph in DIOPTER.ranked(block.avg.get("SPH"))[:4]:
            for cyl, s_cyl in CYLINDER.ranked(block.avg.get("CYL"))[:4]:
                score = s_sph + s_cyl + (3.0 if _close(sph + cyl / 2, se, 0.011) else 0.0)
                if score > best_score:
                    best, best_score = (sph, cyl), score
        if best is not None:
            picked["SPH"], picked["CYL"] = best
    for field, value in picked.items():
        out[field] = REF_SPECS[field].format(value)
    return out


def _ker_values(block: _Block) -> dict[str, str]:
    """K1 = D column of the 1st measurement row (R1), K2 = 2nd (R2), arbitrated by the slip's own
    AVG / CYL rows and the mm column: AVG = (K1+K2)/2, CYL = K1-K2, D = 337.5/mm."""
    rows = [r for r in block.rows if "D" in r or "MM" in r]
    if len([r for r in rows if "D" in r]) < 2 and block.avg and "D" in block.avg:  # rows merged
        rows = rows + [block.avg]
    d_words = [r.get("D") for r in rows][:2]
    mm = [MM_SPEC.pick(r.get("MM")) for r in rows][:2]
    avg = KERATO.pick(block.avg.get("D")) if block.avg else None
    cyl = KER_CYL.pick(block.cyl)
    k1s = KERATO.ranked(d_words[0])[:4] if len(d_words) >= 1 else []
    k2s = KERATO.ranked(d_words[1])[:4] if len(d_words) >= 2 else []
    out: dict[str, str] = {}
    if k1s and k2s:
        best, best_score = None, -1.0
        for k1, s1 in k1s:
            for k2, s2 in k2s:
                score = s1 + s2
                score += 3.0 if _close((k1 + k2) / 2, avg, 0.011) else 0.0
                score += 3.0 if _close(k1 - k2, cyl, 0.011) else 0.0
                score += 1.5 if len(mm) >= 1 and mm[0] and _close(KER_INDEX / mm[0], k1, 0.06) else 0.0
                score += 1.5 if len(mm) >= 2 and mm[1] and _close(KER_INDEX / mm[1], k2, 0.06) else 0.0
                if score > best_score:
                    best, best_score = (k1, k2), score
        out["K1"], out["K2"] = KERATO.format(best[0]), KERATO.format(best[1])
    elif k1s:
        out["K1"] = KERATO.format(k1s[0][0])
    return out


def _by_eye(blocks: list[_Block]) -> dict[str, _Block]:
    out: dict[str, _Block] = {}
    for b in blocks:
        out.setdefault(b.eye, b)
    if len(blocks) >= 2 and len(out) == 1:  # eye tokens unreadable: print order is R then L
        out = {"R": blocks[0], "L": blocks[1]}
    return out


def parse_page(page: Page) -> dict[str, list[dict]]:
    """-> {"ref": [{l, v}...], "ker": [{l, v}...]} in the templates' field order."""
    ref_blocks, ker_blocks, pd_word = _blocks(page)
    ref: list[dict] = []
    for eye, block in _by_eye(ref_blocks).items():
        for field, value in _ref_values(block).items():
            ref.append({"l": f"{field} ({eye})", "v": value})
    pd = PD_MM.pick(pd_word)
    if pd is not None:
        ref.append({"l": "PD", "v": f"{int(pd)}mm"})
    ker: list[dict] = []
    for eye, block in _by_eye(ker_blocks).items():
        for field, value in _ker_values(block).items():
            ker.append({"l": f"{field} ({eye})", "v": value})
    order_ref = {label: i for i, label in enumerate(REF_FIELDS)}
    order_ker = {label: i for i, label in enumerate(KER_FIELDS)}
    return {"ref": sorted([v for v in ref if v["l"] in order_ref], key=lambda v: order_ref[v["l"]]),
            "ker": sorted([v for v in ker if v["l"] in order_ker], key=lambda v: order_ker[v["l"]])}


def parse_ref_page(page: Page) -> list[dict]:
    return parse_page(page)["ref"]


def parse_ker_page(page: Page) -> list[dict]:
    return parse_page(page)["ker"]
