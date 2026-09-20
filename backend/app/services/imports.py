"""Spreadsheet import (B13): patients, medicines, stock and prescriptions from KiviHealth exports
(or any CSV / Excel with the same information).

Flow: upload -> inspect (headers, sample rows, suggested column matching per target)
      -> preview (every row judged: new / update / skip + reason, nothing written)
      -> run (writes, in one transaction per target, audited).

The suggested matching is by header name (synonyms below); the person confirms or changes it
on screen and the chosen mapping is sent back with preview / run.
"""
from __future__ import annotations

import csv
import io
import re
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import utcnow
from app.models.audit import AuditLog
from app.models.patients import Patient, Visit
from app.models.pharmacy import (Diagnosis, InventoryItem, Medicine, Prescription, PrescriptionLine,
                                 StockMovement)
from app.models.staff import Staff
from app.services.pharmacy import find_medicine
from app.services.queue import DONE_STAGE, _next_token

MAX_ROWS = 50_000
SAMPLE_ROWS = 5


class ImportError_(Exception):
    pass


# --------------------------------------------------------------------------- targets
@dataclass
class Field:
    key: str
    label: str
    required: bool = False
    hint: str = ""
    synonyms: list[str] = field(default_factory=list)


TARGETS: dict[str, dict] = {
    "patients": {
        "label": "Patients",
        "fields": [
            Field("external_id", "KiviHealth id", hint="Local Id, e.g. GK2341 — keeps re-imports from duplicating",
                  synonyms=["local id", "localid", "patient id", "id", "uhid", "mr no", "mrno", "reg no"]),
            Field("name", "Name", required=True, synonyms=["name", "patient name", "patient"]),
            Field("phone", "Phone", synonyms=["contact", "mobile", "phone", "mobile no", "contact no", "phone number"]),
            Field("sex", "Gender", synonyms=["gender", "sex"]),
            Field("age", "Age", synonyms=["age", "age(y)", "age (y)", "age in years"]),
            Field("dob", "Date of birth", hint="used to work out the age when Age is empty",
                  synonyms=["dob", "date of birth", "birth date", "birthdate"]),
            Field("address", "Address", synonyms=["address", "full address"]),
            Field("area", "Area", hint="joined into the address", synonyms=["area", "locality"]),
            Field("city", "City", hint="joined into the address", synonyms=["city", "town"]),
            Field("note", "Note", synonyms=["note", "notes", "remarks", "comment"]),
        ],
    },
    "medicines": {
        "label": "Medicines",
        "fields": [
            Field("name", "Medicine name", required=True, synonyms=["medicine name", "medicine", "name", "drug", "drug name"]),
            Field("manufacturer", "Company", synonyms=["company", "manufacturer", "brand company", "mfg"]),
        ],
    },
    "stock": {
        "label": "Stock levels",
        "fields": [
            Field("name", "Item name", required=True, synonyms=["item", "item name", "medicine", "medicine name", "name", "product"]),
            Field("stock", "Quantity in stock", required=True, synonyms=["stock", "quantity", "qty", "in stock", "current stock", "balance"]),
            Field("unit", "Unit", hint="bottles / tubes / strips", synonyms=["unit", "units", "uom", "pack"]),
            Field("reorder_level", "Reorder at", synonyms=["reorder", "reorder level", "reorder at", "min stock", "minimum"]),
        ],
    },
    "prescriptions": {
        "label": "Prescriptions",
        "fields": [
            Field("patient_external_id", "Patient KiviHealth id", hint="matches patients imported with their Local Id",
                  synonyms=["local id", "localid", "patient id", "patientid", "uhid", "mr no"]),
            Field("patient_name", "Patient name", hint="used when there is no id column",
                  synonyms=["patient name", "patient", "name"]),
            Field("patient_phone", "Patient phone", hint="helps match same-name patients",
                  synonyms=["contact", "mobile", "phone", "phone number"]),
            Field("date", "Date", required=True, synonyms=["date", "prescription date", "visit date", "appointment", "appointment date", "created"]),
            Field("diagnosis", "Diagnosis", hint="feeds the treatment standards", synonyms=["diagnosis", "complaint", "condition", "treatment", "treatment plan", "symptom"]),
            Field("medicine", "Medicine", required=True, synonyms=["medicine", "medicine name", "drug", "drug name"]),
            Field("dosage", "Dosage / instructions", synonyms=["dosage", "dose", "instructions", "frequency", "directions", "how to take"]),
            Field("qty", "Quantity given", synonyms=["qty", "quantity", "qty given", "total tablets", "tablets"]),
        ],
    },
}


def targets_out() -> list[dict]:
    return [{"key": k, "label": t["label"],
             "fields": [{"key": f.key, "label": f.label, "required": f.required, "hint": f.hint} for f in t["fields"]]}
            for k, t in TARGETS.items()]


# --------------------------------------------------------------------------- files
def import_dir() -> Path:
    d = Path(settings.UPLOAD_DIR) / "imports"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _norm_header(h) -> str:
    return re.sub(r"[^a-z0-9()]+", " ", str(h or "").strip().lower()).strip()


def parse_table(data: bytes, filename: str) -> tuple[list[str], list[list[str]]]:
    """CSV / TSV / XLSX -> (headers, rows as strings). First sheet only; blank rows dropped."""
    name = (filename or "").lower()
    if name.endswith((".xlsx", ".xlsm", ".xls")):
        try:
            import openpyxl
        except ImportError as exc:  # pragma: no cover
            raise ImportError_("Excel support is not installed on the server") from exc
        try:
            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except Exception as exc:  # noqa: BLE001
            raise ImportError_("Could not open the Excel file — is it a real .xlsx?") from exc
        ws = wb.worksheets[0]
        rows_iter = ws.iter_rows(values_only=True)
        headers = None
        rows: list[list[str]] = []
        for raw in rows_iter:
            vals = [_cell(v) for v in raw]
            if headers is None:
                if not any(vals):
                    continue
                headers = vals
                continue
            if any(vals):
                rows.append(vals)
            if len(rows) > MAX_ROWS:
                raise ImportError_(f"More than {MAX_ROWS} rows — split the file")
        wb.close()
        if headers is None:
            raise ImportError_("The sheet is empty")
        return [str(h) for h in headers], rows
    text = data.decode("utf-8-sig", errors="replace")
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    headers = None
    rows = []
    for raw in reader:
        vals = [str(v).strip() for v in raw]
        if headers is None:
            if not any(vals):
                continue
            headers = vals
            continue
        if any(vals):
            rows.append(vals)
        if len(rows) > MAX_ROWS:
            raise ImportError_(f"More than {MAX_ROWS} rows — split the file")
    if headers is None:
        raise ImportError_("The file is empty")
    return headers, rows


def _cell(v) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.date().isoformat() if v.time() == datetime.min.time() else v.isoformat(sep=" ")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def store_file(data: bytes, filename: str) -> str:
    """Keep the uploaded file for the preview/run steps; returns the token."""
    headers, _ = parse_table(data, filename)  # validate now, fail early
    if not headers:
        raise ImportError_("No header row found")
    ext = ".xlsx" if filename.lower().endswith((".xlsx", ".xlsm", ".xls")) else ".csv"
    token = uuid.uuid4().hex
    (import_dir() / f"{token}{ext}").write_bytes(data)
    return token


def load_file(token: str) -> tuple[list[str], list[list[str]]]:
    if not re.fullmatch(r"[0-9a-f]{32}", token or ""):
        raise ImportError_("Unknown upload")
    for ext in (".csv", ".xlsx"):
        p = import_dir() / f"{token}{ext}"
        if p.exists():
            return parse_table(p.read_bytes(), p.name)
    raise ImportError_("Upload not found — upload the file again")


def suggest_mapping(headers: list[str], target: str) -> dict[str, str]:
    """field key -> header, by synonym; each header used once."""
    norm = {_norm_header(h): h for h in headers}
    used: set[str] = set()
    out: dict[str, str] = {}
    for f in TARGETS[target]["fields"]:
        for syn in [f.label.lower()] + f.synonyms:
            h = norm.get(_norm_header(syn))
            if h and h not in used:
                out[f.key] = h
                used.add(h)
                break
    return out


# --------------------------------------------------------------------------- normalisers
def _sex(v: str) -> str | None:
    t = (v or "").strip().lower()
    if not t:
        return None
    if t in ("m", "male", "man", "boy"):
        return "M"
    if t in ("f", "female", "woman", "girl"):
        return "F"
    return "O"


def _int(v: str) -> int | None:
    t = re.sub(r"[^\d\-]", "", str(v or ""))
    if t in ("", "-"):
        return None
    try:
        return int(t)
    except ValueError:
        return None


def _phone(v: str) -> str | None:
    digits = re.sub(r"\D", "", str(v or ""))
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    return digits[-10:] if len(digits) >= 10 else (digits or None)


_DATE_FORMATS = ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%Y/%m/%d", "%d-%b-%Y", "%d %b %Y", "%d-%m-%y", "%d/%m/%y",
                 "%Y-%m-%d %H:%M:%S", "%d-%m-%Y %H:%M", "%d/%m/%Y %H:%M", "%Y-%m-%dT%H:%M:%S")


def _date(v: str) -> date | None:
    t = (v or "").strip()
    if not t:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(t[:len(fmt) + 4], fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(t).date()
    except ValueError:
        return None


def _age_from(age: str, dob: str, on: date | None = None) -> int | None:
    a = _int(age)
    if a is not None and 0 <= a < 130:
        return a
    d = _date(dob)
    if d:
        today = on or date.today()
        return max(0, today.year - d.year - ((today.month, today.day) < (d.month, d.day)))
    return None


BLANKS = {"-", "--", "na", "n/a", "null", "none", "nil", "."}


def _clean(v) -> str:
    t = " ".join(str(v or "").split())
    return "" if t.lower() in BLANKS else t


# --------------------------------------------------------------------------- preview / run
@dataclass
class RowResult:
    row: int  # 1-based data row number
    action: str  # new | update | skip
    label: str  # what it is ("Rasilaben Patel", "Timolol …")
    reason: str = ""


@dataclass
class Result:
    target: str
    total: int
    new: int = 0
    update: int = 0
    skip: int = 0
    rows: list[RowResult] = field(default_factory=list)
    written: bool = False
    warnings: list[str] = field(default_factory=list)

    def add(self, r: RowResult) -> None:
        self.rows.append(r)
        setattr(self, r.action, getattr(self, r.action) + 1)


def _records(headers: list[str], rows: list[list[str]], mapping: dict[str, str], target: str) -> list[dict]:
    idx = {h: i for i, h in enumerate(headers)}
    missing = [f.label for f in TARGETS[target]["fields"] if f.required and not mapping.get(f.key)]
    if missing:
        raise ImportError_("Match a column for: " + ", ".join(missing))
    unknown = [h for h in mapping.values() if h and h not in idx]
    if unknown:
        raise ImportError_("Column not in the file: " + ", ".join(unknown))
    out = []
    for r in rows:
        rec = {}
        for key, h in mapping.items():
            if h:
                i = idx[h]
                rec[key] = _clean(r[i]) if i < len(r) else ""
        out.append(rec)
    return out


def run_import(db: Session, token: str, target: str, mapping: dict[str, str], by: Staff | None,
               write: bool) -> Result:
    if target not in TARGETS:
        raise ImportError_("Unknown import type")
    headers, rows = load_file(token)
    recs = _records(headers, rows, mapping, target)
    fn = {"patients": _patients, "medicines": _medicines, "stock": _stock, "prescriptions": _prescriptions}[target]
    result = Result(target=target, total=len(recs))
    try:
        fn(db, recs, result, by, write)
        if write:
            db.add(AuditLog(staff_id=by.id if by else None, action="import.run", entity="import", entity_id=None,
                            detail={"target": target, "new": result.new, "update": result.update,
                                    "skip": result.skip, "rows": result.total}))
            db.commit()
            result.written = True
        else:
            db.rollback()
    except Exception:
        db.rollback()
        raise
    return result


# ---- patients
def _patients(db: Session, recs: list[dict], res: Result, by, write: bool) -> None:
    seen_ext: set[str] = set()
    for n, r in enumerate(recs, 1):
        name = _clean(r.get("name"))
        ext = _clean(r.get("external_id")) or None
        if not name:
            res.add(RowResult(n, "skip", ext or "(blank)", "no name"))
            continue
        if ext and ext in seen_ext:
            res.add(RowResult(n, "skip", name, f"{ext} appears twice in the file"))
            continue
        if ext:
            seen_ext.add(ext)
        phone = _phone(r.get("phone"))
        sex = _sex(r.get("sex"))
        age = _age_from(r.get("age", ""), r.get("dob", ""))
        address = ", ".join(x for x in (_clean(r.get("address")), _clean(r.get("area")), _clean(r.get("city"))) if x) or None
        note = _clean(r.get("note"))
        existing = None
        if ext:
            existing = db.scalar(select(Patient).where(Patient.external_id == ext))
        if existing is None:
            q = select(Patient).where(func.lower(Patient.name) == name.lower())
            q = q.where(Patient.phone == phone) if phone else q.where(Patient.phone.is_(None))
            existing = db.scalar(q)
        if existing is None:
            res.add(RowResult(n, "new", name, ext or ""))
            if write:
                db.add(Patient(name=name, external_id=ext, phone=phone, sex=sex, age=age, address=address,
                               note=note or ""))
                db.flush()
        else:
            changes = []
            if ext and not existing.external_id:
                changes.append("id")
            for k, v in (("phone", phone), ("sex", sex), ("age", age), ("address", address)):
                if v and getattr(existing, k) != v:
                    changes.append(k)
            if not changes:
                res.add(RowResult(n, "skip", name, "already here, nothing new"))
                continue
            res.add(RowResult(n, "update", name, "fills in " + ", ".join(changes)))
            if write:
                if ext and not existing.external_id:
                    existing.external_id = ext
                for k, v in (("phone", phone), ("sex", sex), ("age", age), ("address", address)):
                    if v:
                        setattr(existing, k, v)
                if note and note not in (existing.note or ""):
                    existing.note = (existing.note + "\n" + note).strip()
                db.flush()


# ---- medicines
def _medicines(db: Session, recs: list[dict], res: Result, by, write: bool) -> None:
    seen: set[str] = set()
    for n, r in enumerate(recs, 1):
        name = _clean(r.get("name"))
        if not name:
            res.add(RowResult(n, "skip", "(blank)", "no name"))
            continue
        key = name.lower()
        if key in seen:
            res.add(RowResult(n, "skip", name, "appears twice in the file"))
            continue
        seen.add(key)
        maker = _clean(r.get("manufacturer")) or None
        existing = db.scalar(select(Medicine).where(func.lower(Medicine.name) == key))
        if existing is not None:
            if maker and not existing.manufacturer:
                res.add(RowResult(n, "update", name, "adds company"))
                if write:
                    existing.manufacturer = maker
            else:
                res.add(RowResult(n, "skip", name, "already in the list"))
                if write and not existing.active:
                    existing.active = True
            continue
        res.add(RowResult(n, "new", name, maker or ""))
        if write:
            db.add(Medicine(name=name, brand=None, composition=name, form="drops", manufacturer=maker, active=True))
            db.flush()


# ---- stock
def _stock(db: Session, recs: list[dict], res: Result, by, write: bool) -> None:
    seen: set[str] = set()
    for n, r in enumerate(recs, 1):
        name = _clean(r.get("name"))
        if not name:
            res.add(RowResult(n, "skip", "(blank)", "no name"))
            continue
        qty = _int(r.get("stock"))
        if qty is None or qty < 0:
            res.add(RowResult(n, "skip", name, f"quantity '{r.get('stock')}' is not a number"))
            continue
        key = name.lower()
        if key in seen:
            res.add(RowResult(n, "skip", name, "appears twice in the file"))
            continue
        seen.add(key)
        unit = (_clean(r.get("unit")) or "bottles").lower()
        if unit not in ("bottles", "tubes", "strips"):
            unit = {"bottle": "bottles", "tube": "tubes", "strip": "strips", "pcs": "bottles", "nos": "bottles"}.get(unit, "bottles")
        reorder = _int(r.get("reorder_level"))
        med = find_medicine(db, name)
        item = db.scalar(select(InventoryItem).where(func.lower(InventoryItem.name) == key))
        if item is None:
            res.add(RowResult(n, "new", name, f"{qty} {unit}" + (" · linked to medicine list" if med else "")))
            if write:
                item = InventoryItem(name=med.name if med else name, unit=unit, stock=qty,
                                     reorder_level=reorder if reorder is not None else 0,
                                     medicine_id=med.id if med else None)
                db.add(item)
                db.flush()
                if qty:
                    db.add(StockMovement(item_id=item.id, delta=qty, reason="received",
                                         by_staff_id=by.id if by else None))
            continue
        delta = qty - item.stock
        if delta == 0 and (reorder is None or reorder == item.reorder_level):
            res.add(RowResult(n, "skip", name, "stock already matches"))
            continue
        res.add(RowResult(n, "update", name, f"{item.stock} → {qty} {item.unit}"))
        if write:
            if delta:
                item.stock = qty
                db.add(StockMovement(item_id=item.id, delta=delta, reason="adjusted", by_staff_id=by.id if by else None))
            if reorder is not None:
                item.reorder_level = reorder
            if med and not item.medicine_id:
                item.medicine_id = med.id


# ---- prescriptions
def _find_patient(db: Session, r: dict) -> Patient | None:
    ext = _clean(r.get("patient_external_id"))
    if ext:
        p = db.scalar(select(Patient).where(Patient.external_id == ext))
        if p:
            return p
    name = _clean(r.get("patient_name"))
    if not name:
        return None
    phone = _phone(r.get("patient_phone"))
    q = select(Patient).where(func.lower(Patient.name) == name.lower())
    rows = list(db.scalars(q))
    if phone:
        rows = [p for p in rows if p.phone == phone] or rows
    return rows[0] if len(rows) >= 1 else None


def _diagnosis(db: Session, name: str, write: bool, cache: dict) -> Diagnosis | None:
    key = name.lower()
    if key in cache:
        return cache[key]
    d = db.scalar(select(Diagnosis).where(func.lower(Diagnosis.name) == key))
    if d is None and write:
        order = (db.scalar(select(func.max(Diagnosis.sort_order))) or 0) + 1
        d = Diagnosis(name=name, active=True, sort_order=order)
        db.add(d)
        db.flush()
    cache[key] = d
    return d


def _prescriptions(db: Session, recs: list[dict], res: Result, by, write: bool) -> None:
    """One file row = one medicine line. Rows with the same patient + date (+ diagnosis) form one
    prescription on a completed visit that day, so the history and treatment standards see them."""
    groups: dict[tuple, list[tuple[int, dict]]] = defaultdict(list)
    order: list[tuple] = []
    for n, r in enumerate(recs, 1):
        ext = _clean(r.get("patient_external_id"))
        pname = _clean(r.get("patient_name"))
        on = _date(r.get("date", ""))
        med = _clean(r.get("medicine"))
        if not (ext or pname):
            res.add(RowResult(n, "skip", med or "(blank)", "no patient id or name"))
            continue
        if on is None:
            res.add(RowResult(n, "skip", pname or ext, f"date '{r.get('date')}' not understood"))
            continue
        if not med:
            res.add(RowResult(n, "skip", pname or ext, "no medicine"))
            continue
        key = (ext or f"name:{pname.lower()}|{_phone(r.get('patient_phone')) or ''}", on, _clean(r.get("diagnosis")).lower())
        if key not in groups:
            order.append(key)
        groups[key].append((n, r))

    cache: dict = {}
    for key in order:
        items = groups[key]
        first_n, first = items[0]
        patient = _find_patient(db, first)
        who = _clean(first.get("patient_name")) or _clean(first.get("patient_external_id"))
        on: date = key[1]
        if patient is None:
            for n, _ in items:
                res.add(RowResult(n, "skip", who, "patient not found — import patients first"))
            continue
        dx_name = _clean(first.get("diagnosis"))
        # Already imported? (same patient, same day, same medicines) -> skip
        existing_visit = db.scalar(select(Visit).where(Visit.patient_id == patient.id, Visit.date == on,
                                                       Visit.status == "completed"))
        existing_rx = None
        if existing_visit is not None:
            existing_rx = db.scalar(select(Prescription).where(Prescription.visit_id == existing_visit.id))
        wanted = sorted(_clean(r.get("medicine")).lower() for _, r in items)
        if existing_rx is not None and sorted(l.name.lower() for l in existing_rx.lines) == wanted:
            for n, _ in items:
                res.add(RowResult(n, "skip", f"{patient.name} · {on.isoformat()}", "already imported"))
            continue
        label = f"{patient.name} · {on.isoformat()}" + (f" · {dx_name}" if dx_name else "")
        for n, r in items:
            res.add(RowResult(n, "new", label, _clean(r.get("medicine"))))
        if not write:
            continue
        dx = _diagnosis(db, dx_name, True, cache) if dx_name else None
        visit = existing_visit
        if visit is None:
            visit = Visit(patient_id=patient.id, date=on, token=_next_token(db, on), stage_key=DONE_STAGE,
                          status="completed", completed_at=utcnow(),
                          note="Imported from the previous system")
            db.add(visit)
            db.flush()
        rx = existing_rx
        if rx is None:
            rx = Prescription(visit_id=visit.id, print_language=patient.language or "english",
                              diagnosis_id=dx.id if dx else None)
            db.add(rx)
            db.flush()
        elif dx and not rx.diagnosis_id:
            rx.diagnosis_id = dx.id
        have = {l.name.lower() for l in rx.lines}
        for _, r in items:
            mname = _clean(r.get("medicine"))
            med = find_medicine(db, mname)
            name = med.name if med else mname
            if name.lower() in have:
                continue
            have.add(name.lower())
            db.add(PrescriptionLine(prescription_id=rx.id, medicine_id=med.id if med else None, name=name,
                                    matched=med is not None, dosage=_clean(r.get("dosage")),
                                    qty_given=_int(r.get("qty")) or 0))
        db.flush()
