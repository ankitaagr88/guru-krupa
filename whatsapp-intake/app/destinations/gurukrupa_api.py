"""Destination: the Gurukrupa clinic system (``POST /api/patients`` with a Bearer token)."""
from __future__ import annotations

import logging

import httpx

from app.config import DestinationConfig
from app.destinations.base import DestinationError, Record

log = logging.getLogger(__name__)


def map_record(record: Record, cfg: DestinationConfig) -> dict:
    """Intake answers -> Gurukrupa ``PatientIn`` JSON (camelCase)."""
    a = record["answers"]
    source = a.get("source")
    mapped = cfg.referral_source_map.get(source or "", {})
    referral_key = mapped.get("key") or (source if source else None)
    body = {
        "name": a.get("name", ""),
        "age": a.get("age"),
        "sex": a.get("gender") if a.get("gender") in ("M", "F", "O") else None,
        "phone": a.get("contact") or record.get("phone"),
        "address": a.get("address"),
        "language": record.get("language"),
        "referralSource": referral_key,
        "referralDetail": mapped.get("detail", ""),
        "note": cfg.note,
    }
    return body


class GurukrupaApiDestination:
    name = "gurukrupa_api"

    def __init__(self, cfg: DestinationConfig, client: httpx.Client | None = None):
        self.cfg = cfg
        self.client = client or httpx.Client(timeout=15)
        self._token: str | None = None

    # -- auth -------------------------------------------------------------------------------
    def _login(self) -> str:
        r = self.client.post(
            f"{self.cfg.api_url.rstrip('/')}/auth/login",
            json={"username": self.cfg.username, "password": self.cfg.password},
        )
        if r.status_code != 200:
            raise DestinationError(f"login failed: {r.status_code} {r.text[:200]}")
        self._token = r.json()["access_token"]
        return self._token

    def _headers(self) -> dict:
        token = self._token or self._login()
        return {"Authorization": f"Bearer {token}"}

    # -- save -------------------------------------------------------------------------------
    def save(self, record: Record) -> None:
        body = map_record(record, self.cfg)
        url = f"{self.cfg.api_url.rstrip('/')}/patients"
        try:
            r = self.client.post(url, json=body, headers=self._headers())
            if r.status_code == 401:            # token expired -> log in once more
                self._token = None
                r = self.client.post(url, json=body, headers=self._headers())
        except httpx.HTTPError as exc:
            raise DestinationError(f"network error: {exc}") from exc
        if r.status_code not in (200, 201):
            raise DestinationError(f"POST /patients -> {r.status_code}: {r.text[:300]}")
        log.info("gurukrupa_api: saved patient %s", r.json().get("id") if r.content else "?")
