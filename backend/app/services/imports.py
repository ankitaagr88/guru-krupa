"""Spreadsheet import (B13): patients, medicines, stock, prescriptions, past visits and past bills from
KiviHealth exports (or any CSV / Excel with the same information).

KiviHealth exports one file per kind per year (Patients / Appointments / Payments / Prescription), so
several files with the same columns can be uploaded together and are read as one.

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
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.audit import AuditLog
from app.models.billing import Bill, BillItem, BillPayment
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
            Field("name", "Name", hint="or First / Middle / Last name below", synonyms=["name", "patient name", "patient"]),
            Field("first_name", "First name", synonyms=["first name", "firstname", "given name"]),
            Field("middle_name", "Middle name", synonyms=["middle name", "middlename"]),
            Field("last_name", "Last name", synonyms=["last name", "lastname", "surname"]),
            Field("phone", "Phone", synonyms=["contact", "mobile", "phone", "mobile no", "contact no", "contact number",
                                              "phone number"]),
            Field("sex", "Gender", synonyms=["gender", "sex"]),
            Field("age", "Age", synonyms=["age", "age(y)", "age (y)", "age in years"]),
            Field("dob", "Date of birth", hint="kept as the date of birth; a 1 January date is read as the age only "
                                               "(KiviHealth fills it in from the age); Age is used when it is empty",
                  synonyms=["dob", "d o b", "date of birth", "birth date", "birthdate", "birth day"]),
            Field("address", "Address", synonyms=["address", "full address"]),
            Field("area", "Area", hint="joined into the address", synonyms=["area", "area name", "locality"]),
            Field("city", "City", hint="joined into the address", synonyms=["city", "city name", "town"]),
            Field("pincode", "Pincode", hint="joined into the address", synonyms=["pincode", "pin code", "pin", "zip"]),
            Field("note", "Note", synonyms=["note", "notes", "remarks", "comment"]),
        ],
    },
    "medicines": {
        "label": "Medicines",
        "fields": [
            Field("name", "Medicine name", required=True, synonyms=["medicine name", "medicine", "name", "drug", "drug name"]),
            Field("manufacturer", "Company", synonyms=["company", "manufacturer", "brand company", "mfg"]),
            Field("price", "Price (₹)", hint="selling price; billed on \"Bought here\"",
                  synonyms=["price", "selling price", "last price", "mrp", "rate"]),
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
                  synonyms=["local id", "localid", "case id", "patient id", "patientid", "patient number", "uhid",
                            "mr no"]),
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
    "visits": {
        "label": "Past visits",
        "fields": [
            Field("patient_external_id", "Patient KiviHealth id", hint="matches patients imported with their Local Id",
                  synonyms=["local id", "localid", "patient number", "patient id", "patientid", "case id", "uhid"]),
            Field("patient_name", "Patient name", hint="used when there is no id column",
                  synonyms=["patient name", "patient", "name"]),
            Field("date", "Date", required=True, synonyms=["appointment date", "date", "visit date", "appointment"]),
            Field("reason", "Reason", hint="kept as a note on the visit when it is not just the patient's name",
                  synonyms=["reason", "complaint", "purpose", "note"]),
        ],
    },
    "payments": {
        "label": "Past bills",
        "fields": [
            Field("patient_external_id", "Patient KiviHealth id", hint="KiviHealth's payment export has none; "
                  "the name is matched instead", synonyms=["local id", "localid", "patient number", "patient id", "uhid"]),
            Field("patient_name", "Patient name", required=True, synonyms=["patient name", "patient", "name"]),
            Field("date", "Date", required=True, synonyms=["date", "payment date", "receipt date", "bill date"]),
            Field("item", "Charge / item", required=True,
                  synonyms=["treatment plan", "item", "particular", "particulars", "description", "service"]),
            Field("amount", "Amount (₹)", required=True, synonyms=["amount", "total", "price"]),
            Field("mode", "Payment mode", synonyms=["payment mode", "mode", "paid by"]),
            Field("invoice", "Invoice no.", hint="lines with the same invoice form one bill",
                  synonyms=["invoice number", "invoice no", "invoice", "bill no", "bill number"]),
            Field("receipt", "Receipt no.", hint="keeps a second import from adding the bill again",
                  synonyms=["receipt number", "receipt no", "receipt"]),
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


def combine_files(files: list[tuple[bytes, str]]) -> tuple[bytes, str, list[str], list[list[str]]]:
    """Several files with the same columns (e.g. KiviHealth's one-file-per-year export) read as one,
    in the order given. Returns (one CSV, its display name, headers, rows)."""
    headers: list[str] | None = None
    rows: list[list[str]] = []
    for data, name in files:
        h, r = parse_table(data, name)
        if headers is None:
            headers = h
        elif [_norm_header(x) for x in h] != [_norm_header(x) for x in headers]:
            raise ImportError_(f"{name} has different columns from {files[0][1]} — upload it on its own")
        rows.extend(r)
        if len(rows) > MAX_ROWS:
            raise ImportError_(f"More than {MAX_ROWS} rows — split the files")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(headers)
    w.writerows(rows)
    label = files[0][1] if len(files) == 1 else f"{len(files)} files ({', '.join(n for _, n in files)})"
    return buf.getvalue().encode("utf-8"), label, headers or [], rows


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
# Month spelt out, as KiviHealth writes it ("December-29-2021").
_WORD_DATE_FORMATS = ("%B-%d-%Y", "%b-%d-%Y", "%d-%B-%Y", "%B %d, %Y", "%d %B %Y")


def _date(v: str) -> date | None:
    t = (v or "").strip()
    if not t:
        return None
    for fmt in _WORD_DATE_FORMATS:
        try:
            return datetime.strptime(t, fmt).date()
        except ValueError:
            continue
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(t[:len(fmt) + 4], fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(t).date()
    except ValueError:
        return None


_EXCEL_EPOCH = date(1899, 12, 30)


def _dob(v: str, on: date | None = None) -> date | None:
    """A date of birth from a sheet: dd/mm/yyyy, dd-mm-yyyy, d/m/yy, yyyy-mm-dd or an Excel serial number
    (a date cell read as a plain number). Two-digit years that would land in the future are last century.
    Anything in the future or more than 120 years back is treated as not understood."""
    t = (v or "").strip()
    if not t:
        return None
    today = on or date.today()
    d = None
    if re.fullmatch(r"\d{1,5}(\.0+)?", t):
        n = int(float(t))
        if 60 < n < 80_000:  # 1900-03-01 .. year 2118; below that it is more likely an age
            d = _EXCEL_EPOCH + timedelta(days=n)
    else:
        d = _date(t)
    if d is None:
        return None
    if d > today and re.search(r"\D\d{2}$", t):
        d = d.replace(year=d.year - 100, day=min(d.day, 28) if d.month == 2 else d.day)  # "05/03/64" read as 2064
    if d > today or today.year - d.year > 120:
        return None
    return d


def _age_from(age: str, dob: str, on: date | None = None) -> int | None:
    a = _int(age)
    if a is not None and 0 <= a < 130:
        return a
    d = _dob(dob, on)
    if d:
        today = on or date.today()
        return max(0, today.year - d.year - ((today.month, today.day) < (d.month, d.day)))
    return None


BLANKS = {"-", "--", "na", "n/a", "null", "none", "nil", "."}


def _clean(v) -> str:
    t = " ".join(str(v or "").split())
    return "" if t.lower() in BLANKS else t


def _rupees(v: str) -> int | None:
    """"1,047.50" -> 1048 (whole rupees, half up); None when not a number."""
    t = re.sub(r"[^\d.\-]", "", str(v or ""))
    if t in ("", "-", "."):
        return None
    try:
        return int(Decimal(t).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    except InvalidOperation:
        return None


def _noon(on: date) -> datetime:
    """Midday of a clinic day — the time given to things imported with a date only."""
    return datetime.combine(on, time(12, 0), tzinfo=ZoneInfo(settings.CLINIC_TZ))


def _same_person(text: str, name: str) -> bool:
    """Is `text` just the patient's name ("TEJAS GOHIL" for TEJAS B GOHIL)? KiviHealth's Reason column
    mostly repeats it."""
    if re.sub(r"[^a-z]", "", text.lower()) == re.sub(r"[^a-z]", "", name.lower()):
        return True
    words = set(re.findall(r"[a-z]+", text.lower()))
    return bool(words) and words <= set(re.findall(r"[a-z]+", name.lower()))


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
    if target == "patients" and not any(mapping.get(k) for k in ("name", "first_name", "last_name")):
        raise ImportError_("Match a column for: Name (or First / Last name)")
    recs = _records(headers, rows, mapping, target)
    fn = {"patients": _patients, "medicines": _medicines, "stock": _stock, "prescriptions": _prescriptions,
          "visits": _visits, "payments": _payments}[target]
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
        name = _clean(r.get("name")) or " ".join(
            x for x in (_clean(r.get("first_name")), _clean(r.get("middle_name")), _clean(r.get("last_name"))) if x)
        ext = _clean(r.get("external_id")) or None
        if not name:
            res.add(RowResult(n, "skip", ext or "(blank)", "no name"))
            continue
        name = name[:120]
        if ext and ext in seen_ext:
            res.add(RowResult(n, "skip", name, f"{ext} appears twice in the file"))
            continue
        if ext:
            seen_ext.add(ext)
        phone = _phone(r.get("phone"))
        sex = _sex(r.get("sex"))
        # A readable DOB is kept (the age then follows from it); without one, Age(Y) as before.
        dob = _dob(r.get("dob", ""))
        age = None if dob else _age_from(r.get("age", ""), "")
        if dob and (dob.month, dob.day) == (1, 1):
            # KiviHealth stores "age 34" as 1 January of the birth year: keep it as an age, not a birthday.
            age, dob = _age_from(r.get("age", ""), dob.isoformat()), None
        parts: list[str] = []
        for x in (_clean(r.get("address")), _clean(r.get("area")), _clean(r.get("city")), _clean(r.get("pincode"))):
            if x and not any(x.lower() in p.lower() for p in parts):
                parts.append(x)
        address = ", ".join(parts)[:255] or None
        note = _clean(r.get("note"))
        existing = None
        if ext:
            existing = db.scalar(select(Patient).where(Patient.external_id == ext))
        if existing is None:
            # phones are stored as typed ("98250 12345"), so compare digits only
            same_name = list(db.scalars(select(Patient).where(func.lower(Patient.name) == name.lower())))
            existing = next((p for p in same_name if _phone(p.phone) == phone), None)
            if existing is None and not phone:
                existing = next((p for p in same_name if not p.phone), None)
        if existing is None:
            res.add(RowResult(n, "new", name, ext or ""))
            if write:
                db.add(Patient(name=name, external_id=ext, phone=phone, sex=sex, dob=dob, age=age, address=address,
                               note=note or ""))
                db.flush()
        else:
            changes = []
            if ext and not existing.external_id:
                changes.append("id")
            if existing.dob:
                age = None  # a told age never overrides a DOB already on file
            for k, v in (("phone", phone), ("sex", sex), ("dob", dob), ("age", age), ("address", address)):
                cur = getattr(existing, k)
                if v and (cur != v and not (k == "phone" and _phone(cur) == v)):
                    changes.append(k)
            if not changes:
                res.add(RowResult(n, "skip", name, "already here, nothing new"))
                continue
            res.add(RowResult(n, "update", name, "fills in " + ", ".join(changes)))
            if write:
                if ext and not existing.external_id:
                    existing.external_id = ext
                for k, v in (("phone", phone), ("sex", sex), ("dob", dob), ("age", age), ("address", address)):
                    if v and not (k == "phone" and _phone(existing.phone) == v):
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
        price = _rupees(r.get("price"))
        if price is not None and price < 0:
            price = None
        existing = db.scalar(select(Medicine).where(func.lower(Medicine.name) == key))
        if existing is not None:
            changes = []
            if maker and not existing.manufacturer:
                changes.append("adds company")
            if price is not None and price != existing.price:
                changes.append(f"price ₹{existing.price} → ₹{price}" if existing.price is not None else f"price ₹{price}")
            if changes:
                res.add(RowResult(n, "update", name, ", ".join(changes)))
                if write:
                    if maker and not existing.manufacturer:
                        existing.manufacturer = maker
                    if price is not None:
                        existing.price = price
                    existing.active = True
            else:
                res.add(RowResult(n, "skip", name, "already in the list"))
                if write and not existing.active:
                    existing.active = True
            continue
        res.add(RowResult(n, "new", name, " · ".join(x for x in (maker, price is not None and f"₹{price}") if x)))
        if write:
            db.add(Medicine(name=name, brand=None, composition=name, form="drops", manufacturer=maker, price=price,
                            active=True))
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
        rows = [p for p in rows if _phone(p.phone) == phone] or rows
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
            visit = _imported_visit(db, patient, on)
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


# ---- past visits (KiviHealth Appointments) and past bills (KiviHealth Payments)
IMPORTED_NOTE = "Imported from the previous system"


def _imported_visit(db: Session, patient: Patient, on: date, note: str = "") -> Visit:
    """A finished visit from the previous system: in the patient's history and the visit-fee rules,
    never in the queue, the Day book or Today."""
    at = _noon(on)
    visit = Visit(patient_id=patient.id, date=on, token=_next_token(db, on), stage_key=DONE_STAGE,
                  status="completed", imported=True, created_at=at, stage_entered_at=at, completed_at=at,
                  note=IMPORTED_NOTE + (f" · {note}" if note else ""))
    db.add(visit)
    db.flush()
    return visit


def _visit_on(db: Session, patient_id: int, on: date) -> Visit | None:
    """The patient's visit that day, an imported one first."""
    rows = list(db.scalars(select(Visit).where(Visit.patient_id == patient_id, Visit.date == on)
                           .order_by(Visit.imported.desc(), Visit.id)))
    return rows[0] if rows else None


class _Names:
    """Patients by name (letters only, any case) — the payment export has names, not ids."""

    def __init__(self, db: Session):
        self.by_key: dict[str, list[int]] = defaultdict(list)
        for pid, name in db.execute(select(Patient.id, Patient.name)):
            self.by_key[self.key(name)].append(pid)

    @staticmethod
    def key(name: str) -> str:
        return re.sub(r"[^a-z]", "", (name or "").lower())

    def get(self, name: str) -> list[int]:
        return self.by_key.get(self.key(name), [])


def _patient_for(db: Session, r: dict, on: date, names: _Names) -> tuple[Patient | None, str]:
    """(patient, why not). By KiviHealth id, else by name; several patients with one name are told
    apart by who had a visit that day."""
    ext = _clean(r.get("patient_external_id"))
    if ext:
        p = db.scalar(select(Patient).where(Patient.external_id == ext))
        if p:
            return p, ""
    name = _clean(r.get("patient_name"))
    ids = names.get(name)
    if not ids:
        return None, "patient not found — import patients first"
    if len(ids) > 1:
        seen = list(db.scalars(select(Visit.patient_id).where(Visit.patient_id.in_(ids), Visit.date == on)
                               .distinct()))
        if len(seen) != 1:
            return None, f"{len(ids)} patients are called {name} and the date does not tell which — add it by hand"
        ids = seen
    return db.get(Patient, ids[0]), ""


def _visits(db: Session, recs: list[dict], res: Result, by, write: bool) -> None:
    """One file row = one appointment. Rows for the same patient and day make one past visit."""
    groups: dict[tuple, list[tuple[int, dict]]] = defaultdict(list)
    order: list[tuple] = []
    for n, r in enumerate(recs, 1):
        ext, pname = _clean(r.get("patient_external_id")), _clean(r.get("patient_name"))
        on = _date(r.get("date", ""))
        if not (ext or pname):
            res.add(RowResult(n, "skip", "(blank)", "no patient id or name"))
            continue
        if on is None:
            res.add(RowResult(n, "skip", pname or ext, f"date '{r.get('date')}' not understood"))
            continue
        key = (ext or f"name:{_Names.key(pname)}", on)
        if key not in groups:
            order.append(key)
        groups[key].append((n, r))

    names = _Names(db)
    for key in order:
        items = groups[key]
        first = items[0][1]
        on: date = key[1]
        who = _clean(first.get("patient_name")) or _clean(first.get("patient_external_id"))
        patient, why = _patient_for(db, first, on, names)
        if patient is None:
            for n, _ in items:
                res.add(RowResult(n, "skip", f"{who} · {on.isoformat()}", why))
            continue
        label = f"{patient.name} · {on.isoformat()}"
        existing = _visit_on(db, patient.id, on)
        if existing is not None:
            reason = "already imported" if existing.imported else "already has a visit that day in this app"
            for n, _ in items:
                res.add(RowResult(n, "skip", label, reason))
            continue
        reasons: list[str] = []
        for _, r in items:
            text = _clean(r.get("reason"))
            if text and not _same_person(text, patient.name) and text.lower() not in (x.lower() for x in reasons):
                reasons.append(text)
        note = "; ".join(reasons)[:500]
        for i, (n, _) in enumerate(items):
            res.add(RowResult(n, "new" if i == 0 else "skip", label,
                              note if i == 0 else "same visit as the row above"))
        if write:
            _imported_visit(db, patient, on, note)


_MODES = {"cash": "cash", "upi": "upi", "card": "card", "online": "online", "cheque": "cheque", "check": "cheque",
          "mediclaim": "mediclaim", "neft": "online", "gpay": "upi", "paytm": "upi", "phonepe": "upi"}


def _payments(db: Session, recs: list[dict], res: Result, by, write: bool) -> None:
    """One file row = one bill line. Lines with the same invoice (and patient) make one bill on the
    patient's past visit that day (made if missing).

    KiviHealth repeats every line of an invoice under each receipt when a bill was paid in parts, without
    saying how much each receipt was. So a bill's lines are counted once (the most times a line appears
    under any one receipt), and the money is recorded as one payment of the bill total, on the last receipt
    date, with every receipt number and date in its note. A second import of the same file adds nothing:
    a bill already carrying the invoice's note is skipped."""
    groups: dict[tuple, list[tuple[int, dict, date]]] = defaultdict(list)
    order: list[tuple] = []
    for n, r in enumerate(recs, 1):
        pname = _clean(r.get("patient_name"))
        on = _date(r.get("date", ""))
        item = _clean(r.get("item"))
        amount = _rupees(r.get("amount"))
        if not pname and not _clean(r.get("patient_external_id")):
            res.add(RowResult(n, "skip", item or "(blank)", "no patient name"))
            continue
        if on is None:
            res.add(RowResult(n, "skip", pname, f"date '{r.get('date')}' not understood"))
            continue
        if amount is None:
            res.add(RowResult(n, "skip", pname, f"amount '{r.get('amount')}' is not a number"))
            continue
        inv = _clean(r.get("invoice"))
        who = _clean(r.get("patient_external_id")) or _Names.key(pname)
        key = (who, inv) if inv else (who, on.isoformat(), _clean(r.get("receipt")))
        if key not in groups:
            order.append(key)
        groups[key].append((n, r, on))

    names = _Names(db)
    kinds: dict[str, str] = {}
    for key in order:
        items = groups[key]
        first = items[0][1]
        on = min(d for _, _, d in items)
        last_on = max(d for _, _, d in items)
        inv = _clean(first.get("invoice"))
        who = _clean(first.get("patient_name")) or _clean(first.get("patient_external_id"))
        patient, why = _patient_for(db, first, on, names)
        if patient is None:
            for n, _, _ in items:
                res.add(RowResult(n, "skip", f"{who} · {on.isoformat()}", why))
            continue
        # The receipts in date order, and the bill's lines counted once.
        receipts: dict[str, list[tuple[int, dict, date]]] = defaultdict(list)
        for it in items:
            receipts[_clean(it[1].get("receipt"))].append(it)
        lines: Counter = Counter()
        for rs in receipts.values():
            lines |= Counter((_clean(r.get("item")) or "Charge", _rupees(r.get("amount"))) for _, r, _ in rs)
        total = sum(a * q for (_, a), q in lines.items())

        def first_day(rs):
            return min(d for _, _, d in rs)

        rc_text = ", ".join(f"{no} ({first_day(rs).strftime('%d %b %Y')})" if no else first_day(rs).strftime('%d %b %Y')
                            for no, rs in sorted(receipts.items(), key=lambda kv: first_day(kv[1])))
        mark = f"KiviHealth {inv}" if inv else f"KiviHealth {on.isoformat()}"
        pay_note = (f"{mark} · receipt {rc_text}" if len(receipts) == 1 else
                    f"{mark} · paid in {len(receipts)} parts: {rc_text} (part amounts not in the export)")[:255]
        label = f"{patient.name} · {on.isoformat()}" + (f" · {inv}" if inv else "")
        visit = _visit_on(db, patient.id, on)
        if visit is not None and not visit.imported:
            for n, _, _ in items:
                res.add(RowResult(n, "skip", label, "that day's visit is in this app — not overwritten"))
            continue
        bill = visit.bill if visit is not None else None
        if bill is not None and (any(p.note.startswith(mark + " ") for p in bill.payments) or (not inv and bill.items)):
            for n, _, _ in items:
                res.add(RowResult(n, "skip", label, "already imported"))
            continue
        repeated = sum(len(rs) for rs in receipts.values()) - sum(lines.values())
        detail = f"₹{total:,} · {sum(lines.values())} line(s)" + (
            f" · {len(receipts)} receipts, repeated lines counted once" if repeated else "")
        for i, (n, _, _) in enumerate(items):
            res.add(RowResult(n, "new" if i == 0 else "skip", label,
                              detail if i == 0 else "part of the bill above"))
        if not write:
            continue
        if visit is None:
            visit = _imported_visit(db, patient, on)
        if bill is None:
            bill = Bill(visit=visit, created_at=_noon(on))  # via the relationship: a 2nd invoice that day finds it
            db.add(bill)
            db.flush()
        for (text, amount), qty in lines.items():
            if text not in kinds:
                kinds[text] = "medicine" if find_medicine(db, text) is not None else "charge"
            for _ in range(qty):
                db.add(BillItem(bill_id=bill.id, label=text[:120], amount=amount, kind=kinds[text], qty=1))
        raw_mode = _clean(first.get("mode")).lower()
        mode = _MODES.get(raw_mode, raw_mode or "cash")[:20]
        if total > 0:
            db.add(BillPayment(bill_id=bill.id, amount=total, mode=mode, at=_noon(last_on),
                               by_staff_id=by.id if by else None, note=pay_note))
        bill.payment_mode = mode
        bill.paid_at = _noon(last_on)
        db.flush()
        db.expire(bill, ["payments", "items"])
