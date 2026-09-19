"""Happy paths, honorifics, validation, restart/resume, expiry, same-day re-scan."""
from __future__ import annotations

from app.conversation import Conversation
from app.db import ChatSession
from tests.conftest import Patient, RecordingDestination


def q(cfg, key, lang):
    return cfg.question(key).text[lang]


def test_gujarati_happy_path(patient, gurukrupa, destination):
    m = gurukrupa.messages
    (first,) = patient.say("Hi")
    assert first.kind == "buttons"
    assert first.text == m.language_prompt["gujarati"]
    assert [o.title for o in first.options] == ["ગુજરાતી", "हिन्दी"]
    assert [o.id for o in first.options] == ["gujarati", "hindi"]

    (r,) = patient.tap("gujarati")
    assert r.kind == "text" and r.text == q(gurukrupa, "name", "gujarati")

    (r,) = patient.say("Ramila Patel")
    assert r.text == "આભાર, Ramila. હવે તમારી ઉંમર શું છે?"          # no honorific yet

    (r,) = patient.say("62")
    assert r.kind == "buttons" and r.text == q(gurukrupa, "gender", "gujarati")
    assert [o.title for o in r.options] == ["Male", "Female", "Other"]
    assert [o.id for o in r.options] == ["M", "F", "O"]

    (r,) = patient.tap("F")
    assert r.text == "Ramilaબેન, તમે હમણાં ક્યાં રહો છો? તમારું સરનામું કહી શકશો?"

    (r,) = patient.say("Vesu, Surat")
    assert r.text == q(gurukrupa, "contact", "gujarati")

    (r,) = patient.say("98250 12345")
    assert r.kind == "list"                     # 4 options -> list message
    assert r.text == q(gurukrupa, "source", "gujarati")
    assert r.list_button == "પસંદ કરો"
    assert [o.title for o in r.options] == ["ગૂગલ", "સોશિયલ મીડિયા", "મિત્ર/કુટુંબ", "ડૉક્ટરની ભલામણ"]

    (r,) = patient.tap("doctor")
    assert r.kind == "text" and r.text == m.closing["gujarati"]

    assert len(destination.saved) == 1
    rec = destination.saved[0]
    assert rec["clinic_id"] == "gurukrupa"
    assert rec["phone"] == patient.phone
    assert rec["language"] == "gujarati"
    assert rec["submitted_at"].endswith("+05:30")
    assert rec["answers"] == {
        "name": "Ramila Patel", "age": 62, "gender": "F", "address": "Vesu, Surat",
        "contact": "9825012345", "source": "doctor",
    }


def test_hindi_happy_path(patient, gurukrupa, destination):
    m = gurukrupa.messages
    patient.say("नमस्ते")
    (r,) = patient.tap("hindi")
    assert r.text == q(gurukrupa, "name", "hindi")
    (r,) = patient.say("Suresh Kumar")
    assert r.text == "धन्यवाद, Suresh। अब आपकी उम्र क्या है?"
    (r,) = patient.say("४५")                                   # Devanagari digits accepted
    assert r.text == q(gurukrupa, "gender", "hindi")
    (r,) = patient.tap("M")
    assert r.text == "Suresh जी, आप अभी कहाँ रहते हैं? अपना पता बता सकते हैं?"
    (r,) = patient.say("Adajan, Surat")
    assert r.text == q(gurukrupa, "contact", "hindi")
    (r,) = patient.say("+91 99250 67890")
    assert r.kind == "list" and r.list_button == "चुनें"
    assert [o.title for o in r.options] == ["गूगल", "सोशल मीडिया", "दोस्त/परिवार", "डॉक्टर की सिफ़ारिश"]
    (r,) = patient.tap("social")
    assert r.text == m.closing["hindi"]
    assert destination.saved[0]["answers"] == {
        "name": "Suresh Kumar", "age": 45, "gender": "M", "address": "Adajan, Surat",
        "contact": "9925067890", "source": "social",
    }


def test_every_bot_message_matches_yaml_script(patient, gurukrupa):
    """Every text the bot sent in a Gujarati run is a rendered YAML script, nothing else."""
    patient.say("Hi"); patient.tap("gujarati"); patient.say("Kiran Vaghela"); patient.say("34")
    patient.tap("M"); patient.say("Adajan"); patient.say("9925067890"); patient.tap("google")
    expected = [
        gurukrupa.messages.language_prompt["gujarati"],
        q(gurukrupa, "name", "gujarati"),
        q(gurukrupa, "age", "gujarati").replace("{name_hon}", "Kiran"),
        q(gurukrupa, "gender", "gujarati"),
        q(gurukrupa, "address", "gujarati").replace("{name_hon}", "Kiranભાઈ"),
        q(gurukrupa, "contact", "gujarati"),
        q(gurukrupa, "source", "gujarati"),
        gurukrupa.messages.closing["gujarati"],
    ]
    assert [o.text for o in patient.outbox] == expected


def test_honorific_only_after_gender(convo, gurukrupa):
    assert convo.address_forms({"name": "Ramesh Patel"}, "gujarati") == ("Ramesh", "Ramesh")
    assert convo.address_forms({"name": "Ramesh Patel", "gender": "M"}, "gujarati") == ("Ramesh", "Rameshભાઈ")
    assert convo.address_forms({"name": "Ramila Patel", "gender": "F"}, "gujarati") == ("Ramila", "Ramilaબેન")
    assert convo.address_forms({"name": "Sam", "gender": "O"}, "gujarati") == ("Sam", "Sam")   # skipped
    assert convo.address_forms({"name": "Suresh", "gender": "M"}, "hindi") == ("Suresh", "Suresh जी")
    assert convo.address_forms({"name": "Sunita", "gender": "F"}, "hindi") == ("Sunita", "Sunita जी")
    assert convo.address_forms({"name": "Sunita"}, "hindi") == ("Sunita", "Sunita")
    assert convo.address_forms({}, "hindi") == ("", "")


def test_invalid_age_and_phone_reask_politely(patient, gurukrupa):
    m = gurukrupa.messages
    patient.say("Hi"); patient.tap("gujarati"); patient.say("Ramesh")
    for bad in ["abc", "150", "-3"]:
        (r,) = patient.say(bad)
        assert r.text.startswith(m.invalid_number["gujarati"])
        assert r.text.endswith("આભાર, Ramesh. હવે તમારી ઉંમર શું છે?")
    (r,) = patient.say("45 years")
    assert r.kind == "buttons"                     # accepted -> moved on to gender
    patient.tap("M"); patient.say("Vesu")
    for bad in ["12345", "5876543210", "98765432101", "call me"]:
        (r,) = patient.say(bad)
        assert r.text.startswith(m.invalid_phone["gujarati"])
        assert r.kind == "text"
    for good, stored in [("09876543210", "9876543210")]:
        (r,) = patient.say(good)
        assert r.kind == "list"
    with patient.convo.session_factory() as db:
        sess = db.query(ChatSession).one()
        assert sess.answers["contact"] == "9876543210"


def test_typed_answer_on_choice_question_is_reasked_with_buttons(patient, gurukrupa):
    patient.say("Hi"); patient.tap("gujarati"); patient.say("Ramesh"); patient.say("40")
    (r,) = patient.say("purush")
    assert r.kind == "buttons"
    assert r.text.startswith(gurukrupa.messages.invalid_choice["gujarati"])
    (r,) = patient.say("male")                    # typing the label still works
    assert r.text.startswith("Rameshભાઈ")


def test_wrong_language_reply_reasks_language(patient, gurukrupa):
    patient.say("Hi")
    (r,) = patient.say("Ramesh Patel")
    assert r.kind == "buttons" and r.text.endswith(gurukrupa.messages.language_prompt["gujarati"])
    (r,) = patient.say("2")                        # numbered fallback -> Hindi
    assert r.text == q(gurukrupa, "name", "hindi")


def test_session_survives_service_restart(gurukrupa, destination, session_factory, clock):
    """Half-filled form + a brand-new Conversation object (as after a restart) -> continues."""
    first = Conversation(gurukrupa, destination, session_factory, now=clock, sleep=lambda s: None)
    p = Patient(first)
    p.say("Hi"); p.tap("gujarati"); p.say("Ramesh Patel"); p.say("45")

    second = Conversation(gurukrupa, destination, session_factory, now=clock, sleep=lambda s: None)
    p2 = Patient(second, phone=p.phone)
    (r,) = p2.tap("M")                             # answers the pending gender question
    assert r.text.startswith("Rameshભાઈ")
    p2.say("Vesu"); p2.say("9876543210"); p2.tap("google")
    assert destination.saved[0]["answers"]["name"] == "Ramesh Patel"


def test_trigger_mid_form_restarts(patient, gurukrupa):
    patient.say("Hi"); patient.tap("hindi"); patient.say("Suresh")
    (r,) = patient.say("hi")
    assert r.kind == "buttons" and r.text == gurukrupa.messages.language_prompt["gujarati"]
    with patient.convo.session_factory() as db:
        sess = db.query(ChatSession).one()
        assert sess.step == -1 and sess.answers == {} and sess.language is None


def test_inactivity_expiry_restarts_gently(patient, gurukrupa, clock):
    patient.say("Hi"); patient.tap("hindi"); patient.say("Suresh")
    clock.advance(minutes=31)
    out = patient.say("45")
    assert [o.kind for o in out] == ["text", "buttons"]
    assert out[0].text == gurukrupa.messages.expired_restart["hindi"]    # in the language they had chosen
    assert out[1].text == gurukrupa.messages.language_prompt["gujarati"]


def test_second_scan_same_day_says_already_registered(patient, gurukrupa, clock, destination):
    patient.say("Hi"); patient.tap("gujarati"); patient.say("Ramila Patel"); patient.say("62")
    patient.tap("F"); patient.say("Vesu"); patient.say("9876543210"); patient.tap("google")
    clock.advance(hours=2)
    (r,) = patient.say("Hi")
    assert r.kind == "text"
    assert r.text == gurukrupa.messages.already_registered["gujarati"].replace("{name_hon}", "Ramilaબેન")
    assert len(destination.saved) == 1
    # next day (IST) -> fresh form
    clock.advance(hours=20)
    (r,) = patient.say("Hi")
    assert r.kind == "buttons" and r.text == gurukrupa.messages.language_prompt["gujarati"]


def test_destination_failure_still_confirms_patient(gurukrupa, session_factory, clock):
    dest = RecordingDestination(fail_times=99)
    convo = Conversation(gurukrupa, dest, session_factory, now=clock, sleep=lambda s: None)
    p = Patient(convo)
    p.say("Hi"); p.tap("gujarati"); p.say("Ramesh"); p.say("45"); p.tap("M"); p.say("Vesu"); p.say("9876543210")
    (r,) = p.tap("doctor")
    assert r.text == gurukrupa.messages.closing["gujarati"]
    assert dest.calls == gurukrupa.destination.attempts
