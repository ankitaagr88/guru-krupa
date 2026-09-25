"""Placeholder (session 4 groundwork) — the owning lane fills this module in."""
from fastapi import APIRouter, Depends

from app.auth.deps import get_current_user
from app.routes import register

router = register(APIRouter(tags=["rx_print"], dependencies=[Depends(get_current_user)]))
