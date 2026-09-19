from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.roles import ADMIN_ONLY, ANY_STAFF, DOCTOR_ONLY
from app.db import get_db
from app.models.patients import Visit
from app.models.staff import Staff
from app.routes import register
from app.schemas.dilation import DilationRunOut
from app.services import dilation as svc

# Mounted under /visits/{id}/dilation (per-visit resource), tagged separately from the queue routes.
router = register(APIRouter(prefix="/visits", tags=["dilation"], dependencies=[Depends(get_current_user)]))


def _visit(db: Session, visit_id: int) -> Visit:
    visit = db.get(Visit, visit_id)
    if visit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Visit not found")
    return visit


def _run(db: Session, visit_id: int):
    try:
        return svc.get_run(db, _visit(db, visit_id))
    except svc.NoRun:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No dilation run for this visit")


def _translate(exc: svc.DilationError) -> HTTPException:
    if isinstance(exc, svc.NoSuchStep):
        return HTTPException(status.HTTP_404_NOT_FOUND, "No such step")
    if isinstance(exc, svc.OutOfOrder):
        return HTTPException(status.HTTP_409_CONFLICT, str(exc))
    if isinstance(exc, svc.RunExists):
        return HTTPException(status.HTTP_409_CONFLICT, "Dilation already started for this visit")
    if isinstance(exc, svc.NoProtocolSteps):
        return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                             "Add at least one step to the dilation protocol in Admin first")
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


@router.get("/{visit_id}/dilation", response_model=DilationRunOut)
def get_dilation(visit_id: int, db: Session = Depends(get_db)):
    return svc.run_out(_run(db, visit_id))


@router.post("/{visit_id}/dilation/start", response_model=DilationRunOut, status_code=status.HTTP_201_CREATED)
def start_dilation(visit_id: int, db: Session = Depends(get_db), user: Staff = Depends(require_role(*ANY_STAFF))):
    visit = _visit(db, visit_id)
    try:
        run = svc.start_run(db, visit, user)
    except svc.DilationError as exc:
        db.rollback()
        raise _translate(exc)
    return svc.run_out(run)


@router.post("/{visit_id}/dilation/steps/{n}/given", response_model=DilationRunOut,
             dependencies=[Depends(require_role(*ANY_STAFF))])
def step_given(visit_id: int, n: int, db: Session = Depends(get_db)):
    run = _run(db, visit_id)
    try:
        return svc.run_out(svc.mark_given(db, run, n))
    except svc.DilationError as exc:
        raise _translate(exc)


@router.post("/{visit_id}/dilation/steps/{n}/done", response_model=DilationRunOut,
             dependencies=[Depends(require_role(*ANY_STAFF))])
def step_done(visit_id: int, n: int, db: Session = Depends(get_db)):
    run = _run(db, visit_id)
    try:
        return svc.run_out(svc.mark_done(db, run, n))
    except svc.DilationError as exc:
        raise _translate(exc)


@router.delete("/{visit_id}/dilation", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[Depends(require_role(*ADMIN_ONLY, *DOCTOR_ONLY))])
def cancel_dilation(visit_id: int, db: Session = Depends(get_db)):
    visit = _visit(db, visit_id)
    try:
        svc.cancel_run(db, visit)
    except svc.NoRun:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No dilation run for this visit")
