"""Per-field-type validation. Each function returns (ok, cleaned_value)."""
from __future__ import annotations

import re
import unicodedata

from app.config import Question


def normalize_digits(text: str) -> str:
    """Turn Gujarati/Devanagari/other Unicode digits into ASCII digits (૪૫ -> 45)."""
    out = []
    for ch in text:
        d = unicodedata.digit(ch, None)
        out.append(str(d) if d is not None else ch)
    return "".join(out)


def validate_text(q: Question, text: str) -> tuple[bool, str]:
    cleaned = " ".join(text.split())
    if len(cleaned) < q.min_length:
        return False, cleaned
    return True, cleaned


def validate_number(q: Question, text: str) -> tuple[bool, int | None]:
    m = re.search(r"-?\d+", normalize_digits(text))
    if not m:
        return False, None
    value = int(m.group())
    if q.min is not None and value < q.min:
        return False, None
    if q.max is not None and value > q.max:
        return False, None
    return True, value


_PHONE_STRIP = re.compile(r"[\s\-\(\)\.]")


def validate_phone(q: Question, text: str) -> tuple[bool, str | None]:
    """Indian mobile: 10 digits starting 6-9, optional +91 / 91 / 0 prefix. Stored as 10 digits."""
    s = _PHONE_STRIP.sub("", normalize_digits(text))
    if s.startswith("+91"):
        s = s[3:]
    elif s.startswith("91") and len(s) == 12:
        s = s[2:]
    elif s.startswith("0") and len(s) == 11:
        s = s[1:]
    if re.fullmatch(r"[6-9]\d{9}", s):
        return True, s
    return False, None


def validate_choice(q: Question, language: str, text: str | None, selected_id: str | None):
    """Accept a tapped id, or typed text matching a value / label / 1-based number."""
    if selected_id is not None:
        for c in q.choices:
            if c.value == selected_id:
                return True, c.value
    if text:
        t = text.strip().casefold()
        for i, c in enumerate(q.choices, start=1):
            labels = {c.value.casefold(), *(lbl.casefold() for lbl in c.label.values())}
            if t in labels or t == str(i) or normalize_digits(t) == str(i):
                return True, c.value
    return False, None
