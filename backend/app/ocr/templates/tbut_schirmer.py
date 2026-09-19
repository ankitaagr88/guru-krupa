"""Tear break-up time + Schirmer I: read off a stopwatch / paper strip, no printout -> manual entry only."""
KEY = "tbut_schirmer"
LABEL = "TBUT / Schimer I"
FIELDS = ["TBUT (R)", "TBUT (L)", "Schimer (R)", "Schimer (L)"]
MANUAL_ONLY = True
TESS_CONFIG = "--psm 6"


def parse(text: str) -> list[dict]:  # never OCR'd; kept so every template has the same shape
    return []
