"""Visit kinds and the clinic's fee rules (lane E2 owns this module).

A visit's *kind* (new patient, free follow-up, follow-up, new case, after surgery...) is suggested
when it is registered, from the fee rules (ClinicSetting "fee_rules", edited in Admin):

- no earlier completed visit (imported KiviHealth visits count) -> new patient;
- a completed surgery within `postOpDays` of the visit day -> after surgery (rule to confirm with
  Dr Anu; default: free for 30 days);
- otherwise by days since the last completed visit: up to `freeFollowUpDays` -> free follow-up,
  up to `newCaseAfterDays` -> follow-up, more -> new case.

Registered between `emergencyFrom` and `emergencyTo` (clinic time; the window may cross midnight)
or on a Sunday -> the emergency fee is suggested too. Reception can change both.

The kind's standard charge (none = free) and the emergency charge are the visit's *suggested* bill
lines: a new bill starts with them, and changing the kind swaps that line — never duplicated, and
lines reception typed are never touched.
"""
import re
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import utcnow
from app.models.audit import AuditLog
from app.models.billing import Bill, BillItem, StandardCharge
from app.models.config import ClinicSetting, VisitKind
from app.models.ot import OtCase
from app.models.patients import Visit
from app.models.staff import Staff
from app.schemas.fees import FeeRules

RULES_KEY = "fee_rules"
KIND_FIELDS = ("new_patient_kind", "free_follow_up_kind", "follow_up_kind", "new_case_kind", "post_op_kind")


class FeeError(Exception):
    pass


class BadValue(FeeError, ValueError):
    pass


class NotFound(FeeError):
    pass


class Conflict(FeeError):
    pass


def _audit(db: Session, by, action: str, entity: str, entity_id: int | None, **detail) -> None:
    staff_id = by.id if isinstance(by, Staff) else by
    db.add(AuditLog(staff_id=staff_id, action=action, entity=entity, entity_id=entity_id, detail=detail))


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)  # SQLite drops tzinfo


# --------------------------------------------------------------------------- rules
def get_rules(db: Session) -> FeeRules:
    row = db.get(ClinicSetting, RULES_KEY)
    try:
        return FeeRules.model_validate(row.value if row and row.value else {})
    except ValidationError:  # a hand-edited row went bad — fall back to the defaults
        return FeeRules()


def save_rules(db: Session, values: dict, by) -> FeeRules:
    merged = {**get_rules(db).model_dump(), **values}
    try:
        rules = FeeRules.model_validate(merged)
    except ValidationError as exc:
        raise BadValue("; ".join(e["msg"].removeprefix("Value error, ") for e in exc.errors())) from None
    for field in KIND_FIELDS:
        if _kind(db, getattr(rules, field)) is None:
            raise BadValue(f"Unknown visit kind '{getattr(rules, field)}'")
    if rules.emergency_charge_id is not None and db.get(StandardCharge, rules.emergency_charge_id) is None:
        raise BadValue(f"Unknown standardChargeId {rules.emergency_charge_id}")
    row = db.get(ClinicSetting, RULES_KEY)
    value = rules.model_dump(by_alias=True)
    if row is None:
        db.add(ClinicSetting(key=RULES_KEY, value=value))
    else:
        row.value = value
    _audit(db, by, "fee_rules.update", "clinic_setting", None, **{k: v for k, v in values.items()})
    db.commit()
    return rules


def is_emergency(rules: FeeRules, at: datetime) -> bool:
    """Registered in the night window (clinic time) or on a Sunday."""
    local = _aware(at).astimezone(ZoneInfo(settings.CLINIC_TZ))
    if rules.emergency_on_sunday and local.weekday() == 6:
        return True
    start, end = (time.fromisoformat(rules.emergency_from), time.fromisoformat(rules.emergency_to))
    t = local.time()
    if start == end:
        return False  # no night window
    if start < end:
        return start <= t < end
    return t >= start or t < end  # crosses midnight (20:00 -> 08:00)


# --------------------------------------------------------------------------- suggestion
@dataclass
class History:
    last_visit: date | None  # latest earlier completed visit
    surgery: date | None  # latest completed surgery on or before the visit day


def history(db: Session, patient_id: int, on: date, exclude_visit_id: int | None = None) -> History:
    return histories(db, [(patient_id, on, exclude_visit_id)])[(patient_id, on, exclude_visit_id)]


def histories(db: Session, keys: list[tuple[int, date, int | None]]) -> dict[tuple, History]:
    """(patient id, visit day, the visit itself) -> History, in two queries for a whole board."""
    if not keys:
        return {}
    pids = {k[0] for k in keys}
    latest = max(k[1] for k in keys)
    visits: dict[int, list[tuple[int, date]]] = {}
    for pid, vid, d in db.execute(select(Visit.patient_id, Visit.id, Visit.date).where(
            Visit.patient_id.in_(pids), Visit.status == "completed", Visit.date <= latest)):
        visits.setdefault(pid, []).append((vid, d))
    surgeries: dict[int, list[date]] = {}
    for pid, d in db.execute(select(OtCase.patient_id, OtCase.date).where(
            OtCase.patient_id.in_(pids), OtCase.status == "completed", OtCase.date <= latest)):
        surgeries.setdefault(pid, []).append(d)
    out = {}
    for pid, on, own in keys:
        # Earlier = an earlier day, or a completed visit earlier the same day (came twice).
        days = [d for vid, d in visits.get(pid, []) if vid != own and (d < on or (d == on and (own is None or vid < own)))]
        ots = [d for d in surgeries.get(pid, []) if d <= on]
        out[(pid, on, own)] = History(max(days) if days else None, max(ots) if ots else None)
    return out


def suggest_kind(rules: FeeRules, h: History, on: date) -> str:
    if h.last_visit is None:
        return rules.new_patient_kind
    if h.surgery is not None and (on - h.surgery).days <= rules.post_op_days:
        return rules.post_op_kind
    days = (on - h.last_visit).days
    if days <= rules.free_follow_up_days:
        return rules.free_follow_up_kind
    if days <= rules.new_case_after_days:
        return rules.follow_up_kind
    return rules.new_case_kind


def _days(n: int) -> str:
    return f"{n} day{'' if n == 1 else 's'}"


def reason(rules: FeeRules, h: History, on: date) -> str:
    """Plain words for reception: why this kind was suggested."""
    if h.last_visit is None:
        return "No earlier visit on record"
    days = (on - h.last_visit).days
    text = "Last visit earlier today" if days == 0 else f"Last visit {_days(days)} ago"
    if h.surgery is not None and (on - h.surgery).days <= rules.post_op_days:
        ago = (on - h.surgery).days
        text += " · surgery today" if ago == 0 else f" · surgery {_days(ago)} ago"
    return text


def apply_suggestion(db: Session, visit: Visit, patient_id: int, on: date, at: datetime | None = None) -> None:
    """Registration: store the suggested kind and emergency flag on a new visit (no commit)."""
    rules = get_rules(db)
    key = suggest_kind(rules, history(db, patient_id, on, visit.id), on)
    visit.visit_kind_key = key if _kind(db, key, active_only=True) is not None else None
    visit.emergency = is_emergency(rules, at or utcnow()) and rules.emergency_charge_id is not None


# --------------------------------------------------------------------------- visit kinds
def _kind(db: Session, key: str | None, active_only: bool = False) -> VisitKind | None:
    if not key:
        return None
    row = db.scalar(select(VisitKind).filter_by(key=key))
    if row is None or (active_only and not row.active):
        return None
    return row


def visit_kinds(db: Session, active_only: bool = False) -> list[VisitKind]:
    stmt = select(VisitKind).order_by(VisitKind.sort_order, VisitKind.id)
    if active_only:
        stmt = stmt.where(VisitKind.active.is_(True))
    return list(db.scalars(stmt))


def visit_kinds_by_key(db: Session) -> dict[str, VisitKind]:
    return {k.key: k for k in visit_kinds(db)}


def kind_out(db: Session, row: VisitKind, in_use: int = 0) -> dict:
    charge = db.get(StandardCharge, row.standard_charge_id) if row.standard_charge_id else None
    return {"id": row.id, "key": row.key, "label": row.label, "standard_charge_id": row.standard_charge_id,
            "charge_label": charge.label if charge else None, "charge_amount": charge.amount if charge else None,
            "sort_order": row.sort_order, "active": row.active, "in_use": in_use}


def kinds_out(db: Session, rows: list[VisitKind], with_use: bool = False) -> list[dict]:
    used = {}
    if with_use:
        used = dict(db.execute(select(Visit.visit_kind_key, func.count()).where(Visit.visit_kind_key.is_not(None))
                               .group_by(Visit.visit_kind_key)).all())
    return [kind_out(db, r, used.get(r.key, 0)) for r in rows]


def get_kind(db: Session, kind_id: int) -> VisitKind:
    row = db.get(VisitKind, kind_id)
    if row is None:
        raise NotFound("Visit kind not found")
    return row


def _label(db: Session, label: str, except_id: int | None = None) -> str:
    label = " ".join((label or "").split())
    if not label:
        raise BadValue("Name is required")
    q = select(VisitKind).where(func.lower(VisitKind.label) == label.lower())
    if except_id is not None:
        q = q.where(VisitKind.id != except_id)
    if db.scalar(q):
        raise Conflict(f"Visit kind '{label}' already exists")
    return label


def _charge_id(db: Session, charge_id: int | None) -> int | None:
    if charge_id is not None and db.get(StandardCharge, charge_id) is None:
        raise BadValue(f"Unknown standardChargeId {charge_id}")
    return charge_id


def _new_key(db: Session, label: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:24] or "kind"
    key, n = base, 1
    while db.scalar(select(VisitKind).filter_by(key=key)) is not None:
        n += 1
        key = f"{base}_{n}"
    return key


def create_kind(db: Session, label: str, standard_charge_id: int | None, by) -> VisitKind:
    label = _label(db, label)
    order = (db.scalar(select(func.max(VisitKind.sort_order))) or 0) + 1
    row = VisitKind(key=_new_key(db, label), label=label, standard_charge_id=_charge_id(db, standard_charge_id),
                    sort_order=order, active=True)
    db.add(row)
    db.flush()
    _audit(db, by, "visit_kind.create", "visit_kind", row.id, key=row.key, label=label)
    db.commit()
    return row


def _rule_uses(db: Session, key: str) -> list[str]:
    rules = get_rules(db)
    return [f for f in KIND_FIELDS if getattr(rules, f) == key]


def update_kind(db: Session, row: VisitKind, values: dict, by) -> VisitKind:
    changed = {}
    if values.get("label") is not None:
        label = _label(db, values["label"], row.id)
        if label != row.label:
            row.label = changed["label"] = label
    if "standard_charge_id" in values and values["standard_charge_id"] != row.standard_charge_id:
        row.standard_charge_id = changed["standard_charge_id"] = _charge_id(db, values["standard_charge_id"])
    if values.get("active") is not None and values["active"] != row.active:
        if not values["active"] and _rule_uses(db, row.key):
            raise Conflict(f"'{row.label}' is used by a fee rule below — pick another kind there first")
        row.active = changed["active"] = values["active"]
    if changed:
        _audit(db, by, "visit_kind.update", "visit_kind", row.id, **changed)
        db.commit()
    return row


def delete_kind(db: Session, row: VisitKind, by) -> None:
    if _rule_uses(db, row.key):
        raise Conflict(f"'{row.label}' is used by a fee rule — pick another kind there first")
    n = db.scalar(select(func.count()).select_from(Visit).where(Visit.visit_kind_key == row.key)) or 0
    if n:
        raise Conflict(f"'{row.label}' is on {n} visit{'' if n == 1 else 's'} — switch it off instead")
    _audit(db, by, "visit_kind.delete", "visit_kind", row.id, key=row.key, label=row.label)
    db.delete(row)
    db.commit()


def reorder_kinds(db: Session, ids: list[int], by) -> list[VisitKind]:
    rows = {r.id: r for r in db.scalars(select(VisitKind))}
    if set(ids) != set(rows) or len(ids) != len(rows):
        raise BadValue("order must list every existing visit kind exactly once")
    for i, kid in enumerate(ids):
        rows[kid].sort_order = i
    _audit(db, by, "visit_kind.reorder", "visit_kind", None, order=[str(k) for k in ids])
    db.commit()
    return visit_kinds(db)


# --------------------------------------------------------------------------- suggested bill lines
def fee_charge_ids(db: Session, rules: FeeRules | None = None) -> tuple[set[int], int | None]:
    """(charges any visit kind puts on a bill, the emergency charge). Bill lines from these are the
    visit's *suggested* fee lines."""
    rules = rules or get_rules(db)
    kind_ids = {cid for cid in db.scalars(select(VisitKind.standard_charge_id)) if cid is not None}
    emergency = rules.emergency_charge_id
    kind_ids.discard(emergency)
    return kind_ids, emergency


def _line(charge: StandardCharge) -> BillItem:
    return BillItem(label=charge.label, amount=charge.amount, kind="charge", qty=1, standard_charge_id=charge.id)


def kind_charge(db: Session, visit: Visit) -> StandardCharge | None:
    kind = _kind(db, visit.visit_kind_key)
    return db.get(StandardCharge, kind.standard_charge_id) if kind and kind.standard_charge_id else None


def emergency_charge(db: Session, visit: Visit, rules: FeeRules | None = None) -> StandardCharge | None:
    rules = rules or get_rules(db)
    if not visit.emergency or rules.emergency_charge_id is None:
        return None
    return db.get(StandardCharge, rules.emergency_charge_id)


def suggested_items(db: Session, visit: Visit) -> list[BillItem]:
    """The lines a brand-new bill starts with: the kind's fee, then Emergency when flagged."""
    return [_line(c) for c in (kind_charge(db, visit), emergency_charge(db, visit)) if c is not None]


def fee_note(db: Session, visit: Visit, rules: FeeRules | None = None) -> str:
    """"Follow-up within 6 days — no charge" so a ₹0 visit fee doesn't puzzle reception."""
    kind = _kind(db, visit.visit_kind_key)
    if kind is None or kind.standard_charge_id is not None:
        return ""
    rules = rules or get_rules(db)
    if kind.key == rules.free_follow_up_kind:
        return f"Follow-up within {_days(rules.free_follow_up_days)} — no charge"
    if kind.key == rules.post_op_kind:
        return f"After surgery (within {_days(rules.post_op_days)}) — no charge"
    return f"{kind.label} — no charge"


def sync_bill(db: Session, visit: Visit) -> None:
    """The kind / emergency flag changed: swap the suggested lines on a bill nobody has paid anything
    on yet (a part-paid bill keeps its fee: money was taken against it). The visit-fee line is updated
    in place (one line, never two); lines reception typed are left alone. No commit."""
    bill: Bill | None = visit.bill
    if bill is None or bill.paid_at is not None or bill.payments:
        return
    rules = get_rules(db)
    kind_ids, emergency_id = fee_charge_ids(db, rules)
    fee_lines = [i for i in bill.items if i.kind == "charge" and i.standard_charge_id in kind_ids]
    charge = kind_charge(db, visit)
    if charge is not None:
        keep = fee_lines.pop(0) if fee_lines else None
        if keep is None:
            bill.items.append(_line(charge))
        else:
            keep.label, keep.amount, keep.standard_charge_id, keep.qty, keep.eyes = (
                charge.label, charge.amount, charge.id, 1, None)
    for item in fee_lines:
        bill.items.remove(item)
        db.delete(item)
    if emergency_id is not None:
        em_lines = [i for i in bill.items if i.kind == "charge" and i.standard_charge_id == emergency_id]
        em = emergency_charge(db, visit, rules)
        if em is not None and not em_lines:
            bill.items.append(_line(em))
        elif em is None:
            for item in em_lines:
                bill.items.remove(item)
                db.delete(item)


def set_visit_kind(db: Session, visit: Visit, values: dict, by) -> Visit:
    """Reception / doctor changes the kind ("Different problem -> New case") or the emergency flag."""
    changed = {}
    if values.get("visit_kind_key") is not None:
        kind = _kind(db, values["visit_kind_key"], active_only=True)
        if kind is None:
            raise BadValue(f"Unknown visit kind '{values['visit_kind_key']}'")
        if kind.key != visit.visit_kind_key:
            changed["visit_kind_key"] = [visit.visit_kind_key, kind.key]
            visit.visit_kind_key = kind.key
    if values.get("emergency") is not None and bool(values["emergency"]) != bool(visit.emergency):
        changed["emergency"] = bool(values["emergency"])
        visit.emergency = bool(values["emergency"])
    if changed:
        sync_bill(db, visit)
        _audit(db, by, "visit.kind", "visit", visit.id, **changed)
        db.commit()
    return visit


# --------------------------------------------------------------------------- read-outs
def visit_fee_fields(db: Session, visits: list[Visit]) -> dict[int, dict]:
    """VisitOut extras for a board of visits: kind label, whether it is free, days since the last
    visit and the reason in plain words."""
    if not visits:
        return {}
    rules = get_rules(db)
    kinds = {k.key: k for k in visit_kinds(db)}
    charges = {c.id: c for c in db.scalars(select(StandardCharge))}
    hist = histories(db, [(v.patient_id, v.date, v.id) for v in visits])
    out = {}
    for v in visits:
        h = hist[(v.patient_id, v.date, v.id)]
        kind = kinds.get(v.visit_kind_key or "")
        charge = charges.get(kind.standard_charge_id) if kind and kind.standard_charge_id else None
        out[v.id] = {
            "visit_kind_key": v.visit_kind_key,
            "visit_kind_label": kind.label if kind else None,
            "visit_kind_charge": charge.amount if charge else None,
            "emergency": bool(v.emergency),
            "days_since_last_visit": (v.date - h.last_visit).days if h.last_visit else None,
            "fee_reason": reason(rules, h, v.date),
        }
    return out


def visit_fee(db: Session, visit: Visit) -> dict:
    rules = get_rules(db)
    h = history(db, visit.patient_id, visit.date, visit.id)
    kind = _kind(db, visit.visit_kind_key)
    lines = [{"label": c.label, "amount": c.amount, "standard_charge_id": c.id}
             for c in (kind_charge(db, visit), emergency_charge(db, visit, rules)) if c is not None]
    return {"visit_id": visit.id, "visit_kind_key": visit.visit_kind_key,
            "visit_kind_label": kind.label if kind else None,
            "suggested_kind_key": suggest_kind(rules, h, visit.date), "emergency": bool(visit.emergency),
            "suggested_emergency": is_emergency(rules, visit.created_at or utcnow()),
            "days_since_last_visit": (visit.date - h.last_visit).days if h.last_visit else None,
            "reason": reason(rules, h, visit.date), "lines": lines, "note": fee_note(db, visit, rules)}
