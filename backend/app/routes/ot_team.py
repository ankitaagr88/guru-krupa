"""OT team: the roles and the directory of outside doctors / partners. Shapes: `app.schemas.ot_team`.
The team of a case is saved through PATCH /ot/cases/{id} as `billing.team` (any staff; see
app.services.ot_team.clean_team — an outside member without a qualification is a 422 naming the row).

Any staff:
  GET  /ot/team-options          {roles:[switched-on roles], partners:[switched-on outside doctors],
                                  staff:[{name, role}] active doctors / OT staff / optometrists}
Admin only:
  GET    /admin/ot-team-roles        all roles (switched-off too)
  POST   /admin/ot-team-roles        {label, defaultFee}
  PUT    /admin/ot-team-roles/order  {keys}
  PATCH  /admin/ot-team-roles/{key}  {label?, defaultFee?, active?}
  GET    /admin/ot-partners          all outside doctors (switched-off too)
  POST   /admin/ot-partners          {name, qualification, regNo?, phone?, defaultRoleKey?, defaultFee?, note?}
  PATCH  /admin/ot-partners/{id}     any of those + active
Nothing here is deleted: roles and outside doctors are switched off (old cases keep their copies).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.roles import ADMIN_ONLY
from app.db import get_db
from app.models.staff import Staff
from app.routes import register
from app.schemas.ot_team import (KeyOrder, OtPartnerIn, OtPartnerOut, OtPartnerPatch, OtTeamOptionsOut,
                                 OtTeamRoleIn, OtTeamRoleOut, OtTeamRolePatch)
from app.services import ot_team as svc
from app.services.admin import AdminError, BadValue, Conflict, NotFound

router = register(APIRouter(tags=["ot"], dependencies=[Depends(get_current_user)]))

admin_user = Depends(require_role(*ADMIN_ONLY))


def _http(exc: AdminError) -> HTTPException:
    code = {NotFound: status.HTTP_404_NOT_FOUND, Conflict: status.HTTP_409_CONFLICT,
            BadValue: status.HTTP_422_UNPROCESSABLE_ENTITY}.get(type(exc), status.HTTP_400_BAD_REQUEST)
    return HTTPException(code, str(exc))


@router.get("/ot/team-options", response_model=OtTeamOptionsOut)
def team_options(db: Session = Depends(get_db)):
    return svc.options(db)


# --------------------------------------------------------------------------- admin: roles
@router.get("/admin/ot-team-roles", response_model=list[OtTeamRoleOut])
def admin_roles(db: Session = Depends(get_db), user: Staff = admin_user):
    return svc.roles(db, include_inactive=True)


@router.post("/admin/ot-team-roles", response_model=OtTeamRoleOut, status_code=status.HTTP_201_CREATED)
def create_role(data: OtTeamRoleIn, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.create_role(db, label=data.label, default_fee=data.default_fee, by=user)
    except AdminError as exc:
        db.rollback()
        raise _http(exc)


@router.put("/admin/ot-team-roles/order", response_model=list[OtTeamRoleOut])
def reorder_roles(data: KeyOrder, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.reorder_roles(db, data.keys, user)
    except AdminError as exc:
        db.rollback()
        raise _http(exc)


@router.patch("/admin/ot-team-roles/{key}", response_model=OtTeamRoleOut)
def patch_role(key: str, data: OtTeamRolePatch, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.update_role(db, svc.get_role(db, key), data.model_dump(exclude_unset=True), user)
    except AdminError as exc:
        db.rollback()
        raise _http(exc)


# --------------------------------------------------------------------------- admin: outside doctors
@router.get("/admin/ot-partners", response_model=list[OtPartnerOut])
def admin_partners(db: Session = Depends(get_db), user: Staff = admin_user):
    return svc.partners(db, include_inactive=True)


@router.post("/admin/ot-partners", response_model=OtPartnerOut, status_code=status.HTTP_201_CREATED)
def create_partner(data: OtPartnerIn, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.create_partner(db, data.model_dump(), user)
    except AdminError as exc:
        db.rollback()
        raise _http(exc)


@router.patch("/admin/ot-partners/{partner_id}", response_model=OtPartnerOut)
def patch_partner(partner_id: int, data: OtPartnerPatch, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.update_partner(db, svc.get_partner(db, partner_id), data.model_dump(exclude_unset=True), user)
    except AdminError as exc:
        db.rollback()
        raise _http(exc)
