"""Diagnoses + treatment standards (B15/F17).

The standard for a diagnosis is, in order:
  1. the admin-saved standard (Dr Anu's own list, set once in Admin), else
  2. the most common prescription across every past prescription written for that diagnosis —
     a medicine is included when it appears in at least half of them, with the dosage that was
     written most often. Plain counting, no AI.

A prescription can be for several diagnoses. For the history count of one diagnosis, prescriptions
written for that diagnosis alone are used when there are any — a "glaucoma + dry eye" prescription
would otherwise teach the glaucoma standard to include lubricants; only when there are none are the
mixed ones counted. Several diagnoses picked together fill the prescription with their standards
one after another, each medicine once (`combined_standard`).
"""
from collections import Counter, defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.pharmacy import (Diagnosis, Medicine, Prescription, PrescriptionLine, TreatmentStandard,
                                 TreatmentStandardLine)
from app.models.staff import Staff
from app.schemas.treatments import (CombinedPart, CombinedStandardOut, DiagnosisOut, StandardLineIn, StandardLineOut,
                                    StandardOut)
from app.services.admin import BadValue, Conflict, NotFound, _audit, _reorder  # noqa: F401 (re-exported)
from app.services.pharmacy import find_medicine

HISTORY_MIN_SHARE = 0.5  # a medicine must appear in at least this share of past prescriptions


# --------------------------------------------------------------------------- diagnoses
def _ordered(db: Session, include_inactive: bool) -> list[Diagnosis]:
    q = select(Diagnosis)
    if not include_inactive:
        q = q.where(Diagnosis.active.is_(True))
    return list(db.scalars(q.order_by(Diagnosis.sort_order, Diagnosis.id)))


def _rx_diagnoses(db: Session) -> list[tuple[int, list[int]]]:
    """(prescription id, its diagnoses) for every prescription with at least one."""
    out = []
    for rx_id, one, ids in db.execute(select(Prescription.id, Prescription.diagnosis_id, Prescription.diagnosis_ids)):
        ids = list(ids or []) or ([one] if one is not None else [])
        if ids:
            out.append((rx_id, ids))
    return out


def _counts(db: Session) -> dict[int, int]:
    """Prescriptions per diagnosis (a prescription for two counts for both)."""
    counts: Counter = Counter()
    for _, ids in _rx_diagnoses(db):
        counts.update(set(ids))
    return dict(counts)


def _standard_ids(db: Session) -> set[int]:
    return set(db.scalars(select(TreatmentStandard.diagnosis_id)))


def diagnosis_out(d: Diagnosis, counts: dict[int, int] | None = None, standards: set[int] | None = None) -> DiagnosisOut:
    return DiagnosisOut(id=d.id, name=d.name, active=d.active, sort_order=d.sort_order,
                        prescription_count=(counts or {}).get(d.id, 0), has_standard=d.id in (standards or set()))


def diagnoses(db: Session, include_inactive: bool = False) -> list[DiagnosisOut]:
    counts, stds = _counts(db), _standard_ids(db)
    return [diagnosis_out(d, counts, stds) for d in _ordered(db, include_inactive)]


def get_diagnosis(db: Session, diagnosis_id: int) -> Diagnosis:
    d = db.get(Diagnosis, diagnosis_id)
    if d is None:
        raise NotFound("Diagnosis not found")
    return d


def _clean_name(name: str) -> str:
    name = " ".join((name or "").split())
    if not name:
        raise BadValue("Diagnosis name is required")
    return name


def _name_taken(db: Session, name: str, except_id: int | None = None) -> bool:
    q = select(Diagnosis).where(func.lower(Diagnosis.name) == name.lower())
    if except_id is not None:
        q = q.where(Diagnosis.id != except_id)
    return db.scalar(q) is not None


def create_diagnosis(db: Session, name: str, by: Staff | None) -> DiagnosisOut:
    name = _clean_name(name)
    if _name_taken(db, name):
        raise Conflict(f"Diagnosis '{name}' already exists")
    order = (db.scalar(select(func.max(Diagnosis.sort_order))) or 0) + 1
    d = Diagnosis(name=name, active=True, sort_order=order)
    db.add(d)
    db.flush()
    _audit(db, by, "diagnosis.create", "diagnosis", d.id, name=name)
    db.commit()
    return diagnosis_out(d)


def update_diagnosis(db: Session, d: Diagnosis, values: dict, by: Staff | None) -> DiagnosisOut:
    changed = {}
    if values.get("name") is not None:
        name = _clean_name(values["name"])
        if _name_taken(db, name, d.id):
            raise Conflict(f"Diagnosis '{name}' already exists")
        if name != d.name:
            d.name = changed["name"] = name
    if values.get("active") is not None and values["active"] != d.active:
        d.active = changed["active"] = values["active"]
    if changed:
        _audit(db, by, "diagnosis.update", "diagnosis", d.id, **changed)
        db.commit()
    return diagnosis_out(d, _counts(db), _standard_ids(db))


def delete_diagnosis(db: Session, d: Diagnosis, by: Staff | None) -> None:
    """Hard delete only when nothing refers to it; otherwise switch it off (PATCH active=false)."""
    used = _counts(db).get(d.id, 0)
    if used:
        raise Conflict(f"{used} prescription(s) use '{d.name}' — switch it off instead")
    std = db.scalar(select(TreatmentStandard).where(TreatmentStandard.diagnosis_id == d.id))
    if std is not None:
        db.delete(std)
    _audit(db, by, "diagnosis.delete", "diagnosis", d.id, name=d.name)
    db.delete(d)
    db.commit()


def reorder_diagnoses(db: Session, ids: list[int], by: Staff | None) -> list[DiagnosisOut]:
    _reorder(db, Diagnosis, ids, "id", by, "diagnosis.reorder", "diagnosis")
    return diagnoses(db, include_inactive=True)


# --------------------------------------------------------------------------- standards
def _line_key(name: str) -> str:
    return " ".join((name or "").lower().split())


def history_standard(db: Session, diagnosis_id: int) -> tuple[list[StandardLineOut], int]:
    """Most common prescription across all past prescriptions for this diagnosis.

    Returns (lines ordered by how often they were prescribed, number of prescriptions counted).
    """
    with_it = [(rx_id, ids) for rx_id, ids in _rx_diagnoses(db) if diagnosis_id in ids]
    alone = [rx_id for rx_id, ids in with_it if len(set(ids)) == 1]
    rx_ids = alone or [rx_id for rx_id, _ in with_it]
    total = len(rx_ids)
    if total == 0:
        return [], 0
    lines = list(db.scalars(select(PrescriptionLine).where(PrescriptionLine.prescription_id.in_(rx_ids))))
    per_rx: dict[str, set[int]] = defaultdict(set)  # medicine -> prescriptions it appeared in
    dosages: dict[str, Counter] = defaultdict(Counter)
    qtys: dict[str, Counter] = defaultdict(Counter)
    display: dict[str, str] = {}
    med_ids: dict[str, Counter] = defaultdict(Counter)
    for ln in lines:
        key = _line_key(ln.name)
        if not key:
            continue
        per_rx[key].add(ln.prescription_id)
        dosages[key][(ln.dosage or "").strip()] += 1
        qtys[key][ln.qty_given or 0] += 1
        med_ids[key][ln.medicine_id] += 1
        display.setdefault(key, ln.name.strip())
    out: list[StandardLineOut] = []
    for key, rxs in per_rx.items():
        share = len(rxs) / total
        if share < HISTORY_MIN_SHARE:
            continue
        med_id = med_ids[key].most_common(1)[0][0]
        out.append(StandardLineOut(name=display[key], medicine_id=med_id, matched=med_id is not None,
                                   dosage=dosages[key].most_common(1)[0][0],
                                   qty_given=qtys[key].most_common(1)[0][0], frequency=round(share, 2)))
    out.sort(key=lambda l: (-(l.frequency or 0), l.name.lower()))
    return out, total


def _admin_standard(db: Session, diagnosis_id: int) -> TreatmentStandard | None:
    return db.scalar(select(TreatmentStandard).where(TreatmentStandard.diagnosis_id == diagnosis_id))


def _admin_lines(std: TreatmentStandard) -> list[StandardLineOut]:
    return [StandardLineOut(name=l.name, medicine_id=l.medicine_id, matched=l.medicine_id is not None,
                            dosage=l.dosage, qty_given=l.qty_given) for l in std.lines]


def standard(db: Session, d: Diagnosis) -> StandardOut:
    hist, count = history_standard(db, d.id)
    std = _admin_standard(db, d.id)
    if std is not None:
        return StandardOut(diagnosis_id=d.id, diagnosis_name=d.name, source="admin", lines=_admin_lines(std),
                           history_count=count, updated_at=std.updated_at,
                           updated_by=std.updated_by.name if std.updated_by else None, history_lines=hist)
    return StandardOut(diagnosis_id=d.id, diagnosis_name=d.name, source="history" if hist else "none",
                       lines=hist, history_count=count, history_lines=hist)


def combined_standard(db: Session, ids: list[int]) -> CombinedStandardOut:
    """What fills the prescription when several diagnoses are picked: each one's standard in the
    order picked, a medicine already listed (by name) not added again."""
    parts: list[StandardOut] = []
    lines: list[StandardLineOut] = []
    seen: set[str] = set()
    for i in dict.fromkeys(ids):
        part = standard(db, get_diagnosis(db, i))
        parts.append(part)
        for ln in part.lines:
            key = _line_key(ln.name)
            if key and key not in seen:
                seen.add(key)
                lines.append(ln)
    return CombinedStandardOut(lines=lines, parts=[CombinedPart(diagnosis_id=p.diagnosis_id,
                                                                diagnosis_name=p.diagnosis_name, source=p.source,
                                                                history_count=p.history_count, lines=len(p.lines))
                                                   for p in parts])


def save_standard(db: Session, d: Diagnosis, lines: list[StandardLineIn], by: Staff | None) -> StandardOut:
    """Replace the admin standard for a diagnosis. Names are matched to the medicine list like
    prescription lines are, so the picker shows them as "in list"."""
    std = _admin_standard(db, d.id)
    if std is None:
        std = TreatmentStandard(diagnosis_id=d.id)
        db.add(std)
        db.flush()
    else:
        for old in list(std.lines):
            db.delete(old)
        db.flush()
    for i, ln in enumerate(lines):
        name = " ".join(ln.name.split())
        if not name:
            continue
        med: Medicine | None = db.get(Medicine, ln.medicine_id) if ln.medicine_id else find_medicine(db, name)
        db.add(TreatmentStandardLine(standard_id=std.id, medicine_id=med.id if med else None,
                                     name=med.name if med else name, dosage=(ln.dosage or "").strip(),
                                     qty_given=ln.qty_given or 0, sort_order=i))
    std.updated_by_id = by.id if by else None
    _audit(db, by, "treatment_standard.save", "treatment_standard", std.id, diagnosis=d.name, lines=len(lines))
    db.commit()
    db.refresh(std)
    return standard(db, d)


def clear_standard(db: Session, d: Diagnosis, by: Staff | None) -> StandardOut:
    """Drop the admin standard so the history-derived one applies again."""
    std = _admin_standard(db, d.id)
    if std is not None:
        _audit(db, by, "treatment_standard.clear", "treatment_standard", std.id, diagnosis=d.name)
        db.delete(std)
        db.commit()
    return standard(db, d)
