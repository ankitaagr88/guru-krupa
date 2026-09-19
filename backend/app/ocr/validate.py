"""Plausibility ranges per field. A value outside its range is kept but flagged `ok: false`
so the UI highlights it for correction (spec B6: "flag low-confidence")."""
import re

# base label -> (min, max, step or None, integer?)
RANGES: dict[str, tuple[float, float, float | None, bool]] = {
    "SPH": (-25.0, 25.0, 0.25, False),
    "CYL": (-10.0, 10.0, 0.25, False),
    "AX": (0, 180, None, True),
    "AXS": (0, 180, None, True),
    "PD": (40, 80, None, False),
    "IOP": (5, 60, None, False),
    "CIOP": (5, 60, None, False),
    "CCT": (350, 700, None, True),
    "K1": (35.0, 55.0, None, False),
    "K2": (35.0, 55.0, None, False),
    "TBUT": (0, 60, None, False),
    "SCHIMER": (0, 40, None, False),
}

_NUM = re.compile(r"[-+]?\d+(?:\.\d+)?")


def base_label(label: str) -> str:
    """'SPH (R)' -> 'SPH', 'Schimer (L)' -> 'SCHIMER'."""
    return re.sub(r"\s*\(.*\)\s*$", "", label).strip().upper()


def numeric(value: str | float | int | None) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    m = _NUM.search(str(value).replace(",", "."))
    return float(m.group()) if m else None


def check(label: str, value) -> bool | None:
    """True/False when the field has a known range; None when we have no opinion."""
    spec = RANGES.get(base_label(label))
    if spec is None:
        return None
    lo, hi, step, integer = spec
    n = numeric(value)
    if n is None:
        return False
    if not lo <= n <= hi:
        return False
    if integer and abs(n - round(n)) > 1e-6:
        return False
    if step and abs(n / step - round(n / step)) > 1e-6:
        return False
    return True


def flag(values: list[dict]) -> list[dict]:
    """Return copies of the {l, v} dicts with `ok: False` added where the sanity check fails."""
    out = []
    for item in values:
        item = dict(item)
        result = check(item.get("l", ""), item.get("v"))
        if result is False:
            item["ok"] = False
        else:
            item.pop("ok", None)
        out.append(item)
    return out


def confidence(values: list[dict], expected_fields: int) -> float:
    """found/expected x fraction passing sanity, rounded to 2 dp; 0.0 when nothing found."""
    if not values or expected_fields <= 0:
        return 0.0
    found = min(len(values), expected_fields)
    passing = sum(1 for v in values if v.get("ok", True))
    return round((found / expected_fields) * (passing / len(values)), 2)
