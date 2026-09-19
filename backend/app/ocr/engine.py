"""Glue: preprocessed image -> Tesseract text -> template parser -> flagged values + confidence."""
from dataclasses import dataclass, field

import numpy as np
import pytesseract

from app.ocr import configure_tesseract
from app.ocr.templates import Machine
from app.ocr.validate import confidence, flag

FALLBACK_CONFIG = "--psm 4"  # single column of variable-size text, no whitelist


@dataclass
class OcrResult:
    text: str
    values: list[dict] = field(default_factory=list)
    confidence: float = 0.0


def image_to_text(img: np.ndarray, config: str) -> str:
    configure_tesseract()
    return pytesseract.image_to_string(img, lang="eng", config=config)


def recognise(img: np.ndarray, machine: Machine) -> OcrResult:
    """Run the template's config first; if fields are missing, retry without the whitelist
    and merge (whitelist pass wins on conflicts)."""
    text = image_to_text(img, machine.tess_config)
    values = machine.parse(text)
    if len(values) < len(machine.fields):
        text2 = image_to_text(img, FALLBACK_CONFIG)
        have = {v["l"] for v in values}
        extra = [v for v in machine.parse(text2) if v["l"] not in have]
        if extra:
            order = {label: i for i, label in enumerate(machine.fields)}
            values = sorted(values + extra, key=lambda v: order.get(v["l"], 99))
        text = text + "\n----\n" + text2
    values = flag(values)
    return OcrResult(text=text, values=values, confidence=confidence(values, len(machine.fields)))
