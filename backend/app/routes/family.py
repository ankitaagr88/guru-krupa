"""Families on one mobile number: owner + members with their relation, and the admin relations list
(lane E1 owns this module).

Family (any staff):
  GET    /patients/{id}/family           the family card: owner first, then members; + others on the number
  POST   /patients/{id}/family           {ownerId, relationKey?} join that family (a member's owner if a member is given)
  PATCH  /patients/{id}/family           {relationKey} change a member's relation (null = not set)
  POST   /patients/{id}/family/owner     {oldOwnerRelationKey?} make this member the owner of the number
  DELETE /patients/{id}/family           remove from the family
Relations: GET /relations (any staff; ?includeInactive=true for the admin table); writes admin-only
under /admin/relations. Grouping: GET (preview) / POST (do) /admin/family/grouping, admin-only.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.roles import ADMIN_ONLY
from app.db import get_db
from app.models.config import Relation
from app.models.patients import Patient
from app.models.staff import Staff
from app.routes import register
from app.schemas.family import (FamilyLinkIn, FamilyOut, FamilyRelationIn, GroupingOut, MakeOwnerIn, RelationIn,
                                RelationOrder, RelationOut, RelationPatch)
from app.services import family as svc
from app.services.admin import AdminError, BadValue, Conflict, NotFound

router = register(APIRouter(tags=["family"], dependencies=[Depends(get_current_user)]))

admin_user = Depends(require_role(*ADMIN_ONLY))


def _http(exc: AdminError) -> HTTPException:
    code = {NotFound: status.HTTP_404_NOT_FOUND, Conflict: status.HTTP_409_CONFLICT,
            BadValue: status.HTTP_422_UNPROCESSABLE_ENTITY}.get(type(exc), status.HTTP_400_BAD_REQUEST)
    return HTTPException(code, str(exc))


def _patient(db: Session, patient_id: int) -> Patient:
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    return patient


def _relation_out(rel: Relation, counts: dict[str, int]) -> RelationOut:
    return RelationOut(id=rel.id, key=rel.key, label=rel.label, sort_order=rel.sort_order, active=rel.active,
                       patient_count=counts.get(rel.key, 0))


# --------------------------------------------------------------------------- the family card
@router.get("/patients/{patient_id}/family", response_model=FamilyOut)
def get_family(patient_id: int, db: Session = Depends(get_db)):
    return svc.family_out(db, _patient(db, patient_id))


@router.post("/patients/{patient_id}/family", response_model=FamilyOut)
def link_family(patient_id: int, data: FamilyLinkIn, db: Session = Depends(get_db),
                user: Staff = Depends(get_current_user)):
    patient = _patient(db, patient_id)
    try:
        message = svc.link(db, patient, data.owner_id, data.relation_key, by=user)
    except AdminError as exc:
        raise _http(exc)
    return svc.family_out(db, patient, message)


@router.patch("/patients/{patient_id}/family", response_model=FamilyOut)
def set_relation(patient_id: int, data: FamilyRelationIn, db: Session = Depends(get_db),
                 user: Staff = Depends(get_current_user)):
    patient = _patient(db, patient_id)
    try:
        svc.set_relation(db, patient, data.relation_key, by=user)
    except AdminError as exc:
        raise _http(exc)
    return svc.family_out(db, patient)


@router.post("/patients/{patient_id}/family/owner", response_model=FamilyOut)
def make_owner(patient_id: int, data: MakeOwnerIn, db: Session = Depends(get_db),
               user: Staff = Depends(get_current_user)):
    patient = _patient(db, patient_id)
    try:
        message = svc.make_owner(db, patient, data.old_owner_relation_key, by=user)
    except AdminError as exc:
        raise _http(exc)
    return svc.family_out(db, patient, message)


@router.delete("/patients/{patient_id}/family", response_model=FamilyOut)
def remove_from_family(patient_id: int, db: Session = Depends(get_db), user: Staff = Depends(get_current_user)):
    patient = _patient(db, patient_id)
    try:
        message = svc.remove(db, patient, by=user)
    except AdminError as exc:
        raise _http(exc)
    return svc.family_out(db, patient, message)


# --------------------------------------------------------------------------- relations list
@router.get("/relations", response_model=list[RelationOut])
def list_relations(include_inactive: bool = Query(False, alias="includeInactive"), db: Session = Depends(get_db)):
    """The switched-on relations in order (pickers); with includeInactive the admin table's full list."""
    counts = svc.relation_counts(db)
    return [_relation_out(r, counts) for r in svc.relations(db, include_inactive=include_inactive)]


@router.post("/admin/relations", response_model=RelationOut, status_code=status.HTTP_201_CREATED)
def create_relation(data: RelationIn, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return _relation_out(svc.create_relation(db, label=data.label, key=data.key, by=user), {})
    except AdminError as exc:
        raise _http(exc)


@router.put("/admin/relations/order", response_model=list[RelationOut])
def reorder_relations(data: RelationOrder, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        rows = svc.reorder_relations(db, data.keys, user)
    except AdminError as exc:
        raise _http(exc)
    counts = svc.relation_counts(db)
    return [_relation_out(r, counts) for r in rows]


@router.patch("/admin/relations/{key}", response_model=RelationOut)
def patch_relation(key: str, data: RelationPatch, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        rel = svc.update_relation(db, svc.get_relation(db, key), data.model_dump(exclude_unset=True), user)
    except AdminError as exc:
        raise _http(exc)
    return _relation_out(rel, svc.relation_counts(db))


@router.delete("/admin/relations/{key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_relation(key: str, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        svc.delete_relation(db, svc.get_relation(db, key), user)
    except AdminError as exc:
        raise _http(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- group by shared number
@router.get("/admin/family/grouping", response_model=GroupingOut)
def preview_grouping(db: Session = Depends(get_db), user: Staff = admin_user):
    """How many families "Group patients who share a number" would form. Nothing is written."""
    return svc.group_shared_numbers(db, write=False)


@router.post("/admin/family/grouping", response_model=GroupingOut)
def run_grouping(db: Session = Depends(get_db), user: Staff = admin_user):
    return svc.group_shared_numbers(db, write=True, by=user)
