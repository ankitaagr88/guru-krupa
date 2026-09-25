"""OT team: who was in the operating theatre for a surgery, including outside doctors / partners
(visiting surgeon, anaesthetist... not clinic staff) with their medical qualification, and the fee
each one adds to the surgery's bill.

Lists (admin-editable, switched off rather than deleted so old cases keep them):
  OtTeamRole  — Surgeon, Assistant surgeon, Anaesthetist... with the usual fee for that role.
  OtPartner   — the directory of outside doctors: name, qualification, reg. no., phone, usual role
                and usual fee.

On a case the team is `billing.team` (billing is the section every staff role may edit, and the
fees are billing): [{roleKey, roleLabel, name, qualification, regNo, external, partnerId, fee}].
Role label, name, qualification and reg. no. are copies (snapshots) — renaming a role or an outside
doctor later does not change old records. `clean_team` validates and tidies a team on every save.

Every admin write appends an AuditLog row. Errors are app.services.admin NotFound / Conflict /
BadValue (404 / 409 / 422 in the routes).
"""
import re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.ot import OtCase, OtPartner, OtTeamRole
from app.models.staff import Staff
from app.seed.ot_team import SURGEON_KEY
from app.services import rx_print
from app.services.admin import BadValue, Conflict, NotFound

STAFF_ROLES_IN_OT = ("doctor", "ot_staff", "optometrist")
MAX_NAME = 120
MAX_QUAL = 120
MAX_REG = 60


def _text(value, what: str, limit: int) -> str:
    s = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(s) > limit:
        raise BadValue(f"{what}: keep it under {limit} characters")
    return s


def _fee(value, where: str) -> int:
    if value is None or value == "":
        return 0
    if isinstance(value, bool):
        raise BadValue(f"{where}: the fee must be a number of rupees")
    if isinstance(value, float):
        if not value.is_integer():
            raise BadValue(f"{where}: the fee must be whole rupees (no paise)")
        value = int(value)
    if isinstance(value, str):
        s = value.strip().replace(",", "").removeprefix("₹").strip()
        if not re.fullmatch(r"-?\d+", s):
            raise BadValue(f"{where}: the fee must be whole rupees, e.g. 2500")
        value = int(s)
    if not isinstance(value, int):
        raise BadValue(f"{where}: the fee must be a number of rupees")
    if value < 0:
        raise BadValue(f"{where}: the fee cannot be below ₹0")
    return value


# --------------------------------------------------------------------------- lists
def roles(db: Session, include_inactive: bool = False) -> list[OtTeamRole]:
    stmt = select(OtTeamRole).order_by(OtTeamRole.sort_order, OtTeamRole.id)
    if not include_inactive:
        stmt = stmt.where(OtTeamRole.active.is_(True))
    return list(db.scalars(stmt))


def partners(db: Session, include_inactive: bool = False) -> list[OtPartner]:
    stmt = select(OtPartner).order_by(func.lower(OtPartner.name), OtPartner.id)
    if not include_inactive:
        stmt = stmt.where(OtPartner.active.is_(True))
    return list(db.scalars(stmt))


def staff_options(db: Session) -> list[dict]:
    rows = db.scalars(select(Staff).where(Staff.active.is_(True), Staff.role.in_(STAFF_ROLES_IN_OT))
                      .order_by(func.lower(Staff.name)))
    return [{"name": s.name, "role": s.role} for s in rows]


def options(db: Session) -> dict:
    return {"roles": roles(db), "partners": partners(db), "staff": staff_options(db)}


# --------------------------------------------------------------------------- admin: roles
def create_role(db: Session, *, label: str, default_fee: int, by) -> OtTeamRole:
    return rx_print.create_row(db, OtTeamRole, label=label, key=None, by=by, what="A team role",
                               entity="ot_team_role", default_fee=_fee(default_fee, "Usual fee"))


def get_role(db: Session, key: str) -> OtTeamRole:
    return rx_print.get_row(db, OtTeamRole, key, "Team role")


def update_role(db: Session, row: OtTeamRole, values: dict, by) -> OtTeamRole:
    changed = {}
    if values.get("label") is not None:
        label = rx_print._clean_label(db, OtTeamRole, values["label"], "A team role", exclude_id=row.id)
        if label != row.label:
            row.label = changed["label"] = label
    if values.get("default_fee") is not None:
        fee = _fee(values["default_fee"], "Usual fee")
        if fee != row.default_fee:
            row.default_fee = changed["default_fee"] = fee
    if values.get("active") is not None and values["active"] != row.active:
        row.active = changed["active"] = values["active"]
    rx_print._audit(db, by, "ot_team_role.update", "ot_team_role", row.id, key=row.key, **changed)
    db.commit()
    return row


def reorder_roles(db: Session, keys: list[str], by) -> list[OtTeamRole]:
    return rx_print.reorder_rows(db, OtTeamRole, keys, by, "ot_team_role")


# --------------------------------------------------------------------------- admin: outside doctors
def get_partner(db: Session, partner_id: int) -> OtPartner:
    row = db.get(OtPartner, partner_id)
    if row is None:
        raise NotFound("Outside doctor not found")
    return row


def _partner_values(db: Session, values: dict, row: OtPartner | None = None) -> dict:
    out = {}
    if values.get("name") is not None:
        name = _text(values["name"], "Name", MAX_NAME)
        if not name:
            raise BadValue("An outside doctor needs a name")
        stmt = select(OtPartner).where(func.lower(OtPartner.name) == name.lower())
        if row is not None:
            stmt = stmt.where(OtPartner.id != row.id)
        if db.scalar(stmt) is not None:
            raise Conflict(f"'{name}' is already on the list of outside doctors")
        out["name"] = name
    for field, what, limit in (("qualification", "Qualification", MAX_QUAL), ("reg_no", "Reg. no.", MAX_REG),
                               ("phone", "Phone", 20), ("note", "Note", 255)):
        if values.get(field) is not None:
            out[field] = _text(values[field], what, limit)
    if "qualification" in out and not out["qualification"]:
        raise BadValue("An outside doctor needs a medical qualification (e.g. MD Anaesthesia)")
    if "default_role_key" in values:
        key = values["default_role_key"] or None
        if key is not None and db.scalar(select(OtTeamRole).filter_by(key=key)) is None:
            raise BadValue(f"Unknown team role '{key}'")
        out["default_role_key"] = key
    if values.get("default_fee") is not None:
        out["default_fee"] = _fee(values["default_fee"], "Usual fee")
    if values.get("active") is not None:
        out["active"] = bool(values["active"])
    return out


def create_partner(db: Session, values: dict, by) -> OtPartner:
    values = {**values, "qualification": values.get("qualification") or ""}
    clean = _partner_values(db, values)
    row = OtPartner(**{"reg_no": "", "phone": "", "note": "", "default_fee": 0, **clean}, active=True)
    db.add(row)
    db.flush()
    rx_print._audit(db, by, "ot_partner.create", "ot_partner", row.id, **clean)
    db.commit()
    return row


def update_partner(db: Session, row: OtPartner, values: dict, by) -> OtPartner:
    clean = _partner_values(db, values, row)
    changed = {}
    for k, v in clean.items():
        if getattr(row, k) != v:
            setattr(row, k, v)
            changed[k] = v
    rx_print._audit(db, by, "ot_partner.update", "ot_partner", row.id, **changed)
    db.commit()
    return row


# --------------------------------------------------------------------------- the team on a case
def _row_empty(r: dict) -> bool:
    return not any(str(r.get(k) or "").strip() for k in ("name", "qualification", "regNo")) and not r.get("fee")


def clean_team(db: Session, team) -> list[dict]:
    """Validate and tidy a case's team list. Fully empty rows are dropped. Each row needs a known
    role and a name; the fee is whole rupees, ₹0 or more; an outside (external) member must have a
    medical qualification. Role label / name / qualification / reg. no. are kept as sent (snapshots);
    a missing role label is filled from the role list. BadValue names the row that is wrong."""
    if team is None:
        return []
    if not isinstance(team, list):
        raise BadValue("The OT team must be a list of team members")
    all_roles = {r.key: r for r in db.scalars(select(OtTeamRole))}
    out = []
    for i, raw in enumerate(team, start=1):
        if not isinstance(raw, dict):
            raise BadValue(f"OT team row {i}: not a team member")
        if _row_empty(raw):
            continue
        key = str(raw.get("roleKey") or "").strip()
        role = all_roles.get(key)
        where = f"OT team row {i}" + (f" ({role.label})" if role else "")
        if not key:
            raise BadValue(f"{where}: pick a role (Surgeon, Anaesthetist…)")
        if role is None:
            raise BadValue(f"{where}: unknown role '{key}'")
        name = _text(raw.get("name"), f"{where} name", MAX_NAME)
        if not name:
            raise BadValue(f"{where}: enter the person's name")
        where = f"OT team row {i} ({role.label}, {name})"
        qualification = _text(raw.get("qualification"), f"{where} qualification", MAX_QUAL)
        external = bool(raw.get("external"))
        if external and not qualification:
            raise BadValue(f"{where}: an outside doctor needs a medical qualification (e.g. MD Anaesthesia)")
        partner_id = raw.get("partnerId")
        if partner_id in ("", None):
            partner_id = None
        else:
            try:
                partner_id = int(partner_id)
            except (TypeError, ValueError):
                raise BadValue(f"{where}: unknown outside doctor")
            if db.get(OtPartner, partner_id) is None:
                raise BadValue(f"{where}: unknown outside doctor")
        out.append({
            "roleKey": key,
            "roleLabel": _text(raw.get("roleLabel"), f"{where} role", 80) or role.label,
            "name": name,
            "qualification": qualification,
            "regNo": _text(raw.get("regNo"), f"{where} reg. no.", MAX_REG),
            "external": external,
            "partnerId": partner_id,
            "fee": _fee(raw.get("fee"), where),
        })
    return out


def default_team(db: Session) -> list[dict]:
    """A new case starts with the clinic's doctor as Surgeon (name, degrees and reg. no. from the
    prescription print settings), at the Surgeon role's usual fee."""
    role = db.scalar(select(OtTeamRole).filter_by(key=SURGEON_KEY))
    settings = rx_print.get_settings(db)
    name = (settings.get("doctorName") or "").strip()
    if role is None or not role.active or not name:
        return []
    return [{"roleKey": role.key, "roleLabel": role.label, "name": name,
             "qualification": (settings.get("degrees") or "").strip(), "regNo": (settings.get("regNo") or "").strip(),
             "external": False, "partnerId": None, "fee": role.default_fee or 0}]


def team_of(db: Session | None, case_or_billing, operative: dict | None = None) -> list[dict]:
    """The team to show: the stored one, or for an older case saved before teams existed, its
    `operative.surgeon` as a Surgeon row (read only; nothing is written)."""
    if isinstance(case_or_billing, OtCase):
        billing, operative = case_or_billing.billing or {}, case_or_billing.operative or {}
    else:
        billing = case_or_billing or {}
    if isinstance(billing.get("team"), list):
        return billing["team"]
    surgeon = ((operative or {}).get("surgeon") or "").strip()
    if not surgeon:
        return []
    label = "Surgeon"
    if db is not None:
        role = db.scalar(select(OtTeamRole).filter_by(key=SURGEON_KEY))
        label = role.label if role else label
    return [{"roleKey": SURGEON_KEY, "roleLabel": label, "name": surgeon, "qualification": "", "regNo": "",
             "external": False, "partnerId": None, "fee": 0}]


def team_fees(team: list[dict] | None) -> int:
    total = 0
    for r in team or []:
        try:
            total += max(int(r.get("fee") or 0), 0)
        except (TypeError, ValueError):
            pass
    return total
