"""Meta Cloud API payload parsing + outgoing interactive payload shapes."""
from __future__ import annotations

from app.config import ProviderConfig
from app.messages import Option
from app.providers.meta_cloud import MetaCloudProvider


def wrap(message: dict) -> dict:
    return {
        "object": "whatsapp_business_account",
        "entry": [{"id": "1", "changes": [{"field": "messages", "value": {
            "messaging_product": "whatsapp",
            "metadata": {"display_phone_number": "919328621216", "phone_number_id": "123"},
            "contacts": [{"profile": {"name": "Ramesh"}, "wa_id": "919876543210"}],
            "messages": [message],
        }}]}],
    }


def provider():
    return MetaCloudProvider(ProviderConfig(kind="meta_cloud", phone_number_id="123", token="t", verify_token="secret"))


def test_parse_text():
    m = provider().parse_incoming(wrap({"from": "919876543210", "id": "wamid.1", "timestamp": "1",
                                        "type": "text", "text": {"body": "Hi"}}))
    assert m.from_phone == "919876543210" and m.text == "Hi" and m.selected_id is None and m.message_id == "wamid.1"


def test_parse_button_reply():
    m = provider().parse_incoming(wrap({"from": "919876543210", "id": "wamid.2", "type": "interactive",
                                        "interactive": {"type": "button_reply",
                                                        "button_reply": {"id": "gujarati", "title": "ગુજરાતી"}}}))
    assert m.selected_id == "gujarati" and m.selected_title == "ગુજરાતી" and m.text is None


def test_parse_list_reply():
    m = provider().parse_incoming(wrap({"from": "919876543210", "id": "wamid.3", "type": "interactive",
                                        "interactive": {"type": "list_reply",
                                                        "list_reply": {"id": "doctor", "title": "ડૉક્ટરની ભલામણ"}}}))
    assert m.selected_id == "doctor"


def test_status_callbacks_are_ignored():
    payload = {"entry": [{"changes": [{"value": {"statuses": [{"id": "wamid.1", "status": "delivered"}]}}]}]}
    assert provider().parse_incoming(payload) is None
    assert provider().parse_incoming({"weird": True}) is None


def test_webhook_verification():
    p = provider()
    assert p.verify_webhook({"hub.mode": "subscribe", "hub.verify_token": "secret", "hub.challenge": "42"}) == "42"
    assert p.verify_webhook({"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "42"}) is None


def test_button_and_list_payload_shapes():
    b = MetaCloudProvider.build_buttons("Pick", [Option("M", "Male"), Option("F", "Female")])
    assert b["interactive"]["type"] == "button"
    assert b["interactive"]["action"]["buttons"][0] == {"type": "reply", "reply": {"id": "M", "title": "Male"}}
    lst = MetaCloudProvider.build_list("Pick", [Option(str(i), f"opt{i}") for i in range(4)], "પસંદ કરો")
    assert lst["interactive"]["type"] == "list"
    assert lst["interactive"]["action"]["button"] == "પસંદ કરો"
    assert len(lst["interactive"]["action"]["sections"][0]["rows"]) == 4


def test_send_uses_graph_endpoint(monkeypatch):
    calls = []

    class FakeResp:
        status_code = 200
        text = ""

    class FakeClient:
        def post(self, url, json=None, headers=None):
            calls.append((url, json, headers))
            return FakeResp()

    p = MetaCloudProvider(ProviderConfig(kind="meta_cloud", phone_number_id="123", token="tok", api_version="v20.0"),
                          client=FakeClient())
    p.send_text("919876543210", "hello")
    url, body, headers = calls[0]
    assert url == "https://graph.facebook.com/v20.0/123/messages"
    assert body["to"] == "919876543210" and body["text"]["body"] == "hello" and body["messaging_product"] == "whatsapp"
    assert headers["Authorization"] == "Bearer tok"
