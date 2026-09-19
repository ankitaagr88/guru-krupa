from datetime import datetime

from app.schemas.common import CamelModel
from app.schemas.visits import DilationOut, DilationStepOut


class DilationStepDetail(DilationStepOut):
    due_at: datetime | None  # startedAt + min minutes; the client counts down to this


class DilationRunOut(DilationOut):
    """`renderDilationChecklist` payload: the run plus `complete` and per-step `dueAt`."""

    visit_id: int
    steps: list[DilationStepDetail]
    complete: bool  # currentIndex >= len(steps): "All drops given - ready for the doctor"


__all__ = ["CamelModel", "DilationRunOut", "DilationStepDetail"]
