"""HTTP surface: health, QR, webhook verification and an end-to-end webhook message."""
from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 't.db'}")
    monkeypatch.setenv("WHATSAPP_PROVIDER", "console")
    monkeypatch.setenv("WEBHOOK_VERIFY_TOKEN", "verify-me")
    from app import main
    with TestClient(main.app) as c:
        yield c


def test_health_and_config_load(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert "gurukrupa" in r.json()["clinics"] and "allergy-clinic" in r.json()["clinics"]


def test_qr_png_and_page(client):
    r = client.get("/qr/gurukrupa.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content[:8] == b"\x89PNG\r\n\x1a\n"
    r = client.get("/qr/gurukrupa")
    assert r.status_code == 200 and "wa.me/919328621216?text=Hi" in r.text and "Guru Krupa" in r.text
    assert "નવા દર્દી" in r.text and "नए मरीज़" in r.text
    assert client.get("/qr/nope").status_code == 404


def test_webhook_roundtrip_with_console_provider(client):
    # console provider echoes the challenge (Meta provider checks the verify token; see test_meta_webhook)
    r = client.get("/webhook/gurukrupa", params={"hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "123"})
    assert r.status_code == 200 and r.text == "123"
    r = client.post("/webhook/gurukrupa", json={"from": "919000000009", "text": "Hi"})
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    r = client.post("/webhook/gurukrupa", json={"from": "919000000009", "selected_id": "gujarati"})
    assert r.json() == {"status": "ok"}
    assert client.post("/webhook/unknown", json={}).status_code == 404
