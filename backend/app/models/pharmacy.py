from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, DateTime, utcnow

INVENTORY_UNITS = ("bottles", "tubes", "strips")
STOCK_REASONS = ("dispensed", "adjusted", "received")
PRINT_LANGUAGES = ("gujarati", "hindi", "english")


class Medicine(Base):
    __tablename__ = "medicines"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    # medicine_id is null for stocked-but-not-prescribed items (dilation drops).
    medicine_id: Mapped[int | None] = mapped_column(ForeignKey("medicines.id"))
    name: Mapped[str] = mapped_column(String(160), unique=True)
    unit: Mapped[str] = mapped_column(String(20), default="bottles")
    stock: Mapped[int] = mapped_column(Integer, default=0)
    reorder_level: Mapped[int] = mapped_column(Integer, default=0)

    medicine = relationship("Medicine")
    movements: Mapped[list["StockMovement"]] = relationship(back_populates="item", order_by="StockMovement.at")


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("inventory_items.id"), index=True)
    delta: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(20))
    ref_prescription_id: Mapped[int | None] = mapped_column(ForeignKey("prescriptions.id"))
    by_staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"))
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    item: Mapped["InventoryItem"] = relationship(back_populates="movements")


class Prescription(Base):
    __tablename__ = "prescriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"), index=True)
    print_language: Mapped[str] = mapped_column(String(20), default="english")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    visit = relationship("Visit", back_populates="prescriptions")
    lines: Mapped[list["PrescriptionLine"]] = relationship(
        back_populates="prescription", cascade="all, delete-orphan", order_by="PrescriptionLine.id")


class PrescriptionLine(Base):
    __tablename__ = "prescription_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    prescription_id: Mapped[int] = mapped_column(ForeignKey("prescriptions.id"), index=True)
    medicine_id: Mapped[int | None] = mapped_column(ForeignKey("medicines.id"))
    name: Mapped[str] = mapped_column(String(160))  # free text; matched=True when it hit the master list
    matched: Mapped[bool] = mapped_column(Boolean, default=False)
    dosage: Mapped[str] = mapped_column(Text, default="")
    qty_given: Mapped[int] = mapped_column(Integer, default=0)

    prescription: Mapped["Prescription"] = relationship(back_populates="lines")
    medicine = relationship("Medicine")
