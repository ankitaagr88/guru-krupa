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
TARGET_CHAR_H = 36  # px; laser reports (HBM-1) render at ~20px glyphs, thermal slips at ~35px after `resize`


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


def glyph_mask(binary: np.ndarray) -> np.ndarray:
    """White-on-black mask of glyph-sized connected components only: creases, handwriting strokes,
    rules and specks are dropped so they cannot bias the skew estimate."""
    inv = cv2.bitwise_not(binary)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(inv, connectivity=8)
    if n < 2:
        return np.zeros_like(inv)
    h_page, w_page = binary.shape[:2]
    hs = [st[3] for st in stats[1:] if 6 <= st[3] <= h_page * 0.05 and st[2] <= w_page * 0.2 and st[4] >= 10]
    ch = float(np.median(hs)) if hs else 30.0
    keep = np.zeros(n, bool)
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if 0.3 * ch <= h <= 2.0 * ch and w <= 6 * ch and area >= 0.1 * w * h:
            keep[i] = True
    return np.where(keep[labels], 255, 0).astype(np.uint8)


def text_mask(binary: np.ndarray) -> np.ndarray:
    """Glyph mask with characters smeared into line-shaped blobs (used by the projection search)."""
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 3))
    return cv2.morphologyEx(glyph_mask(binary), cv2.MORPH_CLOSE, kernel)


def _profile_score(mask: np.ndarray, angle: float) -> float:
    """Sharpness of the horizontal projection after rotating by `angle`: text lines that are truly
    horizontal give a spiky profile (large row-to-row differences)."""
    h, w = mask.shape
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    rot = cv2.warpAffine(mask, m, (w, h), flags=cv2.INTER_NEAREST, borderValue=0)
    profile = rot.sum(axis=1, dtype=np.float64)
    return float(np.sum(np.diff(profile) ** 2))


def estimate_skew(binary: np.ndarray) -> float:
    """Correction angle in degrees to pass to `rotate` (OpenCV convention: positive = counter-
    clockwise), found by a coarse-to-fine projection-profile search in +-SKEW_LIMIT. A page tilted
    4 degrees counter-clockwise gives about -4. 0.0 when there is no text."""
    mask = text_mask(binary)
    if cv2.countNonZero(mask) < 50:
        return 0.0
    h, w = mask.shape
    scale = min(1.0, 800 / max(h, w))
    if scale < 1.0:
        mask = cv2.resize(mask, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    coarse = np.arange(-SKEW_LIMIT, SKEW_LIMIT + 0.01, 0.5)
    best = max(coarse, key=lambda a: _profile_score(mask, a))
    fine = np.arange(best - 0.5, best + 0.51, 0.1)
    best = max(fine, key=lambda a: _profile_score(mask, a))
    return round(float(best), 2)


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


def median_char_height(binary: np.ndarray) -> float:
    """Median height of glyph-sized connected components; 0.0 when there is no text."""
    n, _, stats, _ = cv2.connectedComponentsWithStats(cv2.bitwise_not(binary), connectivity=8)
    h_page, w_page = binary.shape[:2]
    hs = [st[3] for st in stats[1:] if 6 <= st[3] <= h_page * 0.05 and st[2] <= w_page * 0.2 and st[4] >= 10]
    return float(np.median(hs)) if len(hs) >= 20 else 0.0


def glyph_scale(binary: np.ndarray, target: int = TARGET_CHAR_H, max_long: int = MAX_LONG_SIDE,
                max_upscale: float = MAX_UPSCALE) -> float:
    """Extra up-scaling factor (>= 1) that brings the median glyph up to `target` px, capped by the
    long-side limit: small print (A4 reports at 200 dpi) is unreadable to Tesseract below ~30 px."""
    ch = median_char_height(binary)
    if ch <= 0 or ch >= target:
        return 1.0
    scale = min(target / ch, max_upscale)
    long_ = max(binary.shape[:2])
    if long_ * scale > max_long:
        scale = max_long / long_
    return scale if scale > 1.02 else 1.0


def preprocess_array(rgb: np.ndarray) -> np.ndarray:
    gray = to_gray(rgb)
    gray = resize(gray)
    binary = threshold(denoise(gray))
    extra = glyph_scale(binary)
    if extra > 1.0:
        gray = cv2.resize(gray, None, fx=extra, fy=extra, interpolation=cv2.INTER_CUBIC)
        binary = threshold(denoise(gray))
    binary = deskew(binary)
    return pad(binary)


def preprocess(path: str | Path) -> np.ndarray:
    """Full pipeline: EXIF-orient -> gray -> upscale (short side, then glyph height) -> denoise ->
    adaptive threshold -> deskew."""
    return preprocess_array(load_oriented(path))
