"""New-patient form (`/register`). Both endpoints are PUBLIC (no sign-in): the page is reached by
scanning a QR code at the front desk.

`GET /intake/lists` - the admin-configured referral sources and conditions, nothing else.
`POST /intake`      - create the patient + today's visit; returns the token only.
    Safety: per-address rate limit (INTAKE_RATE_LIMIT per INTAKE_RATE_WINDOW_SECONDS), a hidden
    honeypot field (`website`), length limits on every field, never any other patient's data.
    With a valid staff sign-in the same call skips the rate limit and the "self-filled" note.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.auth.security import decode_token
from app.config import settings
from app.db import get_db
from app.models.staff import Staff
from app.routes import register
from app.schemas.intake import IntakeIn, IntakeListsOut, IntakeOut
from app.services import intake as svc

router = register(APIRouter(prefix="/intake", tags=["intake"]))

_optional_token = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def optional_staff(token: str | None = Depends(_optional_token), db: Session = Depends(get_db)) -> Staff | None:
    """The signed-in staff member, or None. A missing or stale token just means "public"."""
    claims = decode_token(token) if token else None
    if not claims or not str(claims.get("sub", "")).isdigit():
        return None
    user = db.get(Staff, int(claims["sub"]))
    return user if user and user.active else None


@router.get("/lists", response_model=IntakeListsOut)
def intake_lists(db: Session = Depends(get_db)):
    return svc.lists(db)


@router.post("", response_model=IntakeOut, status_code=status.HTTP_201_CREATED)
def submit_intake(data: IntakeIn, request: Request, db: Session = Depends(get_db),
                  staff: Staff | None = Depends(optional_staff)):
    if staff is None:
        ip = request.client.host if request.client else "unknown"
        if not svc.limiter.allow(ip, settings.INTAKE_RATE_LIMIT, settings.INTAKE_RATE_WINDOW_SECONDS):
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                                "Too many forms from this phone. Please ask at the reception desk.")
        if data.website:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Could not submit the form")
    try:
        patient, visit = svc.submit(db, data, by_staff=staff is not None)
    except svc.IntakeError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    if staff is None:
        return IntakeOut(token=visit.token)
    return IntakeOut(token=visit.token, patient_id=patient.id, visit_id=visit.id)
