"""Visit kinds, clinic fee rules (day limits, emergency hours) and the fee suggested for a visit
(lane E2 owns this module)."""
from fastapi import APIRouter, Depends

from app.auth.deps import get_current_user
from app.routes import register

router = register(APIRouter(tags=["visit-fees"], dependencies=[Depends(get_current_user)]))
