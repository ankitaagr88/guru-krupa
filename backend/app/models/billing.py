from datetime import date, datetime

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, DateTime, utcnow

PAYMENT_MODES = ("cash", "upi", "card", "mediclaim")
BILL_ITEM_KINDS = ("charge", "medicine", "other")
CASH_DIRECTIONS = ("out", "in")


class AccountHead(Base):
    """Admin-configurable day-book column (OPD, MED, TEST, GLASSES, OT, OTHER): every bill line is
    counted under one. A standard charge carries its head; "Bought here" medicines go under the head
    named in ClinicSetting "daybook" (`medicineHead`); a hand-typed line under the one reception picks."""

    __tablename__ = "account_heads"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(30), unique=True)
    label: Mapped[str] = mapped_column(String(40))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


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
    account_head_key: Mapped[str | None] = mapped_column(String(30))  # AccountHead.key (day-book column)
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
    # Money received against this bill (part payments allowed); `paid_at` = when the balance reached 0.
    payments: Mapped[list["BillPayment"]] = relationship(
        back_populates="bill", cascade="all, delete-orphan", order_by="BillPayment.id")


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
    account_head_key: Mapped[str | None] = mapped_column(String(30))  # day-book column; None = worked out

    bill: Mapped["Bill"] = relationship(back_populates="items")


class BillPayment(Base):
    """One amount received against a bill, in one payment mode (a bill may be paid in parts)."""

    __tablename__ = "bill_payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    bill_id: Mapped[int] = mapped_column(ForeignKey("bills.id"), index=True)
    amount: Mapped[int] = mapped_column(Integer)  # whole rupees, > 0
    mode: Mapped[str] = mapped_column(String(20))  # PAYMENT_MODES
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    by_staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"))
    note: Mapped[str] = mapped_column(String(255), default="")

    bill: Mapped["Bill"] = relationship(back_populates="payments")


class CashDay(Base):
    """The cash drawer's opening balance for one clinic day (normally the previous day's closing cash)."""

    __tablename__ = "cash_days"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    opening_cash: Mapped[int] = mapped_column(Integer, default=0)
    set_by_staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"))
    set_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    note: Mapped[str] = mapped_column(String(255), default="")


class CashMovement(Base):
    """Cash taken out of (or put into) the drawer outside patient bills, e.g. the doctor taking ₹3000."""

    __tablename__ = "cash_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    direction: Mapped[str] = mapped_column(String(3), default="out")  # CASH_DIRECTIONS
    amount: Mapped[int] = mapped_column(Integer)  # whole rupees, > 0
    person: Mapped[str] = mapped_column(String(80), default="")  # who took / gave it
    reason: Mapped[str] = mapped_column(String(255), default="")
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    by_staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"))
