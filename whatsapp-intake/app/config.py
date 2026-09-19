"""Clinic configuration: one YAML file per clinic under ``clinics/``.

Everything that differs between clinics (name, WhatsApp number, questions, wording in each
language, choices, destination, honorifics) lives in the YAML. The code never hard-codes a
clinic. ``${ENV_VAR}`` inside any YAML string is replaced from the environment / .env file.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Literal

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel, Field, model_validator

load_dotenv()

ROOT_DIR = Path(__file__).resolve().parent.parent
CLINICS_DIR = ROOT_DIR / "clinics"

FieldType = Literal["text", "number", "phone", "choice"]
_ENV_RE = re.compile(r"\$\{([A-Z0-9_]+)(?::-([^}]*))?\}")


def _expand_env(value):
    """Recursively replace ${VAR} / ${VAR:-default} in strings."""
    if isinstance(value, str):
        return _ENV_RE.sub(lambda m: os.environ.get(m.group(1), m.group(2) or ""), value)
    if isinstance(value, dict):
        return {k: _expand_env(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_expand_env(v) for v in value]
    return value


class Choice(BaseModel):
    value: str                      # what gets stored, e.g. "M", "google"
    label: dict[str, str]           # per-language label shown on the button / list row


class Question(BaseModel):
    key: str
    type: FieldType = "text"
    text: dict[str, str]            # per-language question text (may contain {name}, {name_hon})
    choices: list[Choice] = []
    min: int | None = None          # number: minimum accepted value
    max: int | None = None          # number: maximum accepted value
    min_length: int = 1             # text: minimum characters
    invalid: dict[str, str] | None = None  # optional per-question re-ask message

    @model_validator(mode="after")
    def _check(self):
        if self.type == "choice" and not self.choices:
            raise ValueError(f"question '{self.key}' is a choice but has no choices")
        return self


class Honorific(BaseModel):
    """How to address the patient once gender is known."""
    by_gender: dict[str, str] = {}   # gender value -> honorific ("M": "ભાઈ"); missing/"" = skip
    separator: str = " "             # "" joins (રમેશભાઈ), " " spaces (रमेश जी)
    use_first_name: bool = True


class Messages(BaseModel):
    language_prompt: dict[str, str]
    language_choices: list[Choice]
    list_button: dict[str, str]              # label of the "open list" button on list messages
    invalid_text: dict[str, str]
    invalid_number: dict[str, str]
    invalid_phone: dict[str, str]
    invalid_choice: dict[str, str]
    expired_restart: dict[str, str]
    already_registered: dict[str, str]
    closing: dict[str, str]


class ProviderConfig(BaseModel):
    kind: Literal["meta_cloud", "console"] = "console"
    phone_number_id: str = ""        # Meta "Phone number ID"
    token: str = ""                  # Meta permanent token
    verify_token: str = ""           # webhook verification secret
    api_version: str = "v20.0"


class DestinationConfig(BaseModel):
    kind: Literal["gurukrupa_api", "google_sheet", "csv", "none"] = "none"
    # gurukrupa_api
    api_url: str = ""
    username: str = ""
    password: str = ""
    referral_source_map: dict[str, dict[str, str]] = {}   # intake value -> {key, detail}
    note: str = "Registered via WhatsApp intake"
    # google_sheet
    webhook_url: str = ""
    # csv
    path: str = ""
    # retry policy
    attempts: int = 3
    backoff_seconds: float = 1.0


class ClinicConfig(BaseModel):
    id: str
    name: str
    name_local: dict[str, str] = {}     # clinic name in each language, for the QR page
    whatsapp_number: str                # digits with country code, for wa.me links
    timezone: str = "Asia/Kolkata"
    languages: list[str] = Field(min_length=1)
    default_language: str
    triggers: list[str] = ["Hi"]        # any of these (case-insensitive) starts / restarts
    qr_trigger: str = "Hi"              # the text pre-filled by the QR
    session_timeout_minutes: int = 30
    honorifics: dict[str, Honorific] = {}
    gender_key: str = "gender"          # which question supplies the gender for honorifics
    name_key: str = "name"
    messages: Messages
    questions: list[Question] = Field(min_length=1)
    provider: ProviderConfig = ProviderConfig()
    destination: DestinationConfig = DestinationConfig()
    qr_instructions: dict[str, str] = {}

    @model_validator(mode="after")
    def _check(self):
        if self.default_language not in self.languages:
            raise ValueError("default_language must be one of languages")
        for q in self.questions:
            for lang in self.languages:
                if lang not in q.text:
                    raise ValueError(f"question '{q.key}' has no text for language '{lang}'")
            for c in q.choices:
                for lang in self.languages:
                    if lang not in c.label:
                        raise ValueError(f"choice '{c.value}' of '{q.key}' has no label for '{lang}'")
        keys = [q.key for q in self.questions]
        if len(keys) != len(set(keys)):
            raise ValueError("question keys must be unique")
        return self

    def question(self, key: str) -> Question:
        return next(q for q in self.questions if q.key == key)


def load_clinic(path: str | Path) -> ClinicConfig:
    with open(path, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    return ClinicConfig.model_validate(_expand_env(raw))


def load_all_clinics(directory: Path = CLINICS_DIR) -> dict[str, ClinicConfig]:
    clinics: dict[str, ClinicConfig] = {}
    for path in sorted(directory.glob("*.yaml")):
        cfg = load_clinic(path)
        clinics[cfg.id] = cfg
    return clinics
