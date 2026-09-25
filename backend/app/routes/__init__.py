"""Every route module exposes a `router`; register it here. One file per module."""
from fastapi import APIRouter

all_routers: list[APIRouter] = []


def register(router: APIRouter) -> APIRouter:
    all_routers.append(router)
    return router


# Route modules import `register` and call it at import time; import them here so
# app.main picks them up. Keep this list alphabetical.
from app.routes import admin as _admin  # noqa: E402,F401
from app.routes import appointments as _appointments  # noqa: E402,F401
from app.routes import auth as _auth  # noqa: E402,F401
from app.routes import billing as _billing  # noqa: E402,F401
from app.routes import daybook as _daybook  # noqa: E402,F401
from app.routes import dilation as _dilation  # noqa: E402,F401
from app.routes import family as _family  # noqa: E402,F401
from app.routes import imports as _imports  # noqa: E402,F401
from app.routes import intake as _intake  # noqa: E402,F401
from app.routes import inventory as _inventory  # noqa: E402,F401
from app.routes import mr as _mr  # noqa: E402,F401
from app.routes import ot as _ot  # noqa: E402,F401
from app.routes import patients as _patients  # noqa: E402,F401
from app.routes import prescriptions as _prescriptions  # noqa: E402,F401
from app.routes import readings as _readings  # noqa: E402,F401
from app.routes import reports as _reports  # noqa: E402,F401
from app.routes import rx_print as _rx_print  # noqa: E402,F401
from app.routes import treatments as _treatments  # noqa: E402,F401
from app.routes import visit_fees as _visit_fees  # noqa: E402,F401
from app.routes import visits as _visits  # noqa: E402,F401
