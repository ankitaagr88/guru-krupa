"""OCR pipeline for machine printouts: preprocess -> Tesseract -> per-machine parser -> sanity checks."""
import pytesseract

from app.config import settings


def configure_tesseract() -> None:
    """Point pytesseract at the binary from settings (Windows dev box / VPS apt install)."""
    if settings.TESSERACT_CMD:
        pytesseract.pytesseract.tesseract_cmd = settings.TESSERACT_CMD


def tesseract_available() -> bool:
    configure_tesseract()
    try:
        pytesseract.get_tesseract_version()
        return True
    except Exception:  # TesseractNotFoundError or a broken install
        return False
