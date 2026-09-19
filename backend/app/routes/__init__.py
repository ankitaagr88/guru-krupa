"""Every route module exposes a `router`; register it here. One file per module."""
from fastapi import APIRouter

all_routers: list[APIRouter] = []


def register(router: APIRouter) -> APIRouter:
    all_routers.append(router)
    return router


# Route modules import `register` and call it at import time; import them here so
# app.main picks them up. Keep this list alphabetical.
from app.routes import auth as _auth  # noqa: E402,F401
from app.routes import patients as _patients  # noqa: E402,F401
from app.routes import visits as _visits  # noqa: E402,F401
