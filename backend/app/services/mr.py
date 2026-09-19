"""Medical-representative visit log (`renderMRs`, `addMrVisit`, `openMrDetail`)."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.mr import MrVisit
from app.models.staff import Staff
from app.schemas.mr import MrRepOut, MrVisitIn, MrVisitPatch
from app.services.queue import today


def _audit(db: Session, by: Staff | int | None, action: str, visit: MrVisit, **detail) -> None:
    db.add(AuditLog(staff_id=by.id if isinstance(by, Staff) else by, action=action, entity="mr_visit",
                    entity_id=visit.id, detail=detail))


def list_visits(db: Session, rep: str | None = None, company: str | None = None, limit: int = 500) -> list[MrVisit]:
    stmt = select(MrVisit).order_by(MrVisit.visit_date.desc(), MrVisit.id.desc()).limit(limit)
    if rep:
        stmt = stmt.where(func.lower(MrVisit.rep_name).like(f"%{rep.strip().lower()}%"))
    if company:
        stmt = stmt.where(func.lower(MrVisit.company).like(f"%{company.strip().lower()}%"))
    return list(db.scalars(stmt))


def create_visit(db: Session, data: MrVisitIn, by) -> MrVisit:
    values = data.model_dump()
    values["rep_name"] = values["rep_name"].strip()
    values["company"] = values["company"].strip()
    values["visit_date"] = values["visit_date"] or today()
    visit = MrVisit(**values)
    db.add(visit)
    db.flush()
    _audit(db, by, "mr_visit.create", visit, rep_name=visit.rep_name, company=visit.company)
    db.commit()
    return visit


def update_visit(db: Session, visit: MrVisit, data: MrVisitPatch, by) -> MrVisit:
    values = data.model_dump(exclude_unset=True)
    for k, v in values.items():
        if v is None and k not in ("phone", "next_visit_date"):
            continue
        setattr(visit, k, v.strip() if isinstance(v, str) and k in ("rep_name", "company") else v)
    _audit(db, by, "mr_visit.update", visit, **{k: str(v) for k, v in values.items()})
    db.commit()
    return visit


def delete_visit(db: Session, visit: MrVisit, by) -> None:
    _audit(db, by, "mr_visit.delete", visit, rep_name=visit.rep_name, company=visit.company)
    db.delete(visit)
    db.commit()


def reps(db: Session) -> list[MrRepOut]:
    """Group the log by (repName, company); phone/next visit come from the latest visit."""
    groups: dict[tuple[str, str], list[MrVisit]] = {}
    for v in list_visits(db, limit=100000):  # already newest first
        groups.setdefault((v.rep_name, v.company), []).append(v)
    out = []
    for (rep, company), visits in groups.items():
        latest = visits[0]
        products: list[str] = []
        for v in visits:
            for p in (v.products or "").split(","):
                p = p.strip()
                if p and p not in products:
                    products.append(p)
        out.append(MrRepOut(rep_name=rep, company=company, phone=latest.phone, visits=len(visits),
                            last_visit_date=latest.visit_date, next_visit_date=latest.next_visit_date,
                            products=products))
    return sorted(out, key=lambda r: (-r.last_visit_date.toordinal(), r.rep_name.lower()))
