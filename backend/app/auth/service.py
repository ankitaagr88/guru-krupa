from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.security import hash_password, verify_password
from app.models.staff import Staff


def get_by_username(db: Session, username: str) -> Staff | None:
    return db.scalar(select(Staff).where(Staff.username == username))


def ensure_user(db: Session, *, username: str, password: str, name: str, role: str) -> Staff:
    """Idempotent: return the existing user with this username, else create one."""
    user = get_by_username(db, username)
    if user:
        return user
    user = Staff(username=username, password_hash=hash_password(password), name=name, role=role)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate(db: Session, username: str, password: str) -> Staff | None:
    user = get_by_username(db, username)
    if not user or not user.active or not verify_password(password, user.password_hash):
        return None
    return user
