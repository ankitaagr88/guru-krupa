"""The "Today" summary and other read-only reports (lane B owns this module).

Planned: GET /reports/today?date= → patients seen, average minutes per stage (from the
`stage_move` audit rows), collections by payment mode, medicines sold."""
from fastapi import APIRouter, Depends

from app.auth.deps import get_current_user
from app.routes import register

router = register(APIRouter(prefix="/reports", tags=["reports"], dependencies=[Depends(get_current_user)]))
