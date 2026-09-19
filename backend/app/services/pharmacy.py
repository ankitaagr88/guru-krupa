"""Prescriptions (dispense + stock decrement, print payload), inventory movements, bills.

Mockup counterparts: `addMedManual`/`renderMeds`/`decrementInventory`/`pushLowStockToast`,
`adjustStock`/`addInventoryItem`, `renderBilling`/`addBillItem`/`selectPaymentMode`,
`openPrescriptionModal`/`setLanguage`.
"""
import re
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import utcnow
from app.models.audit import AuditLog
from app.models.billing import PAYMENT_MODES, Bill, BillItem
from app.models.patients import Visit
from app.models.pharmacy import (INVENTORY_UNITS, STOCK_REASONS, InventoryItem, Medicine,
                                 Prescription, PrescriptionLine, StockMovement)
from app.models.staff import Staff
from app.schemas.pharmacy import (BillItemOut, BillOut, InventoryItemOut, MovementOut, PrescriptionLineIn,
                                  PrescriptionLineOut, PrescriptionOut, PrintLine, PrintPayload)

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
def search_medicines(db: Session, q: str, limit: int = 50) -> list[Medicine]:
    stmt = select(Medicine).where(Medicine.active.is_(True)).order_by(Medicine.name).limit(limit)
    q = (q or "").strip().lower()
    if q:
        stmt = stmt.where(func.lower(Medicine.name).like(f"%{q}%"))
    rows = list(db.scalars(stmt))
    # prefix matches first, then substring
    return sorted(rows, key=lambda m: (not m.name.lower().startswith(q), m.name.lower())) if q else rows


def _medicine_for(db: Session, line: PrescriptionLineIn) -> Medicine | None:
    if line.medicine_id is not None:
        return db.get(Medicine, line.medicine_id)
    return db.scalar(select(Medicine).where(func.lower(Medicine.name) == line.name.strip().lower()))


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
                      by: Staff | int | None) -> tuple[Prescription, list[InventoryItem]]:
    """Create or replace the visit's prescription in one transaction.

    Replacing reverses the earlier stock movements (compensating "adjusted" rows), drops the old
    lines and dispenses the new ones. Raises InsufficientStock before anything is written.
    Returns (prescription, items now at/below their reorder level).
    """
    staff_id = _staff_id(by)
    lang = LANGUAGE_ALIASES.get((print_language or "").lower()) if print_language else None
    if print_language and lang is None:
        raise BadValue(f"printLanguage must be one of {sorted(LANGUAGE_ALIASES)}")

    rx = get_prescription(db, visit)
    try:
        if rx is None:
            rx = Prescription(visit_id=visit.id, print_language=lang or visit.patient.language or "english")
            db.add(rx)
            db.flush()
        else:
            if lang:
                rx.print_language = lang
            _reverse_movements(db, rx, staff_id)
            for old in list(rx.lines):
                db.delete(old)
            db.flush()

        # Resolve every line, aggregate the stock needed per item, and check before writing.
        resolved: list[tuple[PrescriptionLineIn, Medicine | None, InventoryItem | None]] = []
        needed: dict[int, int] = defaultdict(int)
        items: dict[int, InventoryItem] = {}
        for line in lines:
            med = _medicine_for(db, line)
            item = _item_for(db, line.name, med) if line.qty_given > 0 else None
            if item is not None:
                needed[item.id] += line.qty_given
                items[item.id] = item
            resolved.append((line, med, item))
        for item_id, qty in needed.items():
            item = items[item_id]
            if item.stock - qty < 0:
                raise InsufficientStock(item.name, item.stock, qty)

        for line, med, item in resolved:
            rx.lines.append(PrescriptionLine(medicine_id=med.id if med else None,
                                             name=med.name if med else line.name.strip(),
                                             matched=med is not None, dosage=line.dosage.strip(),
                                             qty_given=line.qty_given))
            if item is not None:
                item.stock -= line.qty_given
                db.add(StockMovement(item_id=item.id, delta=-line.qty_given, reason=DISPENSE_REASON,
                                     ref_prescription_id=rx.id, by_staff_id=staff_id))
        db.add(AuditLog(staff_id=staff_id, action="prescription.save", entity="prescription", entity_id=rx.id,
                        detail={"visitId": visit.id, "lines": len(lines)}))
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(rx)
    low = [it for it in items.values() if it.stock <= it.reorder_level]
    return rx, low


def _reverse_movements(db: Session, rx: Prescription, staff_id: int | None) -> None:
    moves = list(db.scalars(select(StockMovement).where(StockMovement.ref_prescription_id == rx.id)))
    net: dict[int, int] = defaultdict(int)
    for m in moves:
        net[m.item_id] += m.delta
    for item_id, delta in net.items():
        if delta == 0:
            continue
        item = db.get(InventoryItem, item_id)
        item.stock -= delta  # delta is negative for dispensed -> stock goes back up
        db.add(StockMovement(item_id=item_id, delta=-delta, reason=REVERSAL_REASON, ref_prescription_id=rx.id,
                             by_staff_id=staff_id))


def prescription_out(rx: Prescription, low: list[InventoryItem] | None = None) -> PrescriptionOut:
    return PrescriptionOut(
        id=rx.id, visit_id=rx.visit_id, print_language=rx.print_language, created_at=rx.created_at,
        lines=[PrescriptionLineOut(id=ln.id, medicine_id=ln.medicine_id, name=ln.name, matched=ln.matched,
                                   dosage=ln.dosage, qty_given=ln.qty_given) for ln in rx.lines],
        low_stock=[it.name for it in (low or [])])


def print_payload(rx: Prescription, lang: str | None) -> PrintPayload:
    """`openPrescriptionModal` + `setLanguage`: the sheet the client renders / prints."""
    visit = rx.visit
    patient = visit.patient
    code = LANGUAGE_ALIASES.get((lang or "").lower()) if lang else None
    if lang and code is None:
        raise BadValue(f"lang must be one of {sorted(LANGUAGE_ALIASES)}")
    code = code or rx.print_language or "english"
    return PrintPayload(
        hospital=HOSPITAL,
        patient={"name": patient.name, "age": patient.age, "sex": patient.sex, "token": visit.token,
                 "date": visit.date.isoformat()},
        language=LANGUAGE_NAMES.get(code, "english"),
        lines=[PrintLine(name=ln.name, dosage=ln.dosage, dosage_local=localize_dosage(ln.dosage, code),
                         qty_given=ln.qty_given) for ln in rx.lines])


# --------------------------------------------------------------------------- inventory
def list_inventory(db: Session, low_only: bool = False) -> list[InventoryItem]:
    rows = list(db.scalars(select(InventoryItem).order_by(InventoryItem.name)))
    return [r for r in rows if r.stock <= r.reorder_level] if low_only else rows


def inventory_out(item: InventoryItem) -> InventoryItemOut:
    return InventoryItemOut(id=item.id, name=item.name, unit=item.unit, stock=item.stock,
                            reorder_level=item.reorder_level, low=item.stock <= item.reorder_level,
                            medicine_id=item.medicine_id)


def create_item(db: Session, *, name: str, unit: str, stock: int, reorder_level: int, medicine_id: int | None,
                by: Staff | int | None) -> InventoryItem:
    if unit not in INVENTORY_UNITS:
        raise BadValue(f"unit must be one of {INVENTORY_UNITS}")
    if stock < 0:
        raise NegativeStock(name)
    if db.scalar(select(InventoryItem).where(func.lower(InventoryItem.name) == name.strip().lower())):
        raise Duplicate(f"Inventory item '{name}' already exists")
    if medicine_id is not None and db.get(Medicine, medicine_id) is None:
        raise BadValue(f"Unknown medicineId {medicine_id}")
    item = InventoryItem(name=name.strip(), unit=unit, stock=stock, reorder_level=reorder_level,
                         medicine_id=medicine_id)
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


# --------------------------------------------------------------------------- billing
def upsert_bill(db: Session, visit: Visit, items: list[tuple[str, int]], payment_mode: str | None) -> Bill:
    """`addBillItem`/`removeBillItem`/`selectPaymentMode`: replace the visit's bill items."""
    if payment_mode is not None and payment_mode not in PAYMENT_MODES:
        raise BadValue(f"paymentMode must be one of {PAYMENT_MODES}")
    bill = visit.bill
    if bill is None:
        bill = Bill(visit_id=visit.id)
        db.add(bill)
    for old in list(bill.items):
        db.delete(old)
    bill.items = [BillItem(label=label, amount=amount) for label, amount in items]
    if payment_mode is not None:
        bill.payment_mode = payment_mode
    db.commit()
    db.refresh(bill)
    return bill


def pay_bill(db: Session, bill: Bill, payment_mode: str) -> Bill:
    if payment_mode not in PAYMENT_MODES:
        raise BadValue(f"paymentMode must be one of {PAYMENT_MODES}")
    bill.payment_mode = payment_mode
    bill.paid_at = utcnow()
    db.commit()
    return bill


def bill_out(bill: Bill) -> BillOut:
    return BillOut(id=bill.id, visit_id=bill.visit_id,
                   items=[BillItemOut(id=i.id, label=i.label, amount=i.amount) for i in bill.items],
                   total=sum(i.amount for i in bill.items), payment_mode=bill.payment_mode, paid_at=bill.paid_at,
                   paid=bill.paid_at is not None)

