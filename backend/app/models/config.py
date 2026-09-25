from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Stage(Base):
    __tablename__ = "stages"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(30), unique=True)
    label: Mapped[str] = mapped_column(String(80))
    cls: Mapped[str] = mapped_column(String(30))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class ProtocolStep(Base):
    __tablename__ = "protocol_steps"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    minutes: Mapped[int] = mapped_column(Integer)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class ReferralSource(Base):
    __tablename__ = "referral_sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(30), unique=True)
    label: Mapped[str] = mapped_column(String(120))
    needs_detail: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class LensTier(Base):
    __tablename__ = "lens_tiers"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(30), unique=True)
    label: Mapped[str] = mapped_column(String(120))
    price: Mapped[int] = mapped_column(Integer)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Relation(Base):
    """Admin-configurable relation of a family member to the owner of the shared mobile number."""

    __tablename__ = "relations"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(30), unique=True)
    label: Mapped[str] = mapped_column(String(60))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class VisitKind(Base):
    """Admin-configurable kind of visit (new patient, follow-up, new case, after surgery...) and the
    standard charge it puts on the bill (none = free)."""

    __tablename__ = "visit_kinds"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(30), unique=True)
    label: Mapped[str] = mapped_column(String(80))
    standard_charge_id: Mapped[int | None] = mapped_column(ForeignKey("standard_charges.id"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class ExamFinding(Base):
    """Admin-configurable examination row on the doctor's panel and the printed prescription
    (Fundus, Anterior segment, IOP...), each with a right-eye and a left-eye value."""

    __tablename__ = "exam_findings"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(30), unique=True)
    label: Mapped[str] = mapped_column(String(80))
    default_value: Mapped[str] = mapped_column(String(80), default="")  # one-tap fill, e.g. "Normal"
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class LensType(Base):
    """Admin-configurable spectacle lens type printed with the glasses prescription (ARC, Blue cut...)."""

    __tablename__ = "lens_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(30), unique=True)
    label: Mapped[str] = mapped_column(String(80))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class ClinicSetting(Base):
    """Admin-editable clinic rules as key -> JSON value (fee day-limits, emergency hours...)."""

    __tablename__ = "clinic_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict)
