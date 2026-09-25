"""Printed-prescription extras (lane R): examination findings and the glasses prescription of a
visit, the admin lists behind them (ExamFinding, LensType) and the print settings (ClinicSetting
"rx_print": doctor's name, degrees, registration number, footer note per language).

Shapes are documented in `app.schemas.rx_print`. Errors are the admin service's NotFound /
Conflict / BadValue, mapped to 404 / 409 / 422 by the routes. Every write appends an AuditLog row.
"""
import re
from decimal import Decimal, InvalidOperation

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.config import ClinicSetting, ExamFinding, LensType
from app.models.patients import Visit
from app.models.readings import Reading
from app.models.staff import Staff
from app.ocr.templates import MACHINES
from app.schemas.rx_print import (ExamGlassesOut, ExamRowOut, ExamValue, Glasses, IopFill, LensValues,
                                  ReadingFill, RxPrintSettings)
from app.seed.rx import DEFAULT_SETTINGS, SETTINGS_KEY
from app.services.admin import BadValue, Conflict, NotFound

EYES = (("r", "R"), ("l", "L"))
ROWS = (("dist", "Dist"), ("near", "Near"))
SPH_RANGE = Decimal("30")
CYL_RANGE = Decimal("10")
IPD_RANGE = (40, 85)
MAX_TEXT = 80  # exam values and VA
MAX_NOTE = 255
# Refraction machines: their printout carries SPH / CYL / AX per eye (the lensmeter's "AXS" is the
# patient's current glasses, not a refraction). Worked out from the OCR templates, not listed here.
REFRACTION_MACHINES = tuple(k for k, m in MACHINES.items()
                            if {"SPH (R)", "CYL (R)", "AX (R)", "SPH (L)", "CYL (L)", "AX (L)"} <= set(m.fields))
# Tonometers: their printout carries IOP (R) / IOP (L). Also worked out from the OCR templates.
IOP_MACHINES = tuple(k for k, m in MACHINES.items() if {"IOP (R)", "IOP (L)"} & set(m.fields))


def _audit(db: Session, by, action: str, entity: str, entity_id: int | None, **detail) -> None:
    db.add(AuditLog(staff_id=by.id if isinstance(by, Staff) else by, action=action, entity=entity,
                    entity_id=entity_id, detail=detail))


# --------------------------------------------------------------------------- tidy + validate values
_MINUS = str.maketrans({"−": "-", "–": "-", "—": "-"})


def fmt_power(text: str | None, what: str, limit: Decimal = SPH_RANGE) -> str:
    """Sph / Cyl: "-2.5" -> "-2.50", "1" -> "+1.00", "+.75" -> "+0.75", "0" / "plano" -> "Plano".
    Quarter-dioptre steps only; BadValue otherwise."""
    s = (text or "").strip().translate(_MINUS).replace(" ", "").lower().removesuffix("d").removesuffix("ds")
    if not s:
        return ""
    if s in ("pl", "plano", "0", "+0", "-0", "0.0", "0.00", "+0.00", "-0.00"):
        return "Plano"
    try:
        n = Decimal(s)
    except InvalidOperation:
        n = None
    if n is None or not n.is_finite():
        raise BadValue(f"{what}: '{text}' is not a number (e.g. -2.75 or +1.00)")
    if abs(n) > limit:
        raise BadValue(f"{what}: {text} is out of range (up to ±{limit})")
    if (n * 4) % 1 != 0:
        raise BadValue(f"{what}: {text} is not a quarter step (…, 1.00, 1.25, 1.50, 1.75, …)")
    if n == 0:
        return "Plano"
    return f"{n:+.2f}"


def fmt_axis(text: str | None, what: str) -> str:
    s = (text or "").strip().rstrip("°º").strip()
    if not s:
        return ""
    if not re.fullmatch(r"\d{1,3}", s) or not 0 <= int(s) <= 180:
        raise BadValue(f"{what}: axis must be a whole number from 0 to 180")
    return str(int(s))


def fmt_ipd(text: str | None) -> str:
    s = (text or "").strip().lower().removesuffix("mm").strip()
    if not s:
        return ""
    try:
        n = Decimal(s)
    except InvalidOperation:
        n = None
    if n is None or not n.is_finite():
        raise BadValue(f"IPD: '{text}' is not a number of millimetres (e.g. 66)")
    if not IPD_RANGE[0] <= n <= IPD_RANGE[1]:
        raise BadValue(f"IPD: {text} mm is out of range ({IPD_RANGE[0]}–{IPD_RANGE[1]} mm)")
    return f"{n.normalize():f}"


def _text(value: str | None, what: str, limit: int = MAX_TEXT) -> str:
    s = re.sub(r"\s+", " ", value or "").strip()
    if len(s) > limit:
        raise BadValue(f"{what}: keep it under {limit} characters")
    return s


def clean_glasses(db: Session, g: Glasses | dict | None) -> dict | None:
    """Tidy every value; None when nothing at all is filled in."""
    if g is None:
        return None
    if isinstance(g, dict):
        g = Glasses.model_validate(g)
    out: dict = {}
    for eye, eye_label in EYES:
        out[eye] = {}
        for row, row_label in ROWS:
            v: LensValues = getattr(getattr(g, eye), row)
            where = f"{eye_label} {row_label}"
            vals = {"sph": fmt_power(v.sph, f"{where} Sph"),
                    "cyl": fmt_power(v.cyl, f"{where} Cyl", CYL_RANGE),
                    "axis": fmt_axis(v.axis, f"{where} Axis"),
                    "va": _text(v.va, f"{where} VA", 20)}
            if vals["cyl"] == "Plano":
                vals["cyl"] = ""  # no cylinder
            if vals["cyl"] and not vals["axis"]:
                raise BadValue(f"{where}: a cylinder needs an axis (0–180)")
            out[eye][row] = vals
    known = {k for k, in db.execute(select(LensType.key))}
    lens_types = []
    for key in g.lens_types:
        if key not in known:
            raise BadValue(f"Unknown lens type '{key}'")
        if key not in lens_types:
            lens_types.append(key)
    out["lensTypes"] = lens_types
    out["ipd"] = fmt_ipd(g.ipd)
    out["note"] = _text(g.note, "Glasses note", MAX_NOTE)
    return out if glasses_filled(out) else None


def glasses_filled(g: dict | None) -> bool:
    if not g:
        return False
    if g.get("lensTypes") or g.get("ipd") or g.get("note"):
        return True
    return any(any((g.get(eye) or {}).get(row, {}).get(f) for f in ("sph", "cyl", "axis", "va"))
               for eye, _ in EYES for row, _ in ROWS)


def row_filled(g: dict, row: str) -> bool:
    return any((g.get(eye) or {}).get(row, {}).get(f) for eye, _ in EYES for f in ("sph", "cyl", "axis", "va"))


def clean_exam(db: Session, rows: list[ExamValue] | list[dict]) -> list[dict]:
    """[{key, r, l}] with only the rows that have a value; unknown keys are refused. A key listed
    twice keeps the last one."""
    known = {k for k, in db.execute(select(ExamFinding.key))}
    out: dict[str, dict] = {}
    for row in rows:
        if isinstance(row, dict):
            row = ExamValue.model_validate(row)
        if row.key not in known:
            raise BadValue(f"Unknown exam finding '{row.key}'")
        r, l = _text(row.r, f"{row.key} (R)"), _text(row.l, f"{row.key} (L)")
        if r or l:
            out[row.key] = {"key": row.key, "r": r, "l": l}
        else:
            out.pop(row.key, None)
    return list(out.values())


# --------------------------------------------------------------------------- lists
def exam_findings(db: Session, include_inactive: bool = False) -> list[ExamFinding]:
    stmt = select(ExamFinding).order_by(ExamFinding.sort_order, ExamFinding.id)
    if not include_inactive:
        stmt = stmt.where(ExamFinding.active.is_(True))
    return list(db.scalars(stmt))


def lens_types(db: Session, include_inactive: bool = False) -> list[LensType]:
    stmt = select(LensType).order_by(LensType.sort_order, LensType.id)
    if not include_inactive:
        stmt = stmt.where(LensType.active.is_(True))
    return list(db.scalars(stmt))


def exam_rows(db: Session, exam: list | None) -> list[dict]:
    """Saved exam rows with their labels, in the admin order (a switched-off finding still shows
    on the visits that have it)."""
    findings = exam_findings(db, include_inactive=True)
    order = {f.key: i for i, f in enumerate(findings)}
    labels = {f.key: f.label for f in findings}
    rows = [r for r in (exam or []) if isinstance(r, dict) and (r.get("r") or r.get("l"))]
    rows.sort(key=lambda r: order.get(r.get("key"), len(order)))
    return [{"key": r.get("key"), "label": labels.get(r.get("key"), r.get("key")), "r": r.get("r") or "",
             "l": r.get("l") or ""} for r in rows]


def lens_type_labels(db: Session, keys: list[str]) -> list[str]:
    labels = {t.key: t.label for t in db.scalars(select(LensType))}
    return [labels.get(k, k) for k in keys or []]


# --------------------------------------------------------------------------- per visit
def reading_fill(db: Session, visit: Visit) -> ReadingFill | None:
    """The visit's latest approved refraction reading, as Sph / Cyl / Axis per eye + IPD."""
    reading = db.scalar(select(Reading).where(Reading.visit_id == visit.id,
                                              Reading.machine_key.in_(REFRACTION_MACHINES),
                                              Reading.approved_at.is_not(None))
                        .order_by(Reading.approved_at.desc(), Reading.id.desc()))
    if reading is None:
        return None
    vals = {v.get("l"): str(v.get("v") or "") for v in reading.values or [] if isinstance(v, dict)}

    def safe(fn, *args):
        try:
            return fn(*args)
        except BadValue:
            return ""  # an odd OCR value is left for the doctor to type

    def eye(tag: str) -> LensValues:
        return LensValues(sph=safe(fmt_power, vals.get(f"SPH ({tag})"), "Sph"),
                          cyl=safe(fmt_power, vals.get(f"CYL ({tag})"), "Cyl", CYL_RANGE).replace("Plano", ""),
                          axis=safe(fmt_axis, vals.get(f"AX ({tag})"), "Axis"))

    machine = MACHINES.get(reading.machine_key)
    return ReadingFill(reading_id=reading.id, machine=machine.label if machine else reading.machine_key,
                       captured_at=reading.captured_at, r=eye("R"), l=eye("L"), ipd=safe(fmt_ipd, vals.get("PD")))


def iop_fill(db: Session, visit: Visit) -> IopFill | None:
    """IOP (R) / IOP (L) from the visit's latest approved tonometer reading (any machine whose
    printout carries them), for the examination's IOP row."""
    reading = db.scalar(select(Reading).where(Reading.visit_id == visit.id,
                                              Reading.machine_key.in_(IOP_MACHINES),
                                              Reading.approved_at.is_not(None))
                        .order_by(Reading.approved_at.desc(), Reading.id.desc()))
    if reading is None:
        return None
    vals = {v.get("l"): " ".join(str(v.get("v") or "").split()) for v in reading.values or []
            if isinstance(v, dict)}
    r, l = vals.get("IOP (R)", "")[:MAX_TEXT], vals.get("IOP (L)", "")[:MAX_TEXT]  # noqa: E741
    if not (r or l):
        return None
    machine = MACHINES.get(reading.machine_key)
    return IopFill(reading_id=reading.id, machine=machine.label if machine else reading.machine_key, r=r, l=l)


def exam_glasses_out(db: Session, visit: Visit) -> ExamGlassesOut:
    glasses = visit.glasses if glasses_filled(visit.glasses) else None
    return ExamGlassesOut(
        visit_id=visit.id,
        exam=[ExamRowOut(**r) for r in exam_rows(db, visit.exam)],
        glasses=Glasses.model_validate(glasses) if glasses else None,
        from_reading=reading_fill(db, visit),
        iop=iop_fill(db, visit),
        va={"r": visit.va_r or "", "l": visit.va_l or ""})


def save_exam_glasses(db: Session, visit: Visit, exam: list[ExamValue], glasses: Glasses | None, by) -> Visit:
    visit.exam = clean_exam(db, exam)
    visit.glasses = clean_glasses(db, glasses)
    _audit(db, by, "visit.exam_glasses", "visit", visit.id, exam_rows=len(visit.exam),
           glasses=visit.glasses is not None)
    db.commit()
    return visit


# --------------------------------------------------------------------------- print settings
def get_settings(db: Session) -> dict:
    """The "rx_print" setting over the defaults (missing keys filled in)."""
    row = db.get(ClinicSetting, SETTINGS_KEY)
    stored = dict(row.value or {}) if row is not None else {}
    merged = {**DEFAULT_SETTINGS, **stored}
    merged["footerNote"] = {**DEFAULT_SETTINGS["footerNote"], **(stored.get("footerNote") or {})}
    return RxPrintSettings.model_validate(merged).model_dump(by_alias=True)


def save_settings(db: Session, data: RxPrintSettings, by) -> dict:
    value = data.model_dump(by_alias=True)
    value = {k: (v.strip() if isinstance(v, str) else v) for k, v in value.items()}
    value["footerNote"] = {k: v.strip() for k, v in value["footerNote"].items()}
    row = db.get(ClinicSetting, SETTINGS_KEY)
    if row is None:
        db.add(ClinicSetting(key=SETTINGS_KEY, value=value))
    else:
        row.value = value
    _audit(db, by, "rx_print.settings", "clinic_setting", None, **{k: v for k, v in value.items() if k != "footerNote"})
    db.commit()
    return get_settings(db)


def footer_for(settings: dict, language: str) -> str:
    """The footer note in the prescription's language (english / hindi / gujarati); English when
    that language has none."""
    notes = settings.get("footerNote") or {}
    return (notes.get(language) or "").strip() or (notes.get("english") or "").strip()


# --------------------------------------------------------------------------- admin lists
def _key_from_label(label: str, fallback: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:30] or fallback


def _free_key(db: Session, model, label: str, key: str | None, fallback: str) -> str:
    if key is not None:
        if db.scalar(select(model).filter_by(key=key)):
            raise Conflict(f"'{key}' already exists")
        return key
    base = key = _key_from_label(label, fallback)
    n = 2
    while db.scalar(select(model).filter_by(key=key)):
        key = f"{base[:27]}_{n}"
        n += 1
    return key


def _clean_label(db: Session, model, label: str, what: str, exclude_id: int | None = None) -> str:
    label = re.sub(r"\s+", " ", label or "").strip()
    if not label:
        raise BadValue(f"{what} needs a name")
    stmt = select(model).where(func.lower(model.label) == label.lower())
    if exclude_id is not None:
        stmt = stmt.where(model.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise Conflict(f"'{label}' is already on the list")
    return label


def get_row(db: Session, model, key: str, what: str):
    row = db.scalar(select(model).filter_by(key=key))
    if row is None:
        raise NotFound(f"{what} not found")
    return row


def create_row(db: Session, model, *, label: str, key: str | None, by, what: str, entity: str, **extra):
    label = _clean_label(db, model, label, what)
    key = _free_key(db, model, label, key, entity)
    row = model(key=key, label=label, active=True,
                sort_order=(db.scalar(select(func.max(model.sort_order))) or 0) + 1, **extra)
    db.add(row)
    db.flush()
    _audit(db, by, f"{entity}.create", entity, row.id, key=key, label=label, **extra)
    db.commit()
    return row


def update_row(db: Session, row, values: dict, by, what: str, entity: str):
    changed = {}
    if values.get("label") is not None:
        label = _clean_label(db, type(row), values["label"], what, exclude_id=row.id)
        if label != row.label:
            row.label = changed["label"] = label
    if values.get("default_value") is not None:
        dv = _text(values["default_value"], "Default value")
        if dv != row.default_value:
            row.default_value = changed["default_value"] = dv
    if values.get("active") is not None and values["active"] != row.active:
        row.active = changed["active"] = values["active"]
    _audit(db, by, f"{entity}.update", entity, row.id, key=row.key, **changed)
    db.commit()
    return row


def reorder_rows(db: Session, model, keys: list[str], by, entity: str) -> list:
    rows = {r.key: r for r in db.scalars(select(model))}
    if set(keys) != set(rows) or len(keys) != len(rows):
        raise BadValue(f"order must list every existing {entity.replace('_', ' ')} exactly once")
    for i, key in enumerate(keys):
        rows[key].sort_order = i
    _audit(db, by, f"{entity}.reorder", entity, None, order=keys)
    db.commit()
    return list(db.scalars(select(model).order_by(model.sort_order, model.id)))
