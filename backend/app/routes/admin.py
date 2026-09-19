"""Admin configuration (`renderAdmin`): reads for any staff, writes admin-only.

Also `GET /config` — the lists every screen needs (stages, protocol, referral sources, lens
tiers, conditions), readable by any staff.
"""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.roles import ADMIN_ONLY
from app.db import get_db
from app.models.staff import Staff
from app.routes import register
from app.schemas.admin import (ConfigOut, IdOrder, LensTierIn, LensTierOut, LensTierPatch, PasswordIn,
                               ProtocolStepIn, ProtocolStepOut, ProtocolStepPatch, ReferralSourceIn,
                               ReferralSourceOut, ReferralSourcePatch, StaffIn, StaffPatch, StageIn, StageOrder,
                               StageOut, StagePatch)
from app.schemas.auth import StaffOut
from app.services import admin as svc

router = register(APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(get_current_user)]))
config_router = register(APIRouter(tags=["config"], dependencies=[Depends(get_current_user)]))

admin_user = Depends(require_role(*ADMIN_ONLY))
NO_CONTENT = Response(status_code=status.HTTP_204_NO_CONTENT)


def _http(exc: svc.AdminError) -> HTTPException:
    code = {svc.NotFound: status.HTTP_404_NOT_FOUND, svc.Conflict: status.HTTP_409_CONFLICT,
            svc.BadValue: status.HTTP_422_UNPROCESSABLE_ENTITY}.get(type(exc), status.HTTP_400_BAD_REQUEST)
    return HTTPException(code, str(exc))


def _patch_values(data) -> dict:
    return data.model_dump(exclude_unset=True, exclude_none=True)


# --------------------------------------------------------------------------- /config
@config_router.get("/config", response_model=ConfigOut)
def get_config(db: Session = Depends(get_db)):
    return svc.config(db)


# --------------------------------------------------------------------------- stages
@router.get("/stages", response_model=list[StageOut])
def list_stages(db: Session = Depends(get_db)):
    return svc.stages(db)


@router.post("/stages", response_model=StageOut, status_code=status.HTTP_201_CREATED)
def create_stage(data: StageIn, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.create_stage(db, key=data.key, label=data.label, cls=data.cls, by=user)
    except svc.AdminError as exc:
        raise _http(exc)


@router.put("/stages/order", response_model=list[StageOut])
def reorder_stages(data: StageOrder, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.reorder_stages(db, data.keys, user)
    except svc.AdminError as exc:
        raise _http(exc)


@router.patch("/stages/{key}", response_model=StageOut)
def patch_stage(key: str, data: StagePatch, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.update_stage(db, svc.get_stage(db, key), _patch_values(data), user)
    except svc.AdminError as exc:
        raise _http(exc)


@router.delete("/stages/{key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stage(key: str, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        svc.delete_stage(db, svc.get_stage(db, key), user)
    except svc.AdminError as exc:
        raise _http(exc)
    return NO_CONTENT


# --------------------------------------------------------------------------- protocol steps
@router.get("/protocol-steps", response_model=list[ProtocolStepOut])
def list_steps(db: Session = Depends(get_db)):
    return svc.protocol_steps(db)


@router.post("/protocol-steps", response_model=ProtocolStepOut, status_code=status.HTTP_201_CREATED)
def create_step(data: ProtocolStepIn, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.create_step(db, name=data.name, minutes=data.minutes, by=user)
    except svc.AdminError as exc:
        raise _http(exc)


@router.put("/protocol-steps/order", response_model=list[ProtocolStepOut])
def reorder_steps(data: IdOrder, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.reorder_steps(db, data.ids, user)
    except svc.AdminError as exc:
        raise _http(exc)


@router.patch("/protocol-steps/{step_id}", response_model=ProtocolStepOut)
def patch_step(step_id: int, data: ProtocolStepPatch, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.update_step(db, svc.get_step(db, step_id), _patch_values(data), user)
    except svc.AdminError as exc:
        raise _http(exc)


@router.delete("/protocol-steps/{step_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_step(step_id: int, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        svc.delete_step(db, svc.get_step(db, step_id), user)
    except svc.AdminError as exc:
        raise _http(exc)
    return NO_CONTENT


# --------------------------------------------------------------------------- referral sources
@router.get("/referral-sources", response_model=list[ReferralSourceOut])
def list_referral_sources(db: Session = Depends(get_db)):
    return svc.referral_sources(db)


@router.post("/referral-sources", response_model=ReferralSourceOut, status_code=status.HTTP_201_CREATED)
def create_referral_source(data: ReferralSourceIn, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.create_referral_source(db, key=data.key, label=data.label, needs_detail=data.needs_detail, by=user)
    except svc.AdminError as exc:
        raise _http(exc)


@router.patch("/referral-sources/{key}", response_model=ReferralSourceOut)
def patch_referral_source(key: str, data: ReferralSourcePatch, db: Session = Depends(get_db),
                          user: Staff = admin_user):
    try:
        return svc.update_referral_source(db, svc.get_referral_source(db, key), _patch_values(data), user)
    except svc.AdminError as exc:
        raise _http(exc)


@router.delete("/referral-sources/{key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_referral_source(key: str, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        svc.delete_referral_source(db, svc.get_referral_source(db, key), user)
    except svc.AdminError as exc:
        raise _http(exc)
    return NO_CONTENT


# --------------------------------------------------------------------------- lens tiers
@router.get("/lens-tiers", response_model=list[LensTierOut])
def list_lens_tiers(db: Session = Depends(get_db)):
    return svc.lens_tiers(db)


@router.post("/lens-tiers", response_model=LensTierOut, status_code=status.HTTP_201_CREATED)
def create_lens_tier(data: LensTierIn, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.create_lens_tier(db, key=data.key, label=data.label, price=data.price, by=user)
    except svc.AdminError as exc:
        raise _http(exc)


@router.patch("/lens-tiers/{key}", response_model=LensTierOut)
def patch_lens_tier(key: str, data: LensTierPatch, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.update_lens_tier(db, svc.get_lens_tier(db, key), _patch_values(data), user)
    except svc.AdminError as exc:
        raise _http(exc)


@router.delete("/lens-tiers/{key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lens_tier(key: str, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        svc.delete_lens_tier(db, svc.get_lens_tier(db, key), user)
    except svc.AdminError as exc:
        raise _http(exc)
    return NO_CONTENT


# --------------------------------------------------------------------------- staff
@router.get("/staff", response_model=list[StaffOut])
def list_staff(db: Session = Depends(get_db), user: Staff = admin_user):
    return svc.staff_list(db)


@router.post("/staff", response_model=StaffOut, status_code=status.HTTP_201_CREATED)
def create_staff(data: StaffIn, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.create_staff(db, name=data.name, username=data.username, password=data.password, role=data.role,
                                by=user)
    except svc.AdminError as exc:
        raise _http(exc)


@router.patch("/staff/{staff_id}", response_model=StaffOut)
def patch_staff(staff_id: int, data: StaffPatch, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.update_staff(db, svc.get_staff(db, staff_id), _patch_values(data), user)
    except svc.AdminError as exc:
        raise _http(exc)


@router.post("/staff/{staff_id}/reset-password", response_model=StaffOut)
def reset_password(staff_id: int, data: PasswordIn, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.reset_password(db, svc.get_staff(db, staff_id), data.password, user)
    except svc.AdminError as exc:
        raise _http(exc)
