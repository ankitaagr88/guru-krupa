from datetime import date, datetime

from sqlalchemy import Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, DateTime, utcnow

OT_STATUSES = ("scheduled", "in_progress", "completed", "cancelled")


# JSON blobs keep the mockup's nested camelCase shapes verbatim so the frontend
# round-trips them without a mapping layer.
def empty_biometry() -> dict:
    return {k: {"R": "", "L": ""} for k in ("AL", "ACD", "K1", "K2", "targetRefraction")}


def empty_operative() -> dict:
    return {"iolBrand": "", "iolPower": "", "technique": "", "anesthesia": "",
            "surgeon": "Dr. Anu Juneja Pathak", "complications": "", "notes": ""}


def empty_post_op() -> dict:
    rx = {"sph": "", "cyl": "", "axis": "", "va": ""}
    return {"followUpNotes": "", "followUpVA": {"R": "", "L": ""}, "nextFollowUp": "",
            "finalRx": {"R": dict(rx), "L": dict(rx)}}


def empty_billing() -> dict:
    return {"lensTier": None, "mediclaim": False, "paymentMode": None}


class OtCase(Base):
    __tablename__ = "ot_cases"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int | None] = mapped_column(ForeignKey("patients.id"))
    patient_name: Mapped[str] = mapped_column(String(120))
    age: Mapped[int | None] = mapped_column(Integer)
    sex: Mapped[str | None] = mapped_column(String(1))
    date: Mapped[date] = mapped_column(Date, index=True)
    time_slot: Mapped[str] = mapped_column(String(20), default="")  # free text like "9:00 AM"
    procedure: Mapped[str] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(20), default="scheduled")
    pre_op_biometry: Mapped[dict] = mapped_column(default=empty_biometry)
    operative: Mapped[dict] = mapped_column(default=empty_operative)
    post_op: Mapped[dict] = mapped_column(default=empty_post_op)
    billing: Mapped[dict] = mapped_column(default=empty_billing)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    patient = relationship("Patient")
    consent_photos: Mapped[list["OtConsentPhoto"]] = relationship(
        back_populates="case", cascade="all, delete-orphan", order_by="OtConsentPhoto.captured_at")


class OtConsentPhoto(Base):
    __tablename__ = "ot_consent_photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    ot_case_id: Mapped[int] = mapped_column(ForeignKey("ot_cases.id"), index=True)
    image_path: Mapped[str] = mapped_column(String(255))
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    case: Mapped["OtCase"] = relationship(back_populates="consent_photos")
