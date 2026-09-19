"""Medical-representative visits (`renderMRs`, `addMrVisit`, `openMrDetail`)."""
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.roles import FRONT_DESK
from app.db import get_db
from app.models.mr import MrVisit
from app.models.staff import Staff
from app.routes import register
from app.schemas.mr import MrRepOut, MrVisitIn, MrVisitOut, MrVisitPatch
from app.services import mr as svc

router = register(APIRouter(prefix="/mr-visits", tags=["mr"], dependencies=[Depends(get_current_user)]))


def _get(db: Session, visit_id: int) -> MrVisit:
    visit = db.get(MrVisit, visit_id)
    if visit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MR visit not found")
    return visit


@router.get("", response_model=list[MrVisitOut])
def list_visits(rep: str | None = Query(None, max_length=120), company: str | None = Query(None, max_length=120),
                db: Session = Depends(get_db)):
    return svc.list_visits(db, rep, company)


@router.get("/reps", response_model=list[MrRepOut])
def reps(db: Session = Depends(get_db)):
    return svc.reps(db)


@router.post("", response_model=MrVisitOut, status_code=status.HTTP_201_CREATED)
def create_visit(data: MrVisitIn, db: Session = Depends(get_db), user: Staff = Depends(require_role(*FRONT_DESK))):
    return svc.create_visit(db, data, user)


@router.get("/{visit_id}", response_model=MrVisitOut)
def get_visit(visit_id: int, db: Session = Depends(get_db)):
    return _get(db, visit_id)


@router.patch("/{visit_id}", response_model=MrVisitOut)
def patch_visit(visit_id: int, data: MrVisitPatch, db: Session = Depends(get_db),
                user: Staff = Depends(require_role(*FRONT_DESK))):
    return svc.update_visit(db, _get(db, visit_id), data, user)


@router.delete("/{visit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_visit(visit_id: int, db: Session = Depends(get_db), user: Staff = Depends(require_role(*FRONT_DESK))):
    svc.delete_visit(db, _get(db, visit_id), user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
