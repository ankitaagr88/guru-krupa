"""Meta WhatsApp Business Cloud API (Graph API v20+).

Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/
 - Send:      POST https://graph.facebook.com/{version}/{PHONE_NUMBER_ID}/messages
 - Webhook:   GET  (verification with hub.mode / hub.verify_token / hub.challenge)
              POST (messages, statuses)
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import ProviderConfig
from app.messages import IncomingMessage, Option
from app.providers.base import Provider

log = logging.getLogger(__name__)

BUTTON_TITLE_MAX = 20
LIST_ROW_TITLE_MAX = 24


class MetaCloudProvider(Provider):
    name = "meta_cloud"

    def __init__(self, cfg: ProviderConfig, client: httpx.Client | None = None):
        self.cfg = cfg
        self.client = client or httpx.Client(timeout=15)
        self.url = f"https://graph.facebook.com/{cfg.api_version}/{cfg.phone_number_id}/messages"

    # ---------------------------------------------------------------- sending
    def _post(self, body: dict) -> None:
        body = {"messaging_product": "whatsapp", "recipient_type": "individual", **body}
        r = self.client.post(self.url, json=body, headers={"Authorization": f"Bearer {self.cfg.token}"})
        if r.status_code >= 300:
            log.error("Meta send failed %s: %s", r.status_code, r.text[:300])
            r.raise_for_status()

    def send_text(self, to: str, text: str) -> None:
        self._post({"to": to, "type": "text", "text": {"preview_url": False, "body": text}})

    def send_buttons(self, to: str, text: str, buttons: list[Option]) -> None:
        self._post({"to": to, **self.build_buttons(text, buttons)})

    def send_list(self, to: str, text: str, options: list[Option], button_label: str) -> None:
        self._post({"to": to, **self.build_list(text, options, button_label)})

    @staticmethod
    def build_buttons(text: str, buttons: list[Option]) -> dict:
        if len(buttons) > 3:
            raise ValueError("WhatsApp reply buttons: max 3")
        return {
            "type": "interactive",
            "interactive": {
                "type": "button",
                "body": {"text": text},
                "action": {
                    "buttons": [
                        {"type": "reply", "reply": {"id": b.id, "title": b.title[:BUTTON_TITLE_MAX]}}
                        for b in buttons
                    ]
                },
            },
        }

    @staticmethod
    def build_list(text: str, options: list[Option], button_label: str) -> dict:
        if len(options) > 10:
            raise ValueError("WhatsApp list message: max 10 rows")
        return {
            "type": "interactive",
            "interactive": {
                "type": "list",
                "body": {"text": text},
                "action": {
                    "button": button_label[:BUTTON_TITLE_MAX],
                    "sections": [{"rows": [{"id": o.id, "title": o.title[:LIST_ROW_TITLE_MAX]} for o in options]}],
                },
            },
        }

    # ---------------------------------------------------------------- receiving
    def verify_webhook(self, params: dict) -> str | None:
        if params.get("hub.mode") == "subscribe" and params.get("hub.verify_token") == self.cfg.verify_token:
            return params.get("hub.challenge")
        return None

    def parse_incoming(self, payload: Any) -> IncomingMessage | None:
        """First patient message in the payload; None for delivery/read statuses and others."""
        try:
            for entry in payload.get("entry", []):
                for change in entry.get("changes", []):
                    value = change.get("value", {})
                    for m in value.get("messages", []):
                        parsed = self._parse_message(m)
                        if parsed:
                            return parsed
        except AttributeError:
            return None
        return None

    @staticmethod
    def _parse_message(m: dict) -> IncomingMessage | None:
        base = dict(from_phone=m.get("from", ""), message_id=m.get("id"), raw=m)
        kind = m.get("type")
        if kind == "text":
            return IncomingMessage(text=m.get("text", {}).get("body", ""), **base)
        if kind == "interactive":
            inter = m.get("interactive", {})
            reply = inter.get("button_reply") or inter.get("list_reply") or {}
            if reply:
                return IncomingMessage(selected_id=reply.get("id"), selected_title=reply.get("title"), **base)
            return None
        if kind == "button":   # reply to a template quick-reply button
            b = m.get("button", {})
            return IncomingMessage(selected_id=b.get("payload"), selected_title=b.get("text"), text=b.get("text"), **base)
        # images, audio, stickers, reactions... -> treated as an empty text so the bot re-asks
        return IncomingMessage(text="", **base)
