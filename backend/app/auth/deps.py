from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.auth.security import decode_token
from app.db import get_db
from app.models.staff import Staff

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> Staff:
    unauthorized = HTTPException(
        status.HTTP_401_UNAUTHORIZED, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"}
    )
    claims = decode_token(token)
    if not claims or not str(claims.get("sub", "")).isdigit():
        raise unauthorized
    user = db.get(Staff, int(claims["sub"]))
    if not user or not user.active:
        raise unauthorized
    return user


def require_role(*roles: str):
    """Dependency factory: `Depends(require_role("admin", "reception"))` -> 403 for other roles."""

    def _check(user: Staff = Depends(get_current_user)) -> Staff:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient role")
        return user

    return _check
