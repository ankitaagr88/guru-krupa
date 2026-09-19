"""Dilation protocol per visit (`startDilationProtocol`, `tickStep`, `checkTimers`, `renderDilationChecklist`).

The server stores timestamps only; countdown timers run client-side from `startedAt` / `dueAt`.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import utcnow
from app.models.config import ProtocolStep
from app.models.dilation import DilationRun, DilationStep
from app.models.patients import Visit
from app.models.staff import Staff
from app.schemas.dilation import DilationRunOut, DilationStepDetail
from app.services import queue

DILATE_STAGE = "dilate"


class DilationError(Exception):
    pass


class RunExists(DilationError):
    pass


class NoRun(DilationError):
    pass


class NoProtocolSteps(DilationError):
    pass


class NoSuchStep(DilationError):
    pass


class OutOfOrder(DilationError):
    """Step n is not the current step, or given/done was called in the wrong state."""


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)  # SQLite drops tzinfo


def protocol_steps(db: Session) -> list[ProtocolStep]:
    return list(db.scalars(select(ProtocolStep).order_by(ProtocolStep.sort_order, ProtocolStep.id)))


def get_run(db: Session, visit: Visit) -> DilationRun:
    run = visit.dilation_run
    if run is None:
        raise NoRun(visit.id)
    return run


def is_complete(run: DilationRun) -> bool:
    return run.current_index >= len(run.steps)


def start_run(db: Session, visit: Visit, by_staff: Staff | int | None) -> DilationRun:
    """Snapshot the current protocol into a run. No step is given yet: the technician ticks
    step 0 (`tickStep`) when the first drop is actually instilled, as in the mockup.
    Moves the visit to the `dilate` stage (audited) if it is not there already.
    Raises RunExists, NoProtocolSteps."""
    if visit.dilation_run is not None:
        raise RunExists(visit.id)
    steps = protocol_steps(db)
    if not steps:
        raise NoProtocolSteps()
    now = utcnow()
    run = DilationRun(visit_id=visit.id, current_index=0, started_at=now)
    run.steps = [DilationStep(sort_order=i, name=s.name, minutes=s.minutes, given=False, started_at=None,
                              done=False) for i, s in enumerate(steps)]
    db.add(run)
    db.flush()
    visit.dilation_run = run
    if visit.stage_key != DILATE_STAGE:
        queue.move_stage(db, visit, DILATE_STAGE, by_staff)  # commits
    else:
        db.commit()
    return run


def _step(run: DilationRun, n: int) -> DilationStep:
    if n < 0 or n >= len(run.steps):
        raise NoSuchStep(n)
    if n != run.current_index:
        raise OutOfOrder(f"step {n} is not the current step ({run.current_index})")
    return run.steps[n]


def mark_given(db: Session, run: DilationRun, n: int) -> DilationRun:
    """`tickStep`: drop n was instilled; the wait starts now. n must be the current step and not yet given."""
    step = _step(run, n)
    if step.given:
        raise OutOfOrder(f"step {n} already given")
    step.given = True
    step.started_at = utcnow()
    db.commit()
    return run


def mark_done(db: Session, run: DilationRun, n: int) -> DilationRun:
    """`checkTimers` auto-advance: wait for step n is over; move on to n+1. n must be current and given."""
    step = _step(run, n)
    if not step.given:
        raise OutOfOrder(f"step {n} not given yet")
    step.done = True
    run.current_index = n + 1
    db.commit()
    return run


def cancel_run(db: Session, visit: Visit) -> None:
    run = get_run(db, visit)
    visit.dilation_run = None
    db.delete(run)
    db.commit()


def run_out(run: DilationRun) -> DilationRunOut:
    steps = []
    for s in run.steps:
        started = _aware(s.started_at)
        steps.append(DilationStepDetail(name=s.name, minutes=s.minutes, given=s.given, started_at=started,
                                        done=s.done,
                                        due_at=started + timedelta(minutes=s.minutes) if started else None))
    return DilationRunOut(visit_id=run.visit_id, current_index=run.current_index,
                          started_at=_aware(run.started_at), steps=steps, complete=is_complete(run))
