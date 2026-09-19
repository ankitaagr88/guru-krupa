"""Password hashing (bcrypt via passlib) and JWT encode/decode (python-jose)."""
from datetime import timedelta

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings
from app.db import utcnow

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return pwd_context.verify(password, password_hash)
    except ValueError:  # malformed hash
        return False


def create_access_token(sub: str, role: str, expires_min: int | None = None) -> str:
    exp = utcnow() + timedelta(minutes=settings.JWT_EXPIRE_MIN if expires_min is None else expires_min)
    return jwt.encode({"sub": sub, "role": role, "exp": exp}, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict | None:
    """Return the claims, or None if the token is invalid/expired."""
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None
