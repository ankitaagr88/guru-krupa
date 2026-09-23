"""Visit kinds, clinic fee rules (day limits, emergency hours) and the fee suggested for a visit
(lane E2 owns this module).

Any staff: `GET /visit-kinds` (active, in order), `GET /fee-rules`, `GET /visits/{id}/fee` (the kind,
why it was suggested and the bill lines it puts on the bill) and `PUT /visits/{id}/kind`
{visitKindKey?, emergency?} — e.g. "Different problem -> New case"; an unpaid bill's suggested
line follows. Admin: `/admin/visit-kinds` (list incl. switched-off, create, patch, delete — 409 once
visits use it — and reorder) and `/admin/fee-rules` (GET / PUT any subset).
"""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.roles import ADMIN_ONLY, ANY_STAFF
from app.db import get_db
from app.models.patients import Visit
from app.models.staff import Staff
from app.routes import register
from app.schemas.admin import IdOrder
from app.schemas.fees import (FeeRules, FeeRulesPatch, VisitFeeOut, VisitKindIn, VisitKindOut, VisitKindPatch,
                              VisitKindSet)
from app.schemas.visits import VisitOut
from app.services import fees as svc
from app.services import queue

router = register(APIRouter(tags=["visit-fees"], dependencies=[Depends(get_current_user)]))

admin_user = Depends(require_role(*ADMIN_ONLY))


def _http(exc: svc.FeeError) -> HTTPException:
    code = {svc.NotFound: status.HTTP_404_NOT_FOUND, svc.Conflict: status.HTTP_409_CONFLICT,
            svc.BadValue: status.HTTP_422_UNPROCESSABLE_ENTITY}.get(type(exc), status.HTTP_400_BAD_REQUEST)
    return HTTPException(code, str(exc))


def _visit(db: Session, visit_id: int) -> Visit:
    visit = db.get(Visit, visit_id)
    if visit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Visit not found")
    return visit


# --------------------------------------------------------------------------- per visit
@router.get("/visits/{visit_id}/fee", response_model=VisitFeeOut)
def visit_fee(visit_id: int, db: Session = Depends(get_db)):
    return svc.visit_fee(db, _visit(db, visit_id))


@router.put("/visits/{visit_id}/kind", response_model=VisitOut)
def set_visit_kind(visit_id: int, data: VisitKindSet, db: Session = Depends(get_db),
                   user: Staff = Depends(require_role(*ANY_STAFF))):
    visit = _visit(db, visit_id)
    try:
        svc.set_visit_kind(db, visit, data.model_dump(exclude_unset=True), user)
    except svc.FeeError as exc:
        raise _http(exc)
    return queue.visits_out(db, [visit])[0]


# --------------------------------------------------------------------------- kinds + rules (read)
@router.get("/visit-kinds", response_model=list[VisitKindOut])
def active_visit_kinds(db: Session = Depends(get_db)):
    return svc.kinds_out(db, svc.visit_kinds(db, active_only=True))


@router.get("/fee-rules", response_model=FeeRules)
def fee_rules(db: Session = Depends(get_db)):
    return svc.get_rules(db)


# --------------------------------------------------------------------------- admin
@router.get("/admin/fee-rules", response_model=FeeRules)
def admin_fee_rules(db: Session = Depends(get_db), user: Staff = admin_user):
    return svc.get_rules(db)


@router.put("/admin/fee-rules", response_model=FeeRules)
def save_fee_rules(data: FeeRulesPatch, db: Session = Depends(get_db), user: Staff = admin_user):
    values = {k: v for k, v in data.model_dump(exclude_unset=True).items()
              if v is not None or k == "emergency_charge_id"}
    try:
        return svc.save_rules(db, values, user)
    except svc.FeeError as exc:
        raise _http(exc)


@router.get("/admin/visit-kinds", response_model=list[VisitKindOut])
def list_visit_kinds(db: Session = Depends(get_db), user: Staff = admin_user):
    return svc.kinds_out(db, svc.visit_kinds(db), with_use=True)


@router.post("/admin/visit-kinds", response_model=VisitKindOut, status_code=status.HTTP_201_CREATED)
def create_visit_kind(data: VisitKindIn, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.kind_out(db, svc.create_kind(db, data.label, data.standard_charge_id, user))
    except svc.FeeError as exc:
        raise _http(exc)


@router.put("/admin/visit-kinds/order", response_model=list[VisitKindOut])
def reorder_visit_kinds(data: IdOrder, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.kinds_out(db, svc.reorder_kinds(db, data.ids, user), with_use=True)
    except svc.FeeError as exc:
        raise _http(exc)


@router.patch("/admin/visit-kinds/{kind_id}", response_model=VisitKindOut)
def patch_visit_kind(kind_id: int, data: VisitKindPatch, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        row = svc.update_kind(db, svc.get_kind(db, kind_id), data.model_dump(exclude_unset=True), user)
        return svc.kinds_out(db, [row], with_use=True)[0]
    except svc.FeeError as exc:
        raise _http(exc)


@router.delete("/admin/visit-kinds/{kind_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_visit_kind(kind_id: int, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        svc.delete_kind(db, svc.get_kind(db, kind_id), user)
    except svc.FeeError as exc:
        raise _http(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
