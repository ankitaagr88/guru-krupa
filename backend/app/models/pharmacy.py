from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, DateTime, utcnow

INVENTORY_UNITS = ("bottles", "tubes", "strips")
STOCK_REASONS = ("dispensed", "adjusted", "received")
PRINT_LANGUAGES = ("gujarati", "hindi", "english")


def guess_medicine_form(text: str) -> str:
    """Best-effort form key from a name/composition ("... eye ointment" -> ointment); default drops."""
    t = (text or "").lower()
    for form in ("ointment", "tablet", "capsule", "suspension", "syrup", "gummies", "gel"):
        if form in t:
            return form
    return "drops"


class MedicineForm(Base):
    """Admin-configurable medicine type (drops, gel, syrup, gummies...). `Medicine.form` stores the key."""

    __tablename__ = "medicine_forms"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(40), unique=True)
    label: Mapped[str] = mapped_column(String(60))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Medicine(Base):
    """Master list entry. Indian chemists dispense by *brand*, so a row is either a branded pack
    (brand + composition, e.g. "Aquaray Gel" / Carboxymethylcellulose) or a plain generic
    (brand NULL, composition only). `name` is the display name: the brand when present, else the
    composition; it stays unique and is what prescription lines store.
    """

    __tablename__ = "medicines"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    brand: Mapped[str | None] = mapped_column(String(120))
    composition: Mapped[str] = mapped_column(Text, default="")  # generic / salt composition
    form: Mapped[str] = mapped_column(String(40), default="drops")  # MedicineForm.key (validated in services)
    strength: Mapped[str | None] = mapped_column(String(40))  # "0.5%", "250mg"
    pack_size: Mapped[str | None] = mapped_column(String(30))  # "5 ml", "10 ml", "3 g"
    manufacturer: Mapped[str | None] = mapped_column(String(120))
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    @property
    def display_name(self) -> str:
        """`Aquaray Gel (Carboxymethylcellulose eye drops IP)`; generic-only rows print just the name."""
        if self.brand and self.composition and self.composition.strip().lower() != self.brand.strip().lower():
            return f"{self.brand} ({self.composition})"
        return self.name


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
    # The diagnosis this prescription was written for (drives the treatment standards).
    diagnosis_id: Mapped[int | None] = mapped_column(ForeignKey("diagnoses.id"), index=True)

    visit = relationship("Visit", back_populates="prescriptions")
    diagnosis = relationship("Diagnosis")
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


class Diagnosis(Base):
    """Admin-configurable diagnosis / symptom the doctor picks when writing a prescription."""

    __tablename__ = "diagnoses"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class TreatmentStandard(Base):
    """The doctor's own standard prescription for a diagnosis (wins over the history-derived one)."""

    __tablename__ = "treatment_standards"

    id: Mapped[int] = mapped_column(primary_key=True)
    diagnosis_id: Mapped[int] = mapped_column(ForeignKey("diagnoses.id"), unique=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"))

    diagnosis = relationship("Diagnosis")
    updated_by = relationship("Staff")
    lines: Mapped[list["TreatmentStandardLine"]] = relationship(
        back_populates="standard", cascade="all, delete-orphan",
        order_by="TreatmentStandardLine.sort_order, TreatmentStandardLine.id")


class TreatmentStandardLine(Base):
    __tablename__ = "treatment_standard_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    standard_id: Mapped[int] = mapped_column(ForeignKey("treatment_standards.id"), index=True)
    medicine_id: Mapped[int | None] = mapped_column(ForeignKey("medicines.id"))
    name: Mapped[str] = mapped_column(String(160))
    dosage: Mapped[str] = mapped_column(Text, default="")
    qty_given: Mapped[int] = mapped_column(Integer, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    standard: Mapped["TreatmentStandard"] = relationship(back_populates="lines")
    medicine = relationship("Medicine")
