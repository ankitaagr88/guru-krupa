"""Console provider: prints outgoing messages; used by simulate.py and local development."""
from __future__ import annotations

import sys
from typing import Any

from app.messages import IncomingMessage, Option
from app.providers.base import Provider


class ConsoleProvider(Provider):
    name = "console"

    def __init__(self, out=None):
        self.out = out or sys.stdout
        if hasattr(self.out, "reconfigure"):          # Windows consoles default to cp1252
            try:
                self.out.reconfigure(encoding="utf-8")
            except Exception:  # noqa: BLE001
                pass
        self.sent: list[tuple[str, str, str]] = []   # (to, kind, text) for inspection
        self.last_options: list[Option] = []

    def _print(self, text: str) -> None:
        try:
            print(text, file=self.out, flush=True)
        except UnicodeEncodeError:
            enc = getattr(self.out, "encoding", None) or "ascii"
            print(text.encode(enc, errors="replace").decode(enc), file=self.out, flush=True)

    def send_text(self, to: str, text: str) -> None:
        self.sent.append((to, "text", text))
        self.last_options = []
        self._print(f"\n[bot -> {to}]\n{text}")

    def send_buttons(self, to: str, text: str, buttons: list[Option]) -> None:
        self.sent.append((to, "buttons", text))
        self.last_options = list(buttons)
        self._print(f"\n[bot -> {to}]\n{text}")
        for i, b in enumerate(buttons, start=1):
            self._print(f"   [{i}] {b.title}")

    def send_list(self, to: str, text: str, options: list[Option], button_label: str) -> None:
        self.sent.append((to, "list", text))
        self.last_options = list(options)
        self._print(f"\n[bot -> {to}]\n{text}\n   ({button_label})")
        for i, o in enumerate(options, start=1):
            self._print(f"   [{i}] {o.title}")

    def parse_incoming(self, payload: Any) -> IncomingMessage | None:
        """Accepts {"from": "...", "text": "..."} or a plain string (phone defaults to 'console')."""
        if isinstance(payload, str):
            return IncomingMessage(from_phone="console", text=payload)
        if isinstance(payload, dict):
            return IncomingMessage(from_phone=payload.get("from", "console"), text=payload.get("text"),
                                   selected_id=payload.get("selected_id"))
        return None

    def verify_webhook(self, params: dict) -> str | None:
        return params.get("hub.challenge")
