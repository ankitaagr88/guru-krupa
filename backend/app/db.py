from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

# JSON columns: JSONB on Postgres, plain JSON on SQLite (tests).
PortableJSON = JSON().with_variant(JSONB(), "postgresql")

_connect_args = {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(settings.DATABASE_URL, connect_args=_connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    type_annotation_map = {dict: PortableJSON, list: PortableJSON}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


__all__ = ["Base", "DateTime", "PortableJSON", "SessionLocal", "engine", "get_db", "utcnow"]
