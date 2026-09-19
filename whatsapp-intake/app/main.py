"""FastAPI app: WhatsApp webhooks per clinic, health, QR code endpoints, pending-record retry."""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, Response
from sqlalchemy import func, select

from app.config import ClinicConfig, load_all_clinics
from app.conversation import Conversation
from app.db import PendingRecord, make_session_factory
from app.destinations import Destination, build_destination, retry_pending
from app.providers import Provider, build_provider
from app.qr import qr_page_html, qr_png

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("intake")

RETRY_INTERVAL_SECONDS = int(os.environ.get("RETRY_INTERVAL_SECONDS", "300"))


@dataclass
class ClinicRuntime:
    config: ClinicConfig
    provider: Provider
    destination: Destination
    conversation: Conversation


def build_runtimes(session_factory) -> dict[str, ClinicRuntime]:
    runtimes = {}
    for cid, cfg in load_all_clinics().items():
        destination = build_destination(cfg)
        runtimes[cid] = ClinicRuntime(
            config=cfg,
            provider=build_provider(cfg),
            destination=destination,
            conversation=Conversation(cfg, destination, session_factory),
        )
        log.info("clinic '%s' loaded: provider=%s destination=%s questions=%d",
                 cid, cfg.provider.kind, cfg.destination.kind, len(cfg.questions))
    return runtimes


async def _retry_loop(app: FastAPI):
    while True:
        await asyncio.sleep(RETRY_INTERVAL_SECONDS)
        for cid, rt in app.state.clinics.items():
            try:
                with app.state.session_factory() as db:
                    n = await asyncio.to_thread(retry_pending, db, cid, rt.destination)
                if n:
                    log.info("retried pending records for %s: %d delivered", cid, n)
            except Exception:  # noqa: BLE001
                log.exception("pending retry failed for %s", cid)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.session_factory = make_session_factory()
    app.state.clinics = build_runtimes(app.state.session_factory)
    task = asyncio.create_task(_retry_loop(app))
    yield
    task.cancel()


app = FastAPI(title="WhatsApp patient intake", lifespan=lifespan)


def _runtime(clinic: str) -> ClinicRuntime:
    rt = app.state.clinics.get(clinic)
    if rt is None:
        raise HTTPException(404, f"unknown clinic '{clinic}'")
    return rt


@app.get("/health")
def health():
    with app.state.session_factory() as db:
        pending = db.scalar(select(func.count()).select_from(PendingRecord)) or 0
    return {"status": "ok", "clinics": list(app.state.clinics), "pending_records": pending}


# ---------------------------------------------------------------- webhooks
@app.get("/webhook/{clinic}")
def webhook_verify(clinic: str, request: Request):
    rt = _runtime(clinic)
    challenge = rt.provider.verify_webhook(dict(request.query_params))
    if challenge is None:
        raise HTTPException(403, "verification failed")
    return PlainTextResponse(challenge)


@app.post("/webhook/{clinic}")
async def webhook_receive(clinic: str, request: Request):
    rt = _runtime(clinic)
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        return {"status": "ignored"}
    incoming = rt.provider.parse_incoming(payload)
    if incoming is None:
        return {"status": "ignored"}      # delivery/read statuses etc.
    try:
        replies = await asyncio.to_thread(rt.conversation.handle, incoming)
        for reply in replies:
            await asyncio.to_thread(rt.provider.send, incoming.from_phone, reply)
    except Exception:  # noqa: BLE001 - always answer 200 so Meta does not retry-storm
        log.exception("failed handling message from %s", incoming.from_phone)
    return {"status": "ok"}


# ---------------------------------------------------------------- QR
@app.get("/qr/{clinic}.png")
def qr_image(clinic: str):
    rt = _runtime(clinic)
    return Response(qr_png(rt.config), media_type="image/png")


@app.get("/qr/{clinic}", response_class=HTMLResponse)
def qr_page(clinic: str):
    rt = _runtime(clinic)
    return HTMLResponse(qr_page_html(rt.config))


# ---------------------------------------------------------------- ops
@app.post("/retry-pending/{clinic}")
def retry_now(clinic: str):
    rt = _runtime(clinic)
    with app.state.session_factory() as db:
        delivered = retry_pending(db, clinic, rt.destination)
        remaining = db.scalar(select(func.count()).select_from(PendingRecord).where(PendingRecord.clinic_id == clinic)) or 0
    return {"delivered": delivered, "remaining": remaining}
