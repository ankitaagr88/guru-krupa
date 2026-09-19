"""SQLite (default) persistence via SQLAlchemy: sessions, completed records, pending retries."""
from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path

from sqlalchemy import JSON, DateTime, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from app.config import ROOT_DIR


class Base(DeclarativeBase):
    pass


class ChatSession(Base):
    """One row per (clinic, patient phone). Survives restarts so half-filled forms resume."""
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    clinic_id: Mapped[str] = mapped_column(String(64), index=True)
    phone: Mapped[str] = mapped_column(String(32), index=True)
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    step: Mapped[int] = mapped_column(Integer, default=-1)   # -1 = language prompt, n = questions[n]
    answers: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | completed
    started_at: Mapped[datetime] = mapped_column(DateTime)
    updated_at: Mapped[datetime] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class IntakeRecord(Base):
    """Audit copy of every completed form (also what the pending queue points at)."""
    __tablename__ = "intake_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    clinic_id: Mapped[str] = mapped_column(String(64), index=True)
    phone: Mapped[str] = mapped_column(String(32))
    language: Mapped[str] = mapped_column(String(16))
    answers: Mapped[dict] = mapped_column(JSON)
    submitted_at: Mapped[str] = mapped_column(String(40))   # ISO local time, e.g. 2026-09-19T10:31:00+05:30
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PendingRecord(Base):
    """A completed form the destination refused; retried later (see destinations/__init__)."""
    __tablename__ = "pending_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    record_id: Mapped[int] = mapped_column(Integer, index=True)
    clinic_id: Mapped[str] = mapped_column(String(64), index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime)
    next_try_at: Mapped[datetime] = mapped_column(DateTime)


def make_engine(url: str | None = None):
    url = url or os.environ.get("DATABASE_URL") or f"sqlite:///{ROOT_DIR / 'data' / 'intake.db'}"
    if url.startswith("sqlite:///") and not url.endswith(":memory:"):
        Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    kwargs = {"connect_args": {"check_same_thread": False}} if url.startswith("sqlite") else {}
    engine = create_engine(url, **kwargs)
    Base.metadata.create_all(engine)
    return engine


def make_session_factory(url: str | None = None):
    return sessionmaker(bind=make_engine(url), expire_on_commit=False)
