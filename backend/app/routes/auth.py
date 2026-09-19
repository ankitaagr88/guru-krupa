from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.auth import service
from app.auth.deps import get_current_user
from app.auth.security import create_access_token
from app.db import get_db
from app.models.staff import Staff
from app.routes import register
from app.schemas.auth import LoginRequest, StaffOut, TokenResponse

router = register(APIRouter(prefix="/auth", tags=["auth"]))


async def _credentials(request: Request) -> LoginRequest:
    """Accept JSON `{username,password}` or form-encoded (Swagger Authorize button)."""
    ctype = request.headers.get("content-type", "")
    data = await (request.json() if "json" in ctype else request.form())
    try:
        return LoginRequest(username=data["username"], password=data["password"])
    except (KeyError, TypeError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "username and password required")


@router.post("/login", response_model=TokenResponse)
def login(creds: LoginRequest = Depends(_credentials), db: Session = Depends(get_db)):
    user = service.authenticate(db, creds.username, creds.password)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect username or password")
    return TokenResponse(access_token=create_access_token(str(user.id), user.role), user=user)


@router.get("/me", response_model=StaffOut)
def me(user: Staff = Depends(get_current_user)):
    return user
