from datetime import date, datetime

from sqlalchemy import Boolean, Date, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, DateTime, utcnow

CHANNELS = ("whatsapp", "call", "walkin")


class Appointment(Base):
    __tablename__ = "appointments"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(20))
    date: Mapped[date] = mapped_column(Date, index=True)
    channel: Mapped[str] = mapped_column(String(20), default="whatsapp")
    checked_in: Mapped[bool] = mapped_column(Boolean, default=False)
    patient_id: Mapped[int | None] = mapped_column(ForeignKey("patients.id"))
    visit_id: Mapped[int | None] = mapped_column(ForeignKey("visits.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    patient = relationship("Patient")
