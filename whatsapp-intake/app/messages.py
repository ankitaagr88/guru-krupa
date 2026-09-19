"""Provider-neutral message shapes passed between the conversation engine and providers."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass
class Option:
    id: str      # value sent back when tapped (Meta: reply id, max 256 chars)
    title: str   # label shown to the patient (Meta: 20 chars buttons / 24 chars list rows)


@dataclass
class OutgoingMessage:
    kind: Literal["text", "buttons", "list"]
    text: str
    options: list[Option] = field(default_factory=list)
    list_button: str = ""   # label of the button that opens a list message

    @classmethod
    def plain(cls, text: str) -> "OutgoingMessage":
        return cls(kind="text", text=text)

    @classmethod
    def choice(cls, text: str, options: list[Option], list_button: str) -> "OutgoingMessage":
        """WhatsApp allows at most 3 reply buttons; more options become a list message."""
        if len(options) <= 3:
            return cls(kind="buttons", text=text, options=options)
        return cls(kind="list", text=text, options=options, list_button=list_button)


@dataclass
class IncomingMessage:
    from_phone: str             # sender in international digits, e.g. "919876543210"
    text: str | None = None     # typed text, if any
    selected_id: str | None = None  # id of a tapped button / list row, if any
    selected_title: str | None = None
    message_id: str | None = None
    raw: Any = None
