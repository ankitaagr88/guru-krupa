"""Prescriptions (dispense + stock decrement, print payload), inventory movements, bills.

Mockup counterparts: `addMedManual`/`renderMeds`/`decrementInventory`/`pushLowStockToast`,
`adjustStock`/`addInventoryItem`,
`openPrescriptionModal`/`setLanguage`.
"""
import re
from collections import defaultdict
from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db import utcnow
from app.models.audit import AuditLog
from app.models.patients import Visit
from app.models.pharmacy import (INVENTORY_UNITS, STOCK_REASONS, Diagnosis, InventoryItem, Medicine, MedicineForm,
                                 Prescription, PrescriptionLine, StockMovement)
from app.models.staff import Staff
from app.schemas.pharmacy import (InventoryItemOut, MedicineOut, MovementOut, PrescriptionLineIn, PrescriptionLineOut,
                                  PrescriptionOut, PrintDoctor, PrintExamRow, PrintGlasses, PrintGlassesRow, PrintLine,
                                  PrintPayload)
from app.services import billing as billing_svc
from app.services import rx_print as rx_print_svc

HOSPITAL = {
    "name": "Guru Krupa Eye Hospital & Laser Center",
    "address": "201/320, The Grand Plaza, Opp. Fire Station, VIP Road, Vesu, Surat",
    "phone": "9328621216, 7574998502",
    "doctor": "Dr. Anu Juneja",
}

# Print language codes used by the client (`setLanguage`) -> stored Prescription.print_language.
LANGUAGE_ALIASES = {
    "hinglish": "hindi", "hindi": "hindi",
    "gujlish": "gujarati", "gujarati": "gujarati",
    "english": "english", "en": "english",
}
LANGUAGE_NAMES = {"hindi": "hinglish", "gujarati": "gujlish", "english": "english"}

# Reasons for compensating movements when a prescription is replaced: STOCK_REASONS has no
# "reversed", so the closest is "adjusted".
REVERSAL_REASON = "adjusted"
DISPENSE_REASON = "dispensed"


class PharmacyError(Exception):
    pass


class InsufficientStock(PharmacyError):
    def __init__(self, item_name: str, available: int, needed: int):
        super().__init__(item_name)
        self.item_name, self.available, self.needed = item_name, available, needed


class NegativeStock(PharmacyError):
    pass


class BadValue(PharmacyError):
    pass


class Duplicate(PharmacyError):
    pass


# --------------------------------------------------------------------------- dosage phrases
# Dictionary-based Hinglish / Gujlish rendering of the dosage phrases doctors type most often
# (`dosage-input` placeholder: "1 drop, both eyes, 3x daily"). A dosage is parsed into
# quantity + form + eye(s) + frequency + duration; every recognised part is translated and the
# sentence re-assembled. Anything that doesn't parse is printed as typed (English fallback).
#
# form                     Hinglish                    Gujlish
_FORMS = {
    "drop":     ("{n} boond",               "{n} tipu"),
    "ointment": ("malam lagayein",          "malam lagavo"),
    "tablet":   ("{n} goli",                "{n} goli"),
}
# eyes                     Hinglish                    Gujlish
_EYES = {
    "both":  ("dono aankh mein",  "banne aankh ma"),
    "right": ("daayi aankh mein", "jamni aankh ma"),
    "left":  ("baayi aankh mein", "dabi aankh ma"),
}
# frequency                Hinglish                    Gujlish
_FREQ = {
    "once":   ("din mein 1 baar",       "divas ma 1 vaar"),
    "twice":  ("din mein 2 baar",       "divas ma 2 vaar"),
    "thrice": ("din mein 3 baar",       "divas ma 3 vaar"),
    "four":   ("din mein 4 baar",       "divas ma 4 vaar"),
    "night":  ("raat ko sote samay",    "raatre suti vakhte"),
}
_DAYS = ("{n} din tak", "{n} divas sudhi")

_FORM_WORDS = {"drop": "drop", "drops": "drop", "gtt": "drop", "ointment": "ointment", "oint": "ointment",
               "tablet": "tablet", "tablets": "tablet", "tab": "tablet", "tabs": "tablet"}
_EYE_WORDS = {"both eyes": "both", "both eye": "both", "each eye": "both", "ou": "both", "be": "both",
              "right eye": "right", "rt eye": "right", "od": "right", "re": "right",
              "left eye": "left", "lt eye": "left", "os": "left", "le": "left"}
_FREQ_WORDS = {"once daily": "once", "once a day": "once", "1x daily": "once", "1 time daily": "once",
               "twice daily": "twice", "twice a day": "twice", "2x daily": "twice", "bd": "twice",
               "bid": "twice", "2 times daily": "twice", "two times daily": "twice",
               "thrice daily": "thrice", "three times daily": "thrice", "three times a day": "thrice",
               "3x daily": "thrice", "tds": "thrice", "tid": "thrice", "3 times daily": "thrice",
               "four times daily": "four", "four times a day": "four", "4x daily": "four", "qid": "four",
               "4 times daily": "four",
               "at night": "night", "at bedtime": "night", "hs": "night", "nightly": "night", "every night": "night"}


def _alts(words) -> str:
    return "|".join(re.escape(w) for w in sorted(words, key=len, reverse=True))


_DOSAGE_RX = re.compile(
    rf"^(?:(?P<n>\d+)\s*)?(?P<form>{_alts(_FORM_WORDS)})"
    rf"(?:\s+(?:in|to|into)?\s*(?P<eye>{_alts(_EYE_WORDS)}))?"
    rf"(?:\s+(?P<freq>{_alts(_FREQ_WORDS)}))?"
    rf"(?:\s+(?:for|x)\s*(?P<days>\d+)\s*(?:days?|d))?$")


def _normalise(text: str) -> str:
    text = re.sub(r"[,\.;/\-–]+", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def localize_dosage(dosage: str, language: str) -> str:
    """Render `dosage` in Hinglish (`hindi`) or Gujlish (`gujarati`); English / unknown text as-is."""
    lang = LANGUAGE_ALIASES.get((language or "english").lower(), "english")
    if lang == "english" or not dosage:
        return dosage or ""
    idx = 0 if lang == "hindi" else 1
    m = _DOSAGE_RX.match(_normalise(dosage))
    if not m:
        return dosage
    form = _FORM_WORDS[m["form"]]
    n = m["n"] or "1"
    parts = [_FORMS[form][idx].format(n=n)]
    if m["eye"]:
        eye = _EYES[_EYE_WORDS[m["eye"]]][idx]
        parts = [eye] + parts if form == "ointment" else parts + [eye]  # verb last: "dono aankh mein malam lagayein"
    head = " ".join(parts)
    tail = []
    if m["freq"]:
        tail.append(_FREQ[_FREQ_WORDS[m["freq"]]][idx])
    if m["days"]:
        tail.append(_DAYS[idx].format(n=m["days"]))
    return ", ".join([head] + tail) if tail else head


# The common phrases the table covers, rendered once so docs/tests can see the exact output.
COMMON_DOSAGES = [
    "1 drop both eyes, once daily", "1 drop both eyes, twice daily", "1 drop both eyes, thrice daily",
    "1 drop both eyes, four times daily", "1 drop both eyes, at night",
    "1 drop right eye, twice daily", "1 drop left eye, twice daily",
    "1 drop right eye, thrice daily", "1 drop left eye, at night",
    "ointment both eyes, at night", "ointment right eye, at night", "ointment left eye, twice daily",
    "1 tablet twice daily", "1 tablet once daily", "1 tablet at night",
]
DOSAGE_PHRASES = {p: (localize_dosage(p, "hindi"), localize_dosage(p, "gujarati")) for p in COMMON_DOSAGES}


# --------------------------------------------------------------------------- medicines
def form_labels(db: Session) -> dict[str, str]:
    """MedicineForm key -> label (active or not: a retired type still prints on old prescriptions)."""
    return {f.key: f.label for f in db.scalars(select(MedicineForm))}


def search_medicines(db: Session, q: str, limit: int = 50) -> list[Medicine]:
    """`buildMedDatalist`: case-insensitive substring on name, brand OR composition.

    Ordering: brand / name prefix hits first, then composition prefix hits, then substring hits.
    """
    stmt = select(Medicine).where(Medicine.active.is_(True)).order_by(Medicine.name).limit(limit)
    q = (q or "").strip().lower()
    if not q:
        return list(db.scalars(stmt))
    like = f"%{q}%"
    stmt = stmt.where(or_(func.lower(Medicine.name).like(like), func.lower(Medicine.brand).like(like),
                          func.lower(Medicine.composition).like(like)))
    rows = list(db.scalars(stmt))

    def rank(m: Medicine):
        brand_prefix = m.name.lower().startswith(q) or (m.brand or "").lower().startswith(q)
        comp_prefix = (m.composition or "").lower().startswith(q)
        return (0 if brand_prefix else 1 if comp_prefix else 2, m.name.lower())

    return sorted(rows, key=rank)


def medicine_out(m: Medicine, labels: dict[str, str] | None = None) -> MedicineOut:
    labels = labels or {}
    return MedicineOut(id=m.id, name=m.name, brand=m.brand, composition=m.composition, form=m.form,
                       form_label=labels.get(m.form, m.form), strength=m.strength, pack_size=m.pack_size,
                       manufacturer=m.manufacturer, display_name=m.display_name, active=m.active,
                       price=m.price)


def find_medicine(db: Session, text: str) -> Medicine | None:
    """Exact (case-insensitive) hit on name, brand or composition; name/brand wins over composition."""
    key = (text or "").strip().lower()
    if not key:
        return None
    hits = list(db.scalars(select(Medicine).where(Medicine.active.is_(True)).where(
        or_(func.lower(Medicine.name) == key, func.lower(Medicine.brand) == key,
            func.lower(Medicine.composition) == key)).order_by(Medicine.id)))
    for m in hits:
        if m.name.lower() == key or (m.brand or "").lower() == key:
            return m
    return hits[0] if hits else None


def _medicine_for(db: Session, line: PrescriptionLineIn) -> Medicine | None:
    if line.medicine_id is not None:
        return db.get(Medicine, line.medicine_id)
    return find_medicine(db, line.name)


def _item_for(db: Session, name: str, medicine: Medicine | None) -> InventoryItem | None:
    """`decrementInventory`: the stock item for a prescription line, by medicine or by name."""
    item = None
    if medicine is not None:
        item = db.scalar(select(InventoryItem).where(InventoryItem.medicine_id == medicine.id))
    if item is None:
        item = db.scalar(select(InventoryItem).where(func.lower(InventoryItem.name) == name.strip().lower()))
    return item


# --------------------------------------------------------------------------- prescriptions
def get_prescription(db: Session, visit: Visit) -> Prescription | None:
    return db.scalar(select(Prescription).where(Prescription.visit_id == visit.id)
                     .order_by(Prescription.id.desc()))


def _staff_id(by: Staff | int | None) -> int | None:
    return by.id if isinstance(by, Staff) else by


def save_prescription(db: Session, visit: Visit, lines: list[PrescriptionLineIn], print_language: str | None,
                      by: Staff | int | None, diagnosis_id: int | None = None) -> tuple[Prescription, list[InventoryItem]]:
    """Create or replace the visit's prescription in one transaction.

    Saving never moves stock: `qty_given` is the doctor's "to give from clinic". Stock moves only
    when the front desk confirms a line with `dispense_line`. Replacing keeps the confirmed
    (dispensed) state of lines that are still on the new prescription and reverses the stock of
    confirmed lines that were removed. Returns (prescription, []) — the low-stock list now comes
    from `dispense_line`.
    """
    staff_id = _staff_id(by)
    lang = LANGUAGE_ALIASES.get((print_language or "").lower()) if print_language else None
    if print_language and lang is None:
        raise BadValue(f"printLanguage must be one of {sorted(LANGUAGE_ALIASES)}")

    rx = get_prescription(db, visit)
    try:
        if diagnosis_id is not None and db.get(Diagnosis, diagnosis_id) is None:
            raise BadValue("Unknown diagnosis")
        if rx is None:
            rx = Prescription(visit_id=visit.id, print_language=lang or visit.patient.language or "english",
                              diagnosis_id=diagnosis_id)
            db.add(rx)
            db.flush()
        else:
            if lang:
                rx.print_language = lang
            rx.diagnosis_id = diagnosis_id

        # Carry the front desk's confirmations over to lines that are still there; give the
        # stock back for confirmed lines the doctor removed.
        confirmed: dict[str, PrescriptionLine] = {ln.name.lower(): ln for ln in rx.lines if ln.dispensed_qty > 0}
        new_names = {(_medicine_for(db, line) or line).name.strip().lower() for line in lines}
        for key, old in confirmed.items():
            if key not in new_names:
                _undo_dispense_stock(db, rx, old, staff_id)
        # Bill lines from "Bought here" follow their medicine onto the new lines (or leave the bill).
        billed = billing_svc.detach_medicine_lines(db, visit, list(rx.lines))
        for old in list(rx.lines):
            db.delete(old)
        db.flush()

        for line in lines:
            med = _medicine_for(db, line)
            name = med.name if med else line.name.strip()
            keep = confirmed.get(name.lower())
            rx.lines.append(PrescriptionLine(medicine_id=med.id if med else None, name=name, matched=med is not None,
                                             dosage=line.dosage.strip(), qty_given=line.qty_given,
                                             dispensed_qty=keep.dispensed_qty if keep else 0,
                                             dispensed_at=keep.dispensed_at if keep else None,
                                             dispensed_by_id=keep.dispensed_by_id if keep else None))
        db.flush()
        billing_svc.reattach_medicine_lines(db, visit, billed, rx.lines[len(rx.lines) - len(lines):])
        db.add(AuditLog(staff_id=staff_id, action="prescription.save", entity="prescription", entity_id=rx.id,
                        detail={"visitId": visit.id, "lines": len(lines)}))
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(rx)
    return rx, []


def _undo_dispense_stock(db: Session, rx: Prescription, line: PrescriptionLine, staff_id: int | None) -> None:
    item = _item_for(db, line.name, line.medicine)
    if item is not None and line.dispensed_qty > 0:
        item.stock += line.dispensed_qty
        db.add(StockMovement(item_id=item.id, delta=line.dispensed_qty, reason=REVERSAL_REASON,
                             ref_prescription_id=rx.id, by_staff_id=staff_id))


def dispense_line(db: Session, rx: Prescription, line: PrescriptionLine, qty: int,
                  by: Staff | int | None) -> tuple[PrescriptionLine, InventoryItem | None]:
    """The front desk confirms the patient bought `qty` of this medicine here: stock goes down by
    `qty` (409 when there is not enough), the line records who confirmed and when."""
    if line.prescription_id != rx.id:
        raise BadValue("Line is not on this prescription")
    if line.dispensed_qty > 0:
        raise BadValue(f"'{line.name}' is already marked as bought here — undo it first")
    item = _item_for(db, line.name, line.medicine)
    if item is None:
        raise BadValue(f"'{line.name}' is not a stock item — nothing to deduct")
    if item.stock - qty < 0:
        raise InsufficientStock(item.name, item.stock, qty)
    staff_id = _staff_id(by)
    item.stock -= qty
    db.add(StockMovement(item_id=item.id, delta=-qty, reason=DISPENSE_REASON, ref_prescription_id=rx.id,
                         by_staff_id=staff_id))
    line.dispensed_qty = qty
    line.dispensed_at = utcnow()
    line.dispensed_by_id = staff_id
    billing_svc.sync_medicine_line(db, rx.visit, line)  # onto the bill: qty × price (0 = price not set)
    db.add(AuditLog(staff_id=staff_id, action="prescription.dispense", entity="prescription_line", entity_id=line.id,
                    detail={"qty": qty, "item": item.name, "stock": item.stock}))
    db.commit()
    return line, item


def undo_dispense(db: Session, rx: Prescription, line: PrescriptionLine, by: Staff | int | None) -> PrescriptionLine:
    """Take back a "bought here" confirmation: stock goes back up."""
    if line.prescription_id != rx.id:
        raise BadValue("Line is not on this prescription")
    if line.dispensed_qty <= 0:
        return line
    staff_id = _staff_id(by)
    _undo_dispense_stock(db, rx, line, staff_id)
    db.add(AuditLog(staff_id=staff_id, action="prescription.undispense", entity="prescription_line",
                    entity_id=line.id, detail={"qty": line.dispensed_qty}))
    line.dispensed_qty = 0
    line.dispensed_at = None
    line.dispensed_by_id = None
    billing_svc.drop_medicine_line(db, rx.visit, line.id)
    db.commit()
    return line


def _line_form(ln: PrescriptionLine, labels: dict[str, str]) -> tuple[str | None, str | None]:
    med = ln.medicine
    if med is None:
        return None, None
    return med.form, labels.get(med.form, med.form)


def prescription_out(db: Session, rx: Prescription, low: list[InventoryItem] | None = None) -> PrescriptionOut:
    labels = form_labels(db)
    lines = []
    for ln in rx.lines:
        form, form_label = _line_form(ln, labels)
        item = _item_for(db, ln.name, ln.medicine)
        lines.append(PrescriptionLineOut(id=ln.id, medicine_id=ln.medicine_id, name=ln.name, matched=ln.matched,
                                         dosage=ln.dosage, qty_given=ln.qty_given, form=form, form_label=form_label,
                                         dispensed_qty=ln.dispensed_qty, dispensed_at=ln.dispensed_at,
                                         dispensed_by=ln.dispensed_by.name if ln.dispensed_by else None,
                                         in_stock=item.stock if item is not None else None,
                                         price=ln.medicine.price if ln.medicine is not None else None))
    return PrescriptionOut(id=rx.id, visit_id=rx.visit_id, print_language=rx.print_language, created_at=rx.created_at,
                           diagnosis_id=rx.diagnosis_id, diagnosis_name=rx.diagnosis.name if rx.diagnosis else None,
                           lines=lines, low_stock=[it.name for it in (low or [])])


def print_payload(db: Session, rx: Prescription, lang: str | None) -> PrintPayload:
    """`openPrescriptionModal` + `setLanguage`: the sheet the client renders / prints.

    Each line carries the brand (bold), the generic composition (under it) and the type so the
    chemist can dispense the exact pack. Also the patient ID (KiviHealth id, else ours) and area,
    the visit's exam findings and glasses (only what is filled in), the doctor's degrees and
    registration number, and the footer note in the sheet's language (English when it has none).
    """
    visit = rx.visit
    patient = visit.patient
    code = LANGUAGE_ALIASES.get((lang or "").lower()) if lang else None
    if lang and code is None:
        raise BadValue(f"lang must be one of {sorted(LANGUAGE_ALIASES)}")
    code = code or rx.print_language or "english"
    labels = form_labels(db)
    lines = []
    for ln in rx.lines:
        med = ln.medicine
        form, form_label = _line_form(ln, labels)
        lines.append(PrintLine(name=ln.name, dosage=ln.dosage, dosage_local=localize_dosage(ln.dosage, code),
                               qty_given=ln.qty_given, brand=med.brand if med else None,
                               composition=med.composition if med else None, form=form, form_label=form_label,
                               pack_size=med.pack_size if med else None))
    settings = rx_print_svc.get_settings(db)
    doctor = PrintDoctor(name=settings["doctorName"] or HOSPITAL["doctor"], degrees=settings["degrees"],
                         reg_no=settings["regNo"])
    return PrintPayload(
        hospital={**HOSPITAL, "doctor": doctor.name},
        patient={"name": patient.name, "age": patient.age, "sex": patient.sex, "token": visit.token,
                 "date": visit.date.isoformat(), "patientId": patient.external_id or str(patient.id),
                 "area": (patient.address or "").strip()},
        language=LANGUAGE_NAMES.get(code, "english"), lines=lines,
        exam=[PrintExamRow(label=r["label"], r=r["r"], l=r["l"]) for r in rx_print_svc.exam_rows(db, visit.exam)],
        glasses=print_glasses(db, visit.glasses), doctor=doctor,
        footer_note=rx_print_svc.footer_for(settings, code))


def print_glasses(db: Session, glasses: dict | None) -> PrintGlasses | None:
    """The glasses block of the sheet: only the Dist / Near rows that have a value; None when the
    visit has no glasses prescription."""
    if not rx_print_svc.glasses_filled(glasses):
        return None
    rows = [PrintGlassesRow(key=row, label=label, r=glasses.get("r", {}).get(row, {}), l=glasses.get("l", {}).get(row, {}))
            for row, label in rx_print_svc.ROWS if rx_print_svc.row_filled(glasses, row)]
    return PrintGlasses(rows=rows, lens_types=rx_print_svc.lens_type_labels(db, glasses.get("lensTypes") or []),
                        ipd=glasses.get("ipd") or "", note=glasses.get("note") or "")


# --------------------------------------------------------------------------- inventory
def list_inventory(db: Session, low_only: bool = False) -> list[InventoryItem]:
    rows = list(db.scalars(select(InventoryItem).order_by(InventoryItem.name)))
    return [r for r in rows if r.stock <= r.reorder_level] if low_only else rows


def inventory_out(item: InventoryItem, db: Session | None = None,
                  last_received: dict[int, datetime] | None = None,
                  protocol_names: set[str] | None = None) -> InventoryItemOut:
    """`last_received` / `protocol_names` are precomputed for a list; a single row looks them up."""
    if last_received is None and db is not None:
        last_received = _last_received(db, [item.id])
    if protocol_names is None and db is not None:
        protocol_names = _protocol_names(db)
    return InventoryItemOut(id=item.id, name=item.name, unit=item.unit, stock=item.stock,
                            reorder_level=item.reorder_level, low=item.stock <= item.reorder_level,
                            medicine_id=item.medicine_id, ordered_at=item.ordered_at,
                            ordered_qty=item.ordered_qty, on_order=item.ordered_at is not None,
                            last_received_at=(last_received or {}).get(item.id),
                            auto_deducted=item.name.lower() in (protocol_names or set()))


def _last_received(db: Session, item_ids: list[int]) -> dict[int, datetime]:
    if not item_ids:
        return {}
    rows = db.execute(select(StockMovement.item_id, func.max(StockMovement.at))
                      .where(StockMovement.item_id.in_(item_ids), StockMovement.reason == "received",
                             StockMovement.delta > 0).group_by(StockMovement.item_id))
    return {i: t for i, t in rows}


def _protocol_names(db: Session) -> set[str]:
    from app.models.config import ProtocolStep

    return {n.lower() for n in db.scalars(select(ProtocolStep.name))}


def inventory_list_out(db: Session, items: list[InventoryItem]) -> list[InventoryItemOut]:
    last = _last_received(db, [i.id for i in items])
    names = _protocol_names(db)
    return [inventory_out(i, db, last, names) for i in items]


def create_item(db: Session, *, name: str | None, unit: str, stock: int, reorder_level: int,
                medicine_id: int | None, by: Staff | int | None) -> InventoryItem:
    """`addInventoryItem`; `name` defaults to the linked medicine's name when only `medicineId` is sent."""
    if unit not in INVENTORY_UNITS:
        raise BadValue(f"unit must be one of {INVENTORY_UNITS}")
    medicine = None
    if medicine_id is not None:
        medicine = db.get(Medicine, medicine_id)
        if medicine is None:
            raise BadValue(f"Unknown medicineId {medicine_id}")
    name = (name or "").strip() or (medicine.name if medicine else "")
    if not name:
        raise BadValue("name is required unless medicineId is given")
    if stock < 0:
        raise NegativeStock(name)
    if db.scalar(select(InventoryItem).where(func.lower(InventoryItem.name) == name.lower())):
        raise Duplicate(f"Inventory item '{name}' already exists")
    item = InventoryItem(name=name, unit=unit, stock=stock, reorder_level=reorder_level, medicine_id=medicine_id)
    db.add(item)
    db.flush()
    if stock:
        db.add(StockMovement(item_id=item.id, delta=stock, reason="received", by_staff_id=_staff_id(by)))
    db.add(AuditLog(staff_id=_staff_id(by), action="stock.create", entity="inventory_item", entity_id=item.id,
                    detail={"name": item.name, "stock": stock}))
    db.commit()
    return item


def update_item(db: Session, item: InventoryItem, values: dict, by: Staff | int | None) -> InventoryItem:
    if "unit" in values and values["unit"] not in INVENTORY_UNITS:
        raise BadValue(f"unit must be one of {INVENTORY_UNITS}")
    if "name" in values:
        dup = db.scalar(select(InventoryItem).where(func.lower(InventoryItem.name) == values["name"].strip().lower(),
                                                    InventoryItem.id != item.id))
        if dup:
            raise Duplicate(f"Inventory item '{values['name']}' already exists")
        values["name"] = values["name"].strip()
    for k, v in values.items():
        setattr(item, k, v)
    db.add(AuditLog(staff_id=_staff_id(by), action="stock.update", entity="inventory_item", entity_id=item.id,
                    detail=values))
    db.commit()
    return item


def adjust_stock(db: Session, item: InventoryItem, delta: int, reason: str, note: str | None,
                 by: Staff | int | None) -> StockMovement:
    """`adjustStock`: manual +/- with a movement row; never lets stock go negative."""
    if reason not in STOCK_REASONS:
        raise BadValue(f"reason must be one of {STOCK_REASONS}")
    if item.stock + delta < 0:
        raise NegativeStock(item.name)
    item.stock += delta
    if reason == "received" and delta > 0 and item.ordered_at is not None:
        # The order (or part of it) has arrived; anything short stays on order.
        remaining = (item.ordered_qty or 0) - delta
        if remaining > 0:
            item.ordered_qty = remaining
        else:
            item.ordered_at = None
            item.ordered_qty = None
    move = StockMovement(item_id=item.id, delta=delta, reason=reason, by_staff_id=_staff_id(by))
    db.add(move)
    db.add(AuditLog(staff_id=_staff_id(by), action="stock.adjust", entity="inventory_item", entity_id=item.id,
                    detail={"delta": delta, "reason": reason, "note": note or "", "stock": item.stock}))
    db.commit()
    return move


def movements(db: Session, item: InventoryItem, limit: int = 200) -> list[StockMovement]:
    return list(db.scalars(select(StockMovement).where(StockMovement.item_id == item.id)
                           .order_by(StockMovement.at.desc(), StockMovement.id.desc()).limit(limit)))


def movement_out(m: StockMovement) -> MovementOut:
    return MovementOut(id=m.id, item_id=m.item_id, delta=m.delta, reason=m.reason,
                       ref_prescription_id=m.ref_prescription_id, by_staff_id=m.by_staff_id, at=m.at)


def mark_ordered(db: Session, item: InventoryItem, ordered: bool, by: Staff | int | None,
                 qty: int | None = None) -> InventoryItem:
    """`ordered=True`: an order for `qty` has been placed — the low-stock alert stays quiet until stock
    is received (an adjust with reason "received" clears it, or reduces the outstanding quantity).
    `ordered=False` undoes that."""
    item.ordered_at = utcnow() if ordered else None
    item.ordered_qty = (qty or None) if ordered else None
    db.add(AuditLog(staff_id=_staff_id(by), action="stock.ordered" if ordered else "stock.order_cleared",
                    entity="inventory_item", entity_id=item.id, detail={"stock": item.stock, "qty": qty}))
    db.commit()
    return item
