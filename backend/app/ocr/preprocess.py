"""Image clean-up before Tesseract. Each step is a small pure function so it can be tuned
(and unit-tested) once real printout photos arrive in tests/ocr_samples/."""
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

MIN_SHORT_SIDE = 1200  # Tesseract likes ~30px+ x-height; phone photos of thermal paper are often smaller
MAX_LONG_SIDE = 4000  # cap so a 48 MP photo doesn't take ages
MAX_UPSCALE = 3.0  # blowing a tiny crop up further just makes blurry giant glyphs
SKEW_LIMIT = 15.0  # degrees; anything larger is a mis-detected rectangle, not a tilted photo


def load_oriented(path: str | Path) -> np.ndarray:
    """Open with PIL (honours EXIF orientation from phone cameras) -> RGB ndarray."""
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)
        return np.asarray(im.convert("RGB"))


def to_gray(rgb: np.ndarray) -> np.ndarray:
    if rgb.ndim == 2:
        return rgb
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)


def resize(gray: np.ndarray, min_short: int = MIN_SHORT_SIDE, max_long: int = MAX_LONG_SIDE,
           max_upscale: float = MAX_UPSCALE) -> np.ndarray:
    h, w = gray.shape[:2]
    short, long_ = min(h, w), max(h, w)
    scale = 1.0
    if short < min_short:
        scale = min(min_short / short, max_upscale)
    if long_ * scale > max_long:
        scale = max_long / long_
    if abs(scale - 1.0) < 1e-3:
        return gray
    interp = cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
    return cv2.resize(gray, None, fx=scale, fy=scale, interpolation=interp)


def denoise(gray: np.ndarray) -> np.ndarray:
    """Median (salt-and-pepper sensor noise) then a light Gaussian (paper grain / JPEG blocks).
    Chosen over bilateral / non-local-means on synthetic noisy printouts: 92 vs 82-86 of 102 fields."""
    return cv2.GaussianBlur(cv2.medianBlur(gray, 3), (3, 3), 0)


def threshold(gray: np.ndarray) -> np.ndarray:
    """Adaptive threshold copes with uneven phone-flash lighting. Returns black text on white."""
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 61, 20)


def text_mask(binary: np.ndarray) -> np.ndarray:
    """White-on-black mask where characters are smeared into line-shaped blobs."""
    inv = cv2.bitwise_not(binary)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 3))
    return cv2.morphologyEx(inv, cv2.MORPH_CLOSE, kernel)


def estimate_skew(binary: np.ndarray) -> float:
    """Correction angle in degrees to pass to `rotate` (OpenCV convention: positive = counter-
    clockwise), from the minimum-area rectangle around all text pixels. A page tilted 4 degrees
    counter-clockwise gives about -4. 0.0 when there is no text or the tilt is implausible."""
    mask = text_mask(binary)
    coords = cv2.findNonZero(mask)
    if coords is None or len(coords) < 50:
        return 0.0
    (_, _), (rw, rh), angle = cv2.minAreaRect(coords)
    if rw == 0 or rh == 0:
        return 0.0
    # OpenCV >= 4.5 returns angle in (0, 90]; make it the rotation of the long side from horizontal.
    if angle > 45:
        angle -= 90
    if abs(angle) > SKEW_LIMIT:
        return 0.0
    return float(angle)


def rotate(img: np.ndarray, angle: float) -> np.ndarray:
    """Rotate about the centre, padding with white; nearest-neighbour keeps a binary image binary."""
    if abs(angle) < 0.05:
        return img
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(img, m, (w, h), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=255)


def deskew(binary: np.ndarray) -> np.ndarray:
    return rotate(binary, estimate_skew(binary))


def pad(binary: np.ndarray, px: int = 20) -> np.ndarray:
    return cv2.copyMakeBorder(binary, px, px, px, px, cv2.BORDER_CONSTANT, value=255)


def preprocess_array(rgb: np.ndarray) -> np.ndarray:
    gray = to_gray(rgb)
    gray = resize(gray)
    gray = denoise(gray)
    binary = threshold(gray)
    binary = deskew(binary)
    return pad(binary)


def preprocess(path: str | Path) -> np.ndarray:
    """Full pipeline: EXIF-orient -> gray -> upscale -> denoise -> adaptive threshold -> deskew."""
    return preprocess_array(load_oriented(path))
