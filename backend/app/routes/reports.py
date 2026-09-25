"""The "Today" summary and other read-only reports (lane B owns this module).

GET /reports/today?date=YYYY-MM-DD (default: today, clinic time) → patients seen, average
minutes per stage (from the `stage_move` audit rows), money received that day by payment mode
(counted by the day each payment came in), the bills still owing, medicines sold and the day's
payments (receipts)."""
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.db import get_db
from app.models.staff import Staff
from app.routes import register
from app.schemas.reports import TodayReport
from app.services import reports as svc

router = register(APIRouter(prefix="/reports", tags=["reports"], dependencies=[Depends(get_current_user)]))

# The same roles that see "Today" in the menu (money is on it).
REPORT_ROLES = ("admin", "doctor", "reception")


@router.get("/today", response_model=TodayReport)
def today(on: date | None = Query(None, alias="date"), db: Session = Depends(get_db),
          user: Staff = Depends(require_role(*REPORT_ROLES))):
    return svc.today_report(db, on)
