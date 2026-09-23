from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, DateTime, utcnow

PAYMENT_MODES = ("cash", "upi", "card", "mediclaim")
BILL_ITEM_KINDS = ("charge", "medicine", "other")


class StandardCharge(Base):
    """Admin-configurable fee (consultation, pre-test, dilation...) added to a bill with one tap."""

    __tablename__ = "standard_charges"

    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(120), unique=True)
    amount: Mapped[int] = mapped_column(Integer, default=0)  # whole rupees (one eye, for eye-wise tests)
    # Tests priced per eye: the both-eyes price (None = one price whatever the eyes).
    amount_both_eyes: Mapped[int | None] = mapped_column(Integer)
    # Heading the chip sits under on the bill ("Visit fees", "Tests", "Packages") — free text, admin-set.
    group_label: Mapped[str] = mapped_column(String(40), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Bill(Base):
    __tablename__ = "bills"

    id: Mapped[int] = mapped_column(primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"), unique=True)
    payment_mode: Mapped[str | None] = mapped_column(String(20))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    receipt_no: Mapped[str | None] = mapped_column(String(20), unique=True)  # given when paid
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    visit = relationship("Visit", back_populates="bill")
    items: Mapped[list["BillItem"]] = relationship(
        back_populates="bill", cascade="all, delete-orphan", order_by="BillItem.id")


class BillItem(Base):
    __tablename__ = "bill_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    bill_id: Mapped[int] = mapped_column(ForeignKey("bills.id"), index=True)
    label: Mapped[str] = mapped_column(String(120))
    amount: Mapped[int] = mapped_column(Integer)  # line total, whole rupees
    kind: Mapped[str] = mapped_column(String(20), default="other")  # BILL_ITEM_KINDS
    qty: Mapped[int] = mapped_column(Integer, default=1)
    eyes: Mapped[str | None] = mapped_column(String(10))  # "one" | "both" for eye-wise tests
    standard_charge_id: Mapped[int | None] = mapped_column(ForeignKey("standard_charges.id"))
    prescription_line_id: Mapped[int | None] = mapped_column(ForeignKey("prescription_lines.id"))

    bill: Mapped["Bill"] = relationship(back_populates="items")
