from datetime import date, datetime

from pydantic import Field

from app.schemas.common import CamelModel


class MrVisitIn(CamelModel):
    """`addMrVisit` form."""

    rep_name: str = Field(min_length=1, max_length=120)
    company: str = Field(min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=20)
    products: str = ""
    visit_date: date | None = None  # defaults to today
    next_visit_date: date | None = None
    notes: str = ""


class MrVisitPatch(CamelModel):
    rep_name: str | None = Field(default=None, min_length=1, max_length=120)
    company: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=20)
    products: str | None = None
    visit_date: date | None = None
    next_visit_date: date | None = None
    notes: str | None = None


class MrVisitOut(CamelModel):
    id: int
    rep_name: str
    company: str
    phone: str | None
    products: str
    visit_date: date
    next_visit_date: date | None
    notes: str
    created_at: datetime


class MrRepOut(CamelModel):
    """`openMrDetail`: one row per (rep, company)."""

    rep_name: str
    company: str
    phone: str | None
    visits: int
    last_visit_date: date
    next_visit_date: date | None
    products: list[str]  # distinct products across all visits
