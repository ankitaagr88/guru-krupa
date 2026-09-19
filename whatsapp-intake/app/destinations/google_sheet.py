"""Destination: a Google Sheet through an Apps Script web app that accepts a JSON POST.

Apps Script side (paste into Extensions > Apps Script, then Deploy > New deployment > Web app,
"Execute as: me", "Who has access: Anyone"):

    function doPost(e) {
      var data = JSON.parse(e.postData.contents);
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
      if (sheet.getLastRow() === 0) sheet.appendRow(Object.keys(data));
      var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      sheet.appendRow(header.map(function (h) { return data[h] === undefined ? "" : data[h]; }));
      return ContentService.createTextOutput(JSON.stringify({ok: true}))
        .setMimeType(ContentService.MimeType.JSON);
    }
"""
from __future__ import annotations

import logging

import httpx

from app.config import DestinationConfig
from app.destinations.base import DestinationError, Record

log = logging.getLogger(__name__)


def flatten(record: Record) -> dict:
    row = {
        "submitted_at": record["submitted_at"],
        "clinic": record["clinic_id"],
        "whatsapp": record["phone"],
        "language": record["language"],
    }
    row.update(record["answers"])
    return row


class GoogleSheetDestination:
    name = "google_sheet"

    def __init__(self, cfg: DestinationConfig, client: httpx.Client | None = None):
        self.cfg = cfg
        if not cfg.webhook_url:
            log.warning("google_sheet destination has no webhook_url; records will wait in pending_records")
        # Apps Script answers with a 302 to script.googleusercontent.com -> follow it.
        self.client = client or httpx.Client(timeout=20, follow_redirects=True)

    def save(self, record: Record) -> None:
        if not self.cfg.webhook_url:
            raise DestinationError("GOOGLE_SHEET_WEBHOOK_URL is not configured")
        try:
            r = self.client.post(self.cfg.webhook_url, json=flatten(record))
        except httpx.HTTPError as exc:
            raise DestinationError(f"network error: {exc}") from exc
        if r.status_code != 200:
            raise DestinationError(f"sheet webhook -> {r.status_code}: {r.text[:300]}")
