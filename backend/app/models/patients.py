from datetime import date, datetime

from sqlalchemy import Boolean, Date, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, DateTime, utcnow

SEXES = ("M", "F", "O")
LANGUAGES = ("gujarati", "hindi", "english")
VISIT_STATUSES = ("active", "completed", "cancelled")


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    age: Mapped[int | None] = mapped_column(Integer)
    sex: Mapped[str | None] = mapped_column(String(1))
    phone: Mapped[str | None] = mapped_column(String(20), index=True)
    address: Mapped[str | None] = mapped_column(String(255))
    occupation: Mapped[str | None] = mapped_column(String(120))
    screen_hours: Mapped[int | None] = mapped_column(Integer)
    language: Mapped[str | None] = mapped_column(String(20))
    elsewhere: Mapped[bool] = mapped_column(Boolean, default=False)
    elsewhere_note: Mapped[str] = mapped_column(Text, default="")
    note: Mapped[str] = mapped_column(Text, default="")
    referral_source_id: Mapped[int | None] = mapped_column(ForeignKey("referral_sources.id"))
    referral_detail: Mapped[str] = mapped_column(String(255), default="")
    existing_conditions: Mapped[list] = mapped_column(default=list)
    condition_other: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    referral_source = relationship("ReferralSource")
    visits: Mapped[list["Visit"]] = relationship(back_populates="patient", order_by="Visit.date")


class Visit(Base):
    __tablename__ = "visits"
    __table_args__ = (Index("ix_visits_date_token", "date", "token", unique=True),)

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    token: Mapped[str] = mapped_column(String(10))  # "#014"; numbering restarts each day
    stage_key: Mapped[str] = mapped_column(String(30), default="reg", index=True)
    stage_entered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    va_r: Mapped[str] = mapped_column(String(20), default="")
    va_l: Mapped[str] = mapped_column(String(20), default="")
    status: Mapped[str] = mapped_column(String(20), default="active")
    # Per-visit snapshots of what reception/doctor typed that day.
    elsewhere: Mapped[bool] = mapped_column(Boolean, default=False)
    elsewhere_note: Mapped[str] = mapped_column(Text, default="")
    note: Mapped[str] = mapped_column(Text, default="")
    doctor_notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    patient: Mapped["Patient"] = relationship(back_populates="visits")
    readings = relationship("Reading", back_populates="visit", cascade="all, delete-orphan")
    exam_photos: Mapped[list["ExamPhoto"]] = relationship(back_populates="visit", cascade="all, delete-orphan")
    dilation_run = relationship("DilationRun", back_populates="visit", uselist=False, cascade="all, delete-orphan")
    bill = relationship("Bill", back_populates="visit", uselist=False, cascade="all, delete-orphan")
    prescriptions = relationship("Prescription", back_populates="visit", cascade="all, delete-orphan")


class ExamPhoto(Base):
    __tablename__ = "exam_photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"), index=True)
    image_path: Mapped[str] = mapped_column(String(255))
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    visit: Mapped["Visit"] = relationship(back_populates="exam_photos")
