from datetime import date, datetime

from sqlalchemy import Date, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, DateTime, utcnow


class MrVisit(Base):
    __tablename__ = "mr_visits"

    id: Mapped[int] = mapped_column(primary_key=True)
    rep_name: Mapped[str] = mapped_column(String(120), index=True)
    company: Mapped[str] = mapped_column(String(120), default="")
    phone: Mapped[str | None] = mapped_column(String(20))
    products: Mapped[str] = mapped_column(Text, default="")
    visit_date: Mapped[date] = mapped_column(Date, index=True)
    next_visit_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
