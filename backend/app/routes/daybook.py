"""Day book (the daily cash sheet), its columns and the cash drawer (lane M owns this module).

Day book (admin, doctor, reception — the same people who see Today):
  GET    /daybook/{date}                   the day's sheet: columns, rows, totals, money by mode, cash drawer
  GET    /daybook/{date}.xlsx              the same as an Excel file laid out like the paper sheet
  PUT    /daybook/{date}/opening           {openingCash, note?} the drawer's opening cash for that day
  POST   /daybook/{date}/movements         {direction: out|in, amount, person, reason} cash taken out / put in
  DELETE /daybook/{date}/movements/{id}    undo a cash entry made by mistake
  GET    /daybook/people                   names typed on earlier cash entries (suggestions)
Columns (account heads): GET /account-heads (any staff; ?includeInactive=true for the admin table);
writes admin-only under /admin/account-heads (create, patch, delete — 409 once used —, reorder by keys).
Settings: GET /daybook-settings (any staff), PUT /admin/daybook-settings (admin) — the column for
medicines, hand-typed bill lines and OT payments. Every write is audited.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.roles import ADMIN_ONLY
from app.db import get_db
from app.models.staff import Staff
from app.routes import register
from app.routes.reports import REPORT_ROLES
from app.schemas.daybook import (AccountHeadIn, AccountHeadOrder, AccountHeadOut, AccountHeadPatch, CashMovementIn,
                                 DayBookOut, DayBookSettings, DayBookSettingsPatch, OpeningIn)
from app.services import daybook as svc

router = register(APIRouter(tags=["daybook"], dependencies=[Depends(get_current_user)]))

admin_user = Depends(require_role(*ADMIN_ONLY))
book_user = Depends(require_role(*REPORT_ROLES))

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _http(exc: svc.BillingError) -> HTTPException:
    code = {svc.NotFound: status.HTTP_404_NOT_FOUND, svc.Conflict: status.HTTP_409_CONFLICT,
            svc.BadValue: status.HTTP_422_UNPROCESSABLE_ENTITY}.get(type(exc), status.HTTP_400_BAD_REQUEST)
    return HTTPException(code, str(exc))


# --------------------------------------------------------------------------- columns
@router.get("/account-heads", response_model=list[AccountHeadOut])
def list_heads(include_inactive: bool = Query(False, alias="includeInactive"), db: Session = Depends(get_db)):
    """The switched-on columns in order (pickers); with includeInactive the admin table's full list."""
    counts = svc.head_use_counts(db)
    return [svc.head_out(h, counts) for h in svc.heads(db, include_inactive=include_inactive)]


@router.post("/admin/account-heads", response_model=AccountHeadOut, status_code=status.HTTP_201_CREATED)
def create_head(data: AccountHeadIn, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.head_out(svc.create_head(db, label=data.label, key=data.key, by=user), {})
    except svc.BillingError as exc:
        raise _http(exc)


@router.put("/admin/account-heads/order", response_model=list[AccountHeadOut])
def reorder_heads(data: AccountHeadOrder, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        rows = svc.reorder_heads(db, data.keys, user)
    except svc.BillingError as exc:
        raise _http(exc)
    counts = svc.head_use_counts(db)
    return [svc.head_out(h, counts) for h in rows]


@router.patch("/admin/account-heads/{key}", response_model=AccountHeadOut)
def patch_head(key: str, data: AccountHeadPatch, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        head = svc.update_head(db, svc.get_head(db, key), data.model_dump(exclude_unset=True), user)
    except svc.BillingError as exc:
        raise _http(exc)
    return svc.head_out(head, svc.head_use_counts(db))


@router.delete("/admin/account-heads/{key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_head(key: str, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        svc.delete_head(db, svc.get_head(db, key), user)
    except svc.BillingError as exc:
        raise _http(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- settings
@router.get("/daybook-settings", response_model=DayBookSettings)
def get_settings(db: Session = Depends(get_db)):
    return svc.billing.daybook_settings(db)


@router.put("/admin/daybook-settings", response_model=DayBookSettings)
def save_settings(data: DayBookSettingsPatch, db: Session = Depends(get_db), user: Staff = admin_user):
    try:
        return svc.save_settings(db, data.model_dump(exclude_unset=True), user)
    except svc.BillingError as exc:
        raise _http(exc)


# --------------------------------------------------------------------------- the day book
# Fixed paths first: "/daybook/people" and "/daybook/{date}.xlsx" must not be read as a date.
@router.get("/daybook/people", response_model=list[str])
def cash_people(db: Session = Depends(get_db), user: Staff = book_user):
    return svc.people(db)


@router.get("/daybook/{day}.xlsx")
def day_book_xlsx(day: date, db: Session = Depends(get_db), user: Staff = book_user):
    return Response(svc.xlsx(db, day), media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="day-book-{day.isoformat()}.xlsx"'})


@router.get("/daybook/{day}", response_model=DayBookOut)
def day_book(day: date, db: Session = Depends(get_db), user: Staff = book_user):
    return svc.day_book(db, day)


@router.put("/daybook/{day}/opening", response_model=DayBookOut)
def set_opening(day: date, data: OpeningIn, db: Session = Depends(get_db), user: Staff = book_user):
    svc.set_opening(db, day, data.opening_cash, data.note, user)
    return svc.day_book(db, day)


@router.post("/daybook/{day}/movements", response_model=DayBookOut, status_code=status.HTTP_201_CREATED)
def add_movement(day: date, data: CashMovementIn, db: Session = Depends(get_db), user: Staff = book_user):
    svc.add_movement(db, day, data.direction, data.amount, data.person, data.reason, user)
    return svc.day_book(db, day)


@router.delete("/daybook/{day}/movements/{movement_id}", response_model=DayBookOut)
def remove_movement(day: date, movement_id: int, db: Session = Depends(get_db), user: Staff = book_user):
    try:
        svc.remove_movement(db, day, movement_id, user)
    except svc.BillingError as exc:
        raise _http(exc)
    return svc.day_book(db, day)
