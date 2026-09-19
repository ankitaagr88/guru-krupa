"""Layout-aware recognition for photographed thermal-paper slips.

Tesseract's own line finder breaks on the clinic's real captures (crumpled paper bends a row by
half a line, handwriting and creases cross the text, the printer's slashed zero reads as `@`/`Q`).
So this module does the segmentation itself and only asks Tesseract to read:

    binary image -> connected components (creases / strokes / specks dropped) -> words (horizontal
    dilation) -> rows (chained vertical overlap on locally de-skewed coordinates, so a bent row stays
    one row) -> every row pasted straight into one tall "tile" image -> Tesseract on the tile at
    several scales -> per word: the reading at the reference pass plus the alternatives (`alts`)

Parsers work on the resulting `Page` of `Row`s of `Word`s with page x-positions (the printouts are
column-major: a value belongs to the header above it, not to a label beside it) and resolve each
number by voting over the alternative readings after a format-aware repair (see `pick_number`).
Every step is a small pure function so it can be tuned against tests/ocr_samples/.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

import cv2
import numpy as np
import pytesseract
from pytesseract import Output

from app.ocr import configure_tesseract
from app.ocr.preprocess import estimate_skew

# Tile passes as (scale, thicken strokes); the first is the reference pass, the rest give `alts`.
# Chosen on tests/ocr_samples by token accuracy: thickening the dot-matrix strokes reads best.
PASSES = ((1.0, True), (0.7, False), (1.2, True), (0.85, True), (1.4, True))
WORD_GAP = 0.8  # horizontal dilation as a fraction of char height: dot-matrix glyphs are widely spaced
ROW_OVERLAP = 0.45  # min vertical overlap (fraction of the shorter word) to chain two words into a row
BAND_CHARS = 14  # local skew is estimated on horizontal bands this many char heights tall
BAND_MIN_INK = 8  # ink in char-height^2 units (~ one short line) a band needs before its angle is trusted
BAND_MAX_ANGLE = 5.0  # degrees; the global deskew already removed the bulk, bands only fix residual warp
_NUMISH = re.compile(r"^[-+~(]?[0-9OQD@IL|!SBZGAaeo.,*°)]*[0-9OQ@][0-9OQD@IL|!SBZGAaeo.,*°)]*$")
_NUM = re.compile(r"[-+]?\d+(?:\.\d+)?")
_CONFUSABLE = str.maketrans({"O": "0", "Q": "0", "D": "0", "@": "0", "I": "1", "L": "1", "|": "1", "!": "1",
                             "S": "5", "B": "8", "Z": "2", "G": "6", "A": "4", ",": ".", "~": "-"})


@dataclass
class Word:
    text: str  # cleaned reading at the reference scale (upper-cased, confusables mapped in numbers)
    x0: int
    x1: int
    y0: int
    y1: int
    row: int
    conf: float = 0.0
    raw: str = ""  # reading before clean-up
    alts: list[str] = field(default_factory=list)  # cleaned readings from the other scales

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def number(self) -> float | None:
        m = _NUM.search(self.text)
        return float(m.group()) if m else None

    @property
    def is_number(self) -> bool:
        return _NUM.fullmatch(self.text.strip("*°()")) is not None

    @property
    def readings(self) -> list[str]:
        return [self.text, *self.alts]


@dataclass
class Row:
    index: int
    y: float
    words: list[Word] = field(default_factory=list)

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)

    def numbers(self) -> list[Word]:
        return [w for w in self.words if w.is_number]


@dataclass
class Page:
    rows: list[Row]
    width: int
    height: int
    char_h: float

    @property
    def words(self) -> list[Word]:
        return [w for r in self.rows for w in r.words]

    @property
    def text(self) -> str:
        return "\n".join(r.text for r in self.rows if r.words)


# ---------------------------------------------------------------- segmentation (pure numpy/cv2)

@dataclass
class Box:
    id: int
    x0: int
    y0: int
    x1: int
    y1: int
    cy_adj: float = 0.0  # centre y after local skew compensation (used for row chaining only)

    @property
    def h(self) -> int:
        return self.y1 - self.y0

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2


def char_height(stats: np.ndarray, shape: tuple[int, int]) -> float:
    """Median height of glyph-sized connected components (ignores specks, rules and blobs)."""
    h, w = shape
    hs = [s[3] for s in stats[1:] if 6 <= s[3] <= h * 0.05 and s[2] <= w * 0.2 and s[4] >= 10]
    return float(np.median(hs)) if hs else 30.0


def drop_junk(inv: np.ndarray, labels: np.ndarray, stats: np.ndarray, ch: float) -> np.ndarray:
    """Erase creases, handwriting strokes, rules and specks: anything taller than 1.6 glyphs, wider
    than a third of the page, long-and-hollow (a stroke), or smaller than a decimal point."""
    w_page = inv.shape[1]
    out = inv.copy()
    for i in range(1, len(stats)):
        x, y, w, h, area = stats[i]
        stroke = max(w, h) > ch * 2.5 and area < 0.15 * w * h
        if w > w_page * 0.35 or h > ch * 1.6 or stroke or area < 4:
            out[labels == i] = 0
    return out


def group_words(clean: np.ndarray, ch: float) -> tuple[np.ndarray, list[Box]]:
    """Dilate horizontally so characters of one word touch; each blob is a word. Returns the
    word-label map (for masking) and tight boxes."""
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (int(ch * WORD_GAP) | 1, 3))
    n, lab, st, _ = cv2.connectedComponentsWithStats(cv2.dilate(clean, k), connectivity=8)
    boxes: list[Box] = []
    for i in range(1, n):
        x, y, w, h, _ = st[i]
        ys, xs = np.nonzero(clean[y:y + h, x:x + w])
        if len(xs) < 6:
            continue
        boxes.append(Box(i, x + int(xs.min()), y + int(ys.min()), x + int(xs.max()) + 1, y + int(ys.max()) + 1))
    return lab, boxes


def local_skew(binary: np.ndarray, ch: float) -> list[tuple[float, float]]:
    """[(band centre y, correction angle)] estimated on overlapping horizontal bands, so a crumpled
    slip whose top and bottom halves tilt differently still gets rows chained correctly."""
    h = binary.shape[0]
    band = int(ch * BAND_CHARS)
    if band >= h:
        return [(h / 2, _band_angle(binary, ch))]
    out = []
    for y in range(0, h - band // 2, band // 2):
        crop = binary[y:min(h, y + band)]
        out.append((y + crop.shape[0] / 2, _band_angle(crop, ch)))
    return out


def _band_angle(crop: np.ndarray, ch: float) -> float:
    """A band's residual angle, or 0 when it holds too little ink for a reliable estimate."""
    ink = cv2.countNonZero(cv2.bitwise_not(crop)) / max(ch * ch, 1.0)
    if ink < BAND_MIN_INK:
        return 0.0
    angle = estimate_skew(crop)
    return angle if abs(angle) <= BAND_MAX_ANGLE else 0.0


def _angle_at(y: float, bands: list[tuple[float, float]]) -> float:
    if not bands:
        return 0.0
    if y <= bands[0][0]:
        return bands[0][1]
    for (y0, a0), (y1, a1) in zip(bands, bands[1:]):
        if y0 <= y <= y1:
            t = (y - y0) / max(1e-6, y1 - y0)
            return a0 + t * (a1 - a0)
    return bands[-1][1]


def compensate(boxes: list[Box], bands: list[tuple[float, float]], width: int) -> None:
    """Set `cy_adj`: the centre y each word would have if its band were rotated straight."""
    for b in boxes:
        angle = _angle_at(b.cy, bands)
        b.cy_adj = b.cy - math.tan(math.radians(angle)) * ((b.x0 + b.x1) / 2 - width / 2)


def group_rows(boxes: list[Box]) -> list[list[Box]]:
    """Chain words into rows by (skew-compensated) vertical overlap with their nearest horizontal
    neighbour, so a row bent by a crumple is still one row."""
    rows: list[list[Box]] = []
    for b in sorted(boxes, key=lambda b: b.cy_adj):
        best, best_ov = None, 0.0
        for r in rows:
            near = min(r, key=lambda q: min(abs(q.x0 - b.x1), abs(b.x0 - q.x1)))
            ov = min(b.cy_adj + b.h / 2, near.cy_adj + near.h / 2) - max(b.cy_adj - b.h / 2, near.cy_adj - near.h / 2)
            if ov > ROW_OVERLAP * min(b.h, near.h) and ov > best_ov:
                best, best_ov = r, ov
        if best is not None:
            best.append(b)
        else:
            rows.append([b])
    rows.sort(key=lambda r: float(np.mean([q.cy_adj for q in r])))
    for r in rows:
        r.sort(key=lambda q: q.x0)
    return rows


def segment(binary: np.ndarray) -> tuple[np.ndarray, list[list[Box]], float]:
    inv = cv2.bitwise_not(binary)
    n, lab, st, _ = cv2.connectedComponentsWithStats(inv, connectivity=8)
    ch = char_height(st, binary.shape)
    clean = drop_junk(inv, lab, st, ch)
    wlab, boxes = group_words(clean, ch)
    compensate(boxes, local_skew(binary, ch), binary.shape[1])
    return wlab, group_rows(boxes), ch


# ---------------------------------------------------------------- tiling

@dataclass
class Slot:
    y0: int
    y1: int
    x_off: int  # page x = tile x + x_off
    row: int


def _paste_row(binary: np.ndarray, wlab: np.ndarray, row: list[Box], ch: float, pad: int) -> np.ndarray:
    """Render one row straight: every full-height word bottom-aligned to a common baseline; small
    fragments (a lone '.' or '-') keep their offset relative to the nearest full-height neighbour."""
    x0, x1 = row[0].x0, max(b.x1 for b in row)
    hmax = max(b.h for b in row)
    tile = np.full((hmax + 2 * pad, x1 - x0 + 2 * pad), 255, np.uint8)
    base = pad + hmax
    full = [b for b in row if b.h >= 0.6 * ch]
    for b in row:
        crop = np.where(wlab[b.y0:b.y1, b.x0:b.x1] == b.id, binary[b.y0:b.y1, b.x0:b.x1], 255).astype(np.uint8)
        if b in full or not full:
            ty = base - b.h
        else:
            ref = min(full, key=lambda q: abs(q.x0 - b.x0))
            ty = max(pad, min((base - ref.h) + (b.y0 - ref.y0), base - b.h))
        tx = pad + b.x0 - x0
        region = tile[ty:ty + b.h, tx:tx + b.x1 - b.x0]
        np.minimum(region, crop, out=region)
    return tile


def render_tile(binary: np.ndarray, wlab: np.ndarray, rows: list[list[Box]], ch: float) -> tuple[np.ndarray, list[Slot]]:
    """Stack the straightened rows vertically with generous white gaps."""
    pad = int(ch * 0.7)
    pieces = [(_paste_row(binary, wlab, row, ch, pad), Slot(0, 0, row[0].x0 - pad, ri)) for ri, row in enumerate(rows)]
    if not pieces:
        return np.full((10, 10), 255, np.uint8), []
    width = max(p.shape[1] for p, _ in pieces)
    tile = np.full((sum(p.shape[0] for p, _ in pieces), width), 255, np.uint8)
    y = 0
    for img, slot in pieces:
        tile[y:y + img.shape[0], :img.shape[1]] = img
        slot.y0, slot.y1 = y, y + img.shape[0]
        y += img.shape[0]
    return tile, [s for _, s in pieces]


Hit = tuple[int, int, str, float]  # page x0, page x1, text, conf


def ocr_tile(tile: np.ndarray, slots: list[Slot], config: str, scale: float = 1.0,
             thicken: bool = False) -> dict[int, list[Hit]]:
    """Run Tesseract on the tile (optionally rescaled / strokes thickened) -> {slot index: hits by x}."""
    configure_tesseract()
    img = cv2.erode(tile, np.ones((2, 2), np.uint8)) if thicken else tile
    if abs(scale - 1.0) > 1e-3:
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA)
        _, img = cv2.threshold(img, 127, 255, cv2.THRESH_BINARY)
    d = pytesseract.image_to_data(img, lang="eng", config=config, output_type=Output.DICT)
    out: dict[int, list[Hit]] = {}
    for j, text in enumerate(d["text"]):
        text = text.strip()
        if not text:
            continue
        cy = (d["top"][j] + d["height"][j] / 2) / scale
        si = next((i for i, s in enumerate(slots) if s.y0 <= cy < s.y1), None)
        if si is None:
            continue
        x0 = int(d["left"][j] / scale) + slots[si].x_off
        out.setdefault(si, []).append((x0, x0 + int(d["width"][j] / scale), text, float(d["conf"][j])))
    for v in out.values():
        v.sort()
    return out


# ---------------------------------------------------------------- assembly

def clean_token(tok: str) -> str:
    """Upper-case; inside a number-like token map the dot-matrix confusables (O/@/Q -> 0, A -> 4...)."""
    tok = tok.upper()
    if _NUMISH.match(tok):
        return tok.translate(_CONFUSABLE).strip("()")
    return tok


def _overlap(a0: int, a1: int, b0: int, b1: int) -> float:
    inter = min(a1, b1) - max(a0, b0)
    return inter / max(1, min(a1 - a0, b1 - b0)) if inter > 0 else 0.0


def merge_fragments(hits: list[Hit], ch: float) -> list[Hit]:
    """Re-join a number Tesseract split at the dot-matrix decimal point ("AA" + ".65", "8." + "14",
    "-2" + ".00"): adjacent pieces closer than one char height whose union looks numeric."""
    out: list[Hit] = []
    for hit in hits:
        if out:
            x0, x1, text, conf = out[-1]
            nx0, nx1, ntext, nconf = hit
            joinable = (ntext.startswith(".") or text.endswith((".", "-")) or (text.upper().translate(_CONFUSABLE).isdigit() and "." in ntext))
            if nx0 - x1 < 1.0 * ch and joinable and _NUMISH.match((text + ntext).upper()):
                out[-1] = (x0, max(x1, nx1), text + ntext, min(conf, nconf))
                continue
        out.append(hit)
    return out


def read_page(binary: np.ndarray, psm: int = 6, passes: tuple[tuple[float, bool], ...] = PASSES) -> Page:
    """Binary (black on white) image -> Page. One Tesseract call per pass."""
    wlab, rows, ch = segment(binary)
    if not rows:
        return Page([], binary.shape[1], binary.shape[0], ch)
    tile, slots = render_tile(binary, wlab, rows, ch)
    passes = [{si: merge_fragments(hits, ch) for si, hits in ocr_tile(tile, slots, f"--psm {psm}", sc, th).items()}
              for sc, th in passes]
    page_rows: list[Row] = []
    for si, slot in enumerate(slots):
        boxes = rows[slot.row]
        row = Row(index=slot.row, y=float(np.mean([b.cy for b in boxes])))
        for x0, x1, text, conf in passes[0].get(si, []):
            word = Word(clean_token(text), x0, x1, min(b.y0 for b in boxes), max(b.y1 for b in boxes), slot.row,
                        conf, raw=text)
            for alt_pass in passes[1:]:
                pieces = [t for ax0, ax1, t, _ in alt_pass.get(si, []) if _overlap(x0, x1, ax0, ax1) > 0.5]
                if pieces:
                    word.alts.append(clean_token("".join(pieces)))
            row.words.append(word)
        page_rows.append(row)
    return Page(page_rows, binary.shape[1], binary.shape[0], ch)


# ---------------------------------------------------------------- number resolution

def candidates(reading: str, decimals: int, lo: float, hi: float) -> list[float]:
    """Plausible values a noisy reading could mean, most likely first. Repairs the dot-matrix
    failure modes seen on the real slips: a doubled trailing zero ("44.400"), a phantom leading
    digit ("144.49"), a lost decimal point ("4440" for a 2-decimal field), a stray sign/dash."""
    s = reading.upper().translate(_CONFUSABLE).strip("*°()").replace("--", "-")
    s = re.sub(r"(?<=\d)-(?=\d)", "", s)  # "42.-20" -> "42.20"
    s = re.sub(r"[^0-9.+-]", "", s)
    if not s or not re.search(r"\d", s):
        return []
    sign = -1.0 if s.startswith("-") else 1.0
    body = s.lstrip("+-").replace("+", "").replace("-", "")
    if body.count(".") > 1:
        head, _, tail = body.partition(".")
        body = head + "." + tail.replace(".", "")
    int_part, _, frac = body.partition(".")
    forms: list[str] = []
    if decimals and len(frac) > decimals:
        forms.append(int_part + "." + frac[:decimals])  # doubled / trailing junk digit
        forms.append(int_part + "." + frac[:decimals - 1] + frac[-1])  # doubled middle digit
    else:
        forms.append(body)
    if decimals and not frac and len(int_part) > decimals:
        forms.append(int_part[:-decimals] + "." + int_part[-decimals:])  # lost decimal point
    if len(int_part) > 1:
        forms.append(int_part[1:] + ("." + frac if frac else ""))  # phantom leading digit
        forms.append(int_part[:-1] + ("." + frac if frac else ""))  # doubled leading digit
    out: list[float] = []
    for f in forms:
        try:
            v = sign * float(f)
        except ValueError:
            continue
        if decimals == 0 and (f.count(".") or abs(v - round(v)) > 1e-9):
            continue
        if lo <= v <= hi and v not in out:
            out.append(v)
    return out


def ranked_numbers(readings: list[str], decimals: int, lo: float, hi: float,
                   step: float | None = None) -> list[tuple[float, float]]:
    """[(value, score)] best first. The first plausible form of each reading scores 1, the other
    repair forms 0.25 (so they can win only through a consistency check, see `_hrk`); ties keep
    reading order (reference pass first)."""
    score: dict[float, float] = {}
    order: list[float] = []
    for r in readings:
        cands = candidates(r, decimals, lo, hi)
        if step:
            cands = [c for c in cands if abs(c / step - round(c / step)) < 1e-6]
        for i, c in enumerate(cands):
            score[c] = score.get(c, 0.0) + (1.0 if i == 0 else 0.25)
            if c not in order:
                order.append(c)
    return sorted(((v, score[v]) for v in order), key=lambda vs: (-vs[1], order.index(vs[0])))


def pick_number(readings: list[str], decimals: int, lo: float, hi: float, step: float | None = None) -> float | None:
    """Vote over the readings of one word (see `ranked_numbers`)."""
    ranked = ranked_numbers(readings, decimals, lo, hi, step)
    return ranked[0][0] if ranked else None


def fmt(value: float, decimals: int, sign: bool = False) -> str:
    s = f"{value:.{decimals}f}"
    return ("+" + s) if sign and value >= 0 and not s.startswith("-") else s
