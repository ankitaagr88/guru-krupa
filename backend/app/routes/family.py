"""Families on one mobile number: owner + members with their relation, and the admin relations list
(lane E1 owns this module)."""
from fastapi import APIRouter, Depends

from app.auth.deps import get_current_user
from app.routes import register

router = register(APIRouter(tags=["family"], dependencies=[Depends(get_current_user)]))
