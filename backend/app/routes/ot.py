from fastapi import APIRouter

from app.routes import register

router = register(APIRouter(prefix="/ot", tags=["ot"]))
