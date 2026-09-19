"""WhatsApp provider interface.

A provider knows how to (a) send text / button / list messages to a phone number and
(b) turn an incoming webhook payload into an ``IncomingMessage``.

Implementations: ``meta_cloud`` (official Meta WhatsApp Business Cloud API) and ``console``
(prints to the terminal for local development). A BSP adapter (Interakt, AiSensy, WATI) is
one more subclass of ``Provider`` with the same four methods.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from app.messages import IncomingMessage, Option, OutgoingMessage


class Provider(ABC):
    name: str = "base"

    @abstractmethod
    def send_text(self, to: str, text: str) -> None: ...

    @abstractmethod
    def send_buttons(self, to: str, text: str, buttons: list[Option]) -> None:
        """At most 3 buttons (WhatsApp limit)."""

    @abstractmethod
    def send_list(self, to: str, text: str, options: list[Option], button_label: str) -> None:
        """Up to 10 rows, shown after the patient taps ``button_label``."""

    @abstractmethod
    def parse_incoming(self, payload: Any) -> IncomingMessage | None:
        """Return the patient's message, or None for status callbacks / unsupported events."""

    def verify_webhook(self, params: dict) -> str | None:
        """Webhook GET verification; return the challenge string to echo, or None to reject."""
        return None

    # Convenience used by main.py and simulate.py
    def send(self, to: str, msg: OutgoingMessage) -> None:
        if msg.kind == "buttons":
            self.send_buttons(to, msg.text, msg.options)
        elif msg.kind == "list":
            self.send_list(to, msg.text, msg.options, msg.list_button)
        else:
            self.send_text(to, msg.text)
