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
    # Id in the previous system (KiviHealth "Local Id", e.g. GK1234); lets a re-import update, not duplicate.
    external_id: Mapped[str | None] = mapped_column(String(40), unique=True, index=True)
    # Date of birth when known; `age` is then worked out from it. Without a DOB we keep the age as it
    # was told (`age_recorded`, on `age_recorded_on`) and let it grow with the calendar.
    dob: Mapped[date | None] = mapped_column(Date)
    age_recorded: Mapped[int | None] = mapped_column("age", Integer)
    age_recorded_on: Mapped[date | None] = mapped_column(Date)
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

    @property
    def age(self) -> int | None:
        """Age today: from the DOB when known, else the told age plus the years since it was told."""
        today = date.today()
        if self.dob is not None:
            return today.year - self.dob.year - ((today.month, today.day) < (self.dob.month, self.dob.day))
        if self.age_recorded is None:
            return None
        since = self.age_recorded_on
        if since is None:
            return self.age_recorded
        return self.age_recorded + today.year - since.year - ((today.month, today.day) < (since.month, since.day))

    @age.setter
    def age(self, value: int | None) -> None:
        self.age_recorded = value
        self.age_recorded_on = date.today() if value is not None else None


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
    # Picked on the doctor's panel; the prescription's diagnosis follows it.
    diagnosis_id: Mapped[int | None] = mapped_column(ForeignKey("diagnoses.id"), index=True)
    # "Come back on…" — the matching appointment carries source_visit_id = this visit.
    follow_up_date: Mapped[date | None] = mapped_column(Date, nullable=True)  # `date` is shadowed above
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    patient: Mapped["Patient"] = relationship(back_populates="visits")
    diagnosis = relationship("Diagnosis")
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
