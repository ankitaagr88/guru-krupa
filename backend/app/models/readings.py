from datetime import datetime

from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, DateTime, utcnow

READING_SOURCES = ("scanned", "manual", "corrected")
READING_STATUSES = ("pending", "processing", "done", "failed")
# One key per machine in TEST_TYPES; the display label lives with the OCR template.
MACHINE_KEYS = ("hnt1p_tono", "hrk8000a_ref", "hrk8000a_ker", "clm1_lensmeter",
                "ypc100k_ref", "ypc100k_ker", "hbm1_biometry", "tbut_schirmer")


class Reading(Base):
    __tablename__ = "readings"

    id: Mapped[int] = mapped_column(primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"), index=True)
    machine_key: Mapped[str] = mapped_column(String(40))
    source: Mapped[str] = mapped_column(String(10), default="scanned")
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    image_path: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    values: Mapped[list] = mapped_column(default=list)  # [{"l": "SPH (R)", "v": "-1.00"}, ...]
    confidence: Mapped[float | None] = mapped_column(Float)
    client_uuid: Mapped[str | None] = mapped_column(String(36), unique=True)  # idempotent offline retry (B6)
    error: Mapped[str | None] = mapped_column(String(255))
    # Printout photos are not kept long-term: once a person approves the extracted values the image
    # file is deleted and image_path cleared (see services.readings.approve_reading / purge_stale_images).
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"))

    visit = relationship("Visit", back_populates="readings")
    approved_by = relationship("Staff", foreign_keys=[approved_by_id])
