"""Glue: preprocessed image -> layout-aware page read -> template parser -> flagged values + confidence.

`recognise` first reads the page with `app.ocr.layout` (own row segmentation, three-scale voting)
and runs the template's `parse_page`; fields still missing are filled from plain whole-page
Tesseract passes (`parse` on the text). When the template has a twin (HRK/YPC REF <-> KER share one
slip) the twin's section is parsed from the same page into `OcrResult.twin_values`."""
from dataclasses import dataclass, field

import numpy as np
import pytesseract

from app.ocr import configure_tesseract
from app.ocr.layout import PASSES, Page, read_page
from app.ocr.templates import Machine
from app.ocr.validate import confidence, flag

FALLBACK_CONFIG = "--psm 4"  # single column of variable-size text, no whitelist


@dataclass
class OcrResult:
    text: str
    values: list[dict] = field(default_factory=list)
    confidence: float = 0.0
    twin_values: list[dict] = field(default_factory=list)  # the twin machine's fields from the same image
    twin_confidence: float = 0.0


def image_to_text(img: np.ndarray, config: str) -> str:
    configure_tesseract()
    return pytesseract.image_to_string(img, lang="eng", config=config)


def _merge(values: list[dict], extra: list[dict], order: tuple[str, ...]) -> list[dict]:
    have = {v["l"] for v in values}
    new = [v for v in extra if v["l"] not in have]
    if not new:
        return values
    rank = {label: i for i, label in enumerate(order)}
    return sorted(values + new, key=lambda v: rank.get(v["l"], 99))


def recognise(img: np.ndarray, machine: Machine, page: Page | None = None) -> OcrResult:
    """Layout pass (if the template has one), then plain-text passes for anything still missing
    (layout values win on conflicts)."""
    text = ""
    values: list[dict] = []
    twin: list[dict] = []
    if machine.parse_page is not None or machine.parse_twin is not None:
        page = page or read_page(img, passes=machine.passes or PASSES)
        text = page.text
        if machine.parse_page is not None:
            values = machine.parse_page(page)
        if machine.parse_twin is not None:
            twin = machine.parse_twin(page)
    if len(values) < len(machine.fields):
        for config in (machine.tess_config, FALLBACK_CONFIG):
            more = image_to_text(img, config)
            values = _merge(values, machine.parse(more), machine.fields)
            text = (text + "\n----\n" + more) if text else more
            if len(values) >= len(machine.fields):
                break
    values = flag(values)
    twin = flag(twin)
    twin_fields = len(machine.fields)
    if machine.twin_key:
        from app.ocr.templates import MACHINES  # local: templates imports this module's siblings

        twin_fields = len(MACHINES[machine.twin_key].fields)
    return OcrResult(text=text, values=values, confidence=confidence(values, len(machine.fields)),
                     twin_values=twin, twin_confidence=confidence(twin, twin_fields) if twin else 0.0)
