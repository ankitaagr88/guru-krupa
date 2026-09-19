"""The conversation state machine: one persisted session per (clinic, patient phone).

States: step == -1  -> waiting for the language choice
        step == n   -> waiting for the answer to clinic.questions[n]
        status == "completed" -> form delivered; a second scan the same day is told so.

``handle`` takes one incoming message and returns the list of messages to send back. It never
raises on patient input; provider I/O happens outside (see main.py / simulate.py), so this module
is fully testable without WhatsApp.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Callable
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.config import ClinicConfig, Question
from app.db import ChatSession, IntakeRecord
from app.destinations import Destination, deliver
from app.messages import IncomingMessage, Option, OutgoingMessage
from app.validation import validate_choice, validate_number, validate_phone, validate_text

log = logging.getLogger(__name__)


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Conversation:
    def __init__(
        self,
        clinic: ClinicConfig,
        destination: Destination,
        session_factory: sessionmaker,
        now: Callable[[], datetime] = utcnow,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.clinic = clinic
        self.destination = destination
        self.session_factory = session_factory
        self.now = now
        self.sleep = sleep
        self.tz = ZoneInfo(clinic.timezone)
        self._triggers = {t.casefold() for t in clinic.triggers}

    # ------------------------------------------------------------------ public entry point
    def handle(self, msg: IncomingMessage) -> list[OutgoingMessage]:
        text = (msg.text or "").strip()
        is_trigger = text.casefold() in self._triggers
        now = self.now()

        with self.session_factory() as db:
            sess = db.scalar(
                select(ChatSession).where(
                    ChatSession.clinic_id == self.clinic.id, ChatSession.phone == msg.from_phone
                )
            )

            if sess is not None and sess.status == "completed":
                if sess.completed_at and self._same_clinic_day(sess.completed_at, now):
                    return [OutgoingMessage.plain(self._render(self.clinic.messages.already_registered, sess))]
                self._reset(sess, now)                      # a new day -> a fresh form
                db.commit()
                return self._start(sess)

            if sess is None:
                sess = ChatSession(
                    clinic_id=self.clinic.id, phone=msg.from_phone, step=-1, answers={},
                    status="active", started_at=now, updated_at=now,
                )
                db.add(sess)
                db.commit()
                return self._start(sess)

            if is_trigger:                                   # scanned again / typed Hi -> restart
                self._reset(sess, now)
                db.commit()
                return self._start(sess)

            timeout = timedelta(minutes=self.clinic.session_timeout_minutes)
            if now - sess.updated_at > timeout:
                lang = sess.language or self.clinic.default_language
                self._reset(sess, now)
                db.commit()
                return [OutgoingMessage.plain(self.clinic.messages.expired_restart[lang]), *self._start(sess)]

            sess.updated_at = now
            if sess.step == -1:
                out = self._handle_language(sess, msg)
            else:
                out = self._handle_answer(db, sess, msg, now)
            db.commit()
            return out

    # ------------------------------------------------------------------ steps
    def _start(self, sess: ChatSession) -> list[OutgoingMessage]:
        return [self._language_prompt()]

    def _language_prompt(self, prefix: str = "") -> OutgoingMessage:
        m = self.clinic.messages
        lang = self.clinic.default_language
        options = [Option(c.value, c.label[lang]) for c in m.language_choices]
        text = (prefix + "\n\n" if prefix else "") + m.language_prompt[lang]
        return OutgoingMessage.choice(text, options, m.list_button[lang])

    def _handle_language(self, sess: ChatSession, msg: IncomingMessage) -> list[OutgoingMessage]:
        chosen = None
        if msg.selected_id in self.clinic.languages:
            chosen = msg.selected_id
        elif msg.text:
            t = msg.text.strip().casefold()
            for i, c in enumerate(self.clinic.messages.language_choices, start=1):
                labels = {c.value, *(lbl.casefold() for lbl in c.label.values())}
                if t in labels or t == str(i):
                    chosen = c.value
        if chosen is None:
            nudge = self.clinic.messages.invalid_choice[self.clinic.default_language]
            return [self._language_prompt(prefix=nudge)]
        sess.language = chosen
        sess.step = 0
        return [self._ask(sess, 0)]

    def _handle_answer(self, db: Session, sess: ChatSession, msg: IncomingMessage, now: datetime) -> list[OutgoingMessage]:
        q = self.clinic.questions[sess.step]
        ok, value = self._validate(q, sess.language, msg)
        if not ok:
            return [self._ask(sess, sess.step, prefix=self._invalid_message(q, sess.language))]
        answers = dict(sess.answers)
        answers[q.key] = value
        sess.answers = answers
        sess.step += 1
        if sess.step < len(self.clinic.questions):
            return [self._ask(sess, sess.step)]
        return [self._complete(db, sess, now)]

    def _complete(self, db: Session, sess: ChatSession, now: datetime) -> OutgoingMessage:
        sess.status = "completed"
        sess.completed_at = now
        row = IntakeRecord(
            clinic_id=self.clinic.id, phone=sess.phone, language=sess.language,
            answers=sess.answers,
            submitted_at=now.replace(tzinfo=timezone.utc).astimezone(self.tz).isoformat(timespec="seconds"),
        )
        db.add(row)
        db.commit()
        d = self.clinic.destination
        deliver(db, row, self.destination, attempts=d.attempts, backoff_seconds=d.backoff_seconds, sleep=self.sleep)
        return OutgoingMessage.plain(self._render(self.clinic.messages.closing, sess))

    # ------------------------------------------------------------------ helpers
    def _validate(self, q: Question, lang: str, msg: IncomingMessage):
        text = msg.text or ""
        if q.type == "choice":
            return validate_choice(q, lang, msg.text, msg.selected_id)
        if msg.selected_id and not text:        # a stray button tap on a typed question
            text = msg.selected_title or ""
        if q.type == "number":
            return validate_number(q, text)
        if q.type == "phone":
            return validate_phone(q, text)
        return validate_text(q, text)

    def _invalid_message(self, q: Question, lang: str) -> str:
        m = self.clinic.messages
        if q.invalid and lang in q.invalid:
            return q.invalid[lang]
        return {"number": m.invalid_number, "phone": m.invalid_phone, "choice": m.invalid_choice}.get(
            q.type, m.invalid_text
        )[lang]

    def _ask(self, sess: ChatSession, index: int, prefix: str = "") -> OutgoingMessage:
        q = self.clinic.questions[index]
        lang = sess.language
        text = self._render(q.text, sess)
        if prefix:
            text = prefix + "\n\n" + text
        if q.type == "choice":
            options = [Option(c.value, c.label[lang]) for c in q.choices]
            return OutgoingMessage.choice(text, options, self.clinic.messages.list_button[lang])
        return OutgoingMessage.plain(text)

    def _render(self, template: dict[str, str] | str, sess: ChatSession) -> str:
        lang = sess.language or self.clinic.default_language
        text = template[lang] if isinstance(template, dict) else template
        name, name_hon = self.address_forms(sess.answers, lang)
        if not name:
            text = text.replace("{name_hon}, ", "").replace("{name}, ", "")
        return text.replace("{name_hon}", name_hon).replace("{name}", name)

    def address_forms(self, answers: dict, lang: str) -> tuple[str, str]:
        """(plain name, name + honorific). Honorific only once the gender answer exists."""
        hon_cfg = self.clinic.honorifics.get(lang)
        full = str(answers.get(self.clinic.name_key) or "").strip()
        name = full.split()[0] if (full and (hon_cfg is None or hon_cfg.use_first_name)) else full
        gender = answers.get(self.clinic.gender_key)
        if not name or hon_cfg is None or gender is None:
            return name, name
        hon = hon_cfg.by_gender.get(str(gender), "")
        return name, f"{name}{hon_cfg.separator}{hon}" if hon else name

    def _reset(self, sess: ChatSession, now: datetime) -> None:
        sess.language = None
        sess.step = -1
        sess.answers = {}
        sess.status = "active"
        sess.started_at = now
        sess.updated_at = now
        sess.completed_at = None

    def _same_clinic_day(self, a: datetime, b: datetime) -> bool:
        to_local = lambda d: d.replace(tzinfo=timezone.utc).astimezone(self.tz).date()  # noqa: E731
        return to_local(a) == to_local(b)
