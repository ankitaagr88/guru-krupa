"""Shared tokeniser/extractor for machine printouts. Every parser is: normalise OCR text ->
walk it line by line -> pick (field, eye) -> number. Tolerates the three layouts the
autorefractors / tonometers print:

    label-major:  IOP   R 13   L 12          (or  IOP 13 12)
    eye-major:    <R>  SPH -0.25 CYL -2.00 AX 166      (or a section header then one field per line)
    column:       SPH   CYL   AX  /  R -0.25 -2.00 166  /  L -0.25 -1.75 164
"""
import re
from typing import Callable

# Tesseract 5's LSTM drops inter-word spaces when `tessedit_char_whitelist` is set, which destroys
# the label/value tokenisation below, so templates use plain "block of text" segmentation and the
# parsers do the character clean-up instead.
TESS_PSM6 = "--psm 6"

EYES = {"R": "R", "OD": "R", "RIGHT": "R", "L": "L", "OS": "L", "LEFT": "L"}
_UNITS = {"MM", "MMHG", "HG", "UM", "D", "S", "SEC", "°", "DEG"}
_NUM_RE = re.compile(r"([-+]?\d+(?:\.\d+)?)")
_TOKEN_RE = re.compile(r"[-+]?\d+(?:\.\d+)?|[A-Z0-9°]+|[<>\[\]()]")
_CONFUSABLE = str.maketrans({"O": "0", "Q": "0", "D": "0", "@": "0", "I": "1", "L": "1", "|": "1", "!": "1",
                             "S": "5", "B": "8", "Z": "2", "G": "6", ",": "."})
_K_RE = re.compile(r"K(?:([1IL|!]{1,2})|[2Z])")
_NUMISH = re.compile(r"[-+]?[0-9OQD@IL|!SBZG.,]*[0-9][0-9OQD@IL|!SBZG.,]*")


def fix_token(tok: str) -> str:
    """OCR noise inside a number: O->0, l/I->1, S->5, B->8, Z->2, comma decimal."""
    if _NUMISH.fullmatch(tok):
        return tok.translate(_CONFUSABLE)
    return tok


def normalise(text: str) -> list[str]:
    """Upper-case lines with dashes unified, signs glued to digits and digit-lookalikes fixed."""
    text = text.upper()
    for dash in ("−", "–", "—", "_"):
        text = text.replace(dash, "-")
    lines = []
    for raw in text.splitlines():
        line = re.sub(r"[:=]", " ", raw)  # "SPH:-0.25" / "PD=66" -> separate words
        line = re.sub(r"([-+])\s+(?=[0-9OQIL|SBZ])", r"\1", line)  # "- 0.25" -> "-0.25"
        line = re.sub(r"(\d)\s*[.,]\s*(\d)", r"\1.\2", line)  # "0 . 25" / "0,25" -> "0.25"
        line = " ".join(fix_token(t) for t in line.split()).strip()
        if line:
            lines.append(line)
    return lines


def tokenise(line: str, labels: dict[str, str]) -> list[tuple[str, str]]:
    """-> [('label', canonical) | ('eye', 'R'/'L') | ('num', '-0.25')]; units and junk are dropped."""
    out: list[tuple[str, str]] = []

    def classify(tok: str) -> tuple[str, str] | None:
        if _NUM_RE.fullmatch(tok):
            return ("num", tok)
        if tok in labels:
            return ("label", labels[tok])
        if tok in EYES:
            return ("eye", EYES[tok])
        k = _K_RE.fullmatch(tok)  # "Kl", "K1l", "KZ" -> K1 / K2
        if k:
            canon = "K1" if k.group(1) else "K2"
            if canon in labels:
                return ("label", canon)
        return None  # units and anything else (machine name, date, "PATIENT") are ignored

    for word in line.split():
        word = word.strip("<>[]():=")
        hit = classify(word)
        if hit:
            out.append(hit)
            continue
        for tok in _TOKEN_RE.findall(word):  # "SPH:-0.25", "66MM", "K1=42.70"
            hit = classify(tok)
            if hit:
                out.append(hit)
    return out


def extract(text: str, fields: list[str], aliases: dict[str, str] | None = None,
            eyeless: tuple[str, ...] = ("PD",)) -> dict[tuple[str, str | None], str]:
    """Return {(field, eye): value}. `fields` are canonical labels ("SPH", "PD"); `aliases` maps
    OCR spellings to canonical ("AXIS" -> "AX", "5PH" -> "SPH"); `eyeless` fields have no R/L."""
    labels = {f: f for f in fields}
    labels.update(aliases or {})
    found: dict[tuple[str, str | None], str] = {}
    current_eye: str | None = None
    columns: list[str] | None = None
    implicit_rows = 0  # eye-less rows/lines seen so far -> 1st is R, 2nd is L

    def put(field: str, eye: str | None, value: str) -> None:
        found.setdefault((field, None if field in eyeless else eye), value)

    for line in normalise(text):
        toks = tokenise(line, labels)
        if not toks:
            continue
        line_eye: str | None = None
        if len(toks) >= 2 and all(k == "eye" for k, _ in toks):  # "R  L" column header
            current_eye = None
            continue
        if toks[0][0] == "eye":
            line_eye = toks[0][1]
            current_eye = line_eye
            toks = toks[1:]
            if not toks:  # bare section header like "<R>"
                continue
        kinds = {k for k, _ in toks}
        if "label" in kinds and "num" not in kinds:  # header row -> remember column order
            columns = [v for k, v in toks if k == "label"]
            continue
        if "label" not in kinds:
            if not columns:
                continue
            nums = [v for k, v in toks if k == "num"]
            eye = line_eye
            if eye is None:
                eye = "R" if implicit_rows == 0 else "L"
                implicit_rows += 1
            for field, value in zip(columns, nums):
                put(field, eye, value)
            continue
        # label-driven walk: LABEL [R] n [L] n | LABEL n n | LABEL n
        used_implicit = False
        i = 0
        while i < len(toks):
            kind, field = toks[i]
            i += 1
            if kind != "label":
                continue
            group: list[tuple[str, str]] = []
            while i < len(toks) and toks[i][0] != "label":
                group.append(toks[i])
                i += 1
            nums = [v for k, v in group if k == "num"]
            if not nums:
                continue
            if field in eyeless:
                put(field, None, nums[0])
                continue
            if any(k == "eye" for k, _ in group):
                pending: str | None = None
                for k, v in group:
                    if k == "eye":
                        pending = v
                    elif pending:
                        put(field, pending, v)
                        pending = None
                continue
            if line_eye or current_eye:
                put(field, line_eye or current_eye, nums[0])
            elif len(nums) >= 2:
                put(field, "R", nums[0])
                put(field, "L", nums[1])
            else:
                put(field, "R" if implicit_rows == 0 else "L", nums[0])
                used_implicit = True
        if used_implicit:
            implicit_rows += 1
    return found


def fmt_diopter(v: str) -> str:
    n = float(v)
    s = f"{n:.2f}"
    return ("+" + s) if v.startswith("+") and n > 0 else s


def fmt_int(v: str) -> str:
    n = float(v)
    return str(int(round(n))) if abs(n - round(n)) < 1e-6 else v


def to_values(found: dict[tuple[str, str | None], str], order: list[str],
              formatters: dict[str, Callable[[str], str]] | None = None) -> list[dict]:
    """Map extracted pairs onto the machine's display labels in the mockup order.
    `order` entries look like "SPH (R)", "PD"."""
    formatters = formatters or {}
    out = []
    for label in order:
        m = re.fullmatch(r"(.+?)\s*\((R|L)\)", label)
        field, eye = (m.group(1).upper(), m.group(2)) if m else (label.upper(), None)
        v = found.get((field, eye))
        if v is None:
            continue
        fmt = formatters.get(field)
        try:
            v = fmt(v) if fmt else v
        except ValueError:
            pass
        out.append({"l": label, "v": v})
    return out
