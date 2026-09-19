"""Helpers for the layout-aware parsers (`parse_page`): fuzzy label matching, eye tokens, and
assigning the numbers of a row to header columns by x-position."""
from __future__ import annotations

import re
from dataclasses import dataclass

from app.ocr.layout import Page, Row, Word, fmt, pick_number, ranked_numbers

_PUNCT = re.compile(r"[^A-Z0-9]")


@dataclass(frozen=True)
class Spec:
    """Format + plausible range of one numeric field, used to repair/vote a word's readings."""
    decimals: int
    lo: float
    hi: float
    step: float | None = None
    signed: bool = False  # print "+0.25" (the auto-refractors always print the sign)

    def pick(self, word: Word | None) -> float | None:
        if word is None:
            return None
        return pick_number(word.readings, self.decimals, self.lo, self.hi, self.step)

    def ranked(self, word: Word | None) -> list[tuple[float, float]]:
        if word is None:
            return []
        return ranked_numbers(word.readings, self.decimals, self.lo, self.hi, self.step)

    def format(self, value: float) -> str:
        return fmt(value, self.decimals, self.signed)

    def read(self, word: Word | None) -> str | None:
        v = self.pick(word)
        return None if v is None else self.format(v)


DIOPTER = Spec(2, -25.0, 25.0, 0.25, signed=True)
CYLINDER = Spec(2, -10.0, 10.0, 0.25, signed=True)
AXIS = Spec(0, 0, 180)
KERATO = Spec(2, 35.0, 55.0)
PD_MM = Spec(0, 40, 80)


def norm_label(word: Word | str) -> str:
    text = word if isinstance(word, str) else word.text
    return _PUNCT.sub("", text.upper())


def labels_of(word: Word | str) -> list[str]:
    """Normalised spellings from every pass (reference first), so a label misread at the reference
    scale ("SPUH") still matches when another scale read "SPH"."""
    if isinstance(word, str):
        return [norm_label(word)]
    out: list[str] = []
    for r in word.readings:
        n = _PUNCT.sub("", r.upper())
        if n and n not in out:
            out.append(n)
    return out


def is_label(word: Word | str, *names: str) -> bool:
    return any(n in names for n in labels_of(word))


def match_label(word: Word | str, spellings: dict[str, tuple[str, ...]]) -> str | None:
    """Canonical name whose spellings include one of the word's readings (reference reading wins)."""
    for n in labels_of(word):
        for canon, names in spellings.items():
            if n in names:
                return canon
    return None


def eye_of(word: Word | str) -> str | None:
    """`<R>` / `<L>` / `<RIGHT>` / `<LEFT>` and their misreads (`<T>`, `<TT>`, `<UL>`, `<B>`, `<l>`).
    Anything in angle brackets counts: with an R it is the right eye, otherwise the left."""
    text = word if isinstance(word, str) else word.text
    t = text.upper().strip()
    if not (t.startswith("<") or t.endswith(">")):
        return None
    inner = _PUNCT.sub("", t)
    if not inner or len(inner) > 5:
        return None
    if inner in ("R", "RIGHT", "OD") or (inner.startswith("R") and "L" not in inner):
        return "R"
    return "L"


def numeric_words(row: Row) -> list[Word]:
    """Words that carry a number in any of their readings (so `-?` with alt `-2.00` counts)."""
    return [w for w in row.words if any(re.search(r"\d", r) for r in w.readings)]


def assign_columns(row: Row, columns: dict[str, float], tol: float) -> dict[str, Word]:
    """Match the row's numeric words to header columns by nearest x-centre (greedy, closest pair
    first); a word further than `tol` from every column is left out."""
    words = numeric_words(row)
    pairs = sorted((abs(w.cx - x), name, w) for name, x in columns.items() for w in words if abs(w.cx - x) <= tol)
    out: dict[str, Word] = {}
    used: set[int] = set()
    for _, name, w in pairs:
        if name in out or id(w) in used:
            continue
        out[name] = w
        used.add(id(w))
    return out


def header_columns(row: Row, labels: dict[str, tuple[str, ...]]) -> dict[str, float]:
    """{canonical: x-centre} for the header labels found in the row (`labels` maps canonical name
    to accepted spellings)."""
    out: dict[str, float] = {}
    for w in row.words:
        canon = match_label(w, labels)
        if canon and canon not in out:
            out[canon] = w.cx
    return out


def column_tolerance(columns: dict[str, float], page: Page) -> float:
    xs = sorted(columns.values())
    gaps = [b - a for a, b in zip(xs, xs[1:])]
    return (min(gaps) * 0.5) if gaps else page.char_h * 4


def median(values: list[float]) -> float | None:
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2
