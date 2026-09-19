"""OCR unit tests: parsers on noisy text (no Tesseract), sanity ranges, preprocessing steps, and
end-to-end recognition of synthetic printout images (skipped when Tesseract is not installed).
Real hospital printout photos go in tests/ocr_samples/ once collected (task B6)."""
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFont

from app.ocr import preprocess as pp
from app.ocr import validate
from app.ocr.templates import MACHINES, clm1_lensmeter, hnt1p_tono, hrk8000a_ker, hrk8000a_ref, tbut_schirmer
from app.ocr.templates._common import fix_token, normalise

# ---------------------------------------------------------------- helpers

MONO_FONTS = [Path(r"C:\Windows\Fonts\cour.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"),
              Path("/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf")]


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for f in MONO_FONTS:
        if f.exists():
            return ImageFont.truetype(str(f), size)
    return ImageFont.load_default(size=size)


def render_printout(text: str, *, size: int = 48, canvas=(1600, 1200), rotate: float = 0.0,
                    noise: float = 0.0) -> Image.Image:
    """A phone-photo-like image of a thermal printout: off-white paper, big monospace text."""
    im = Image.new("RGB", canvas, (245, 242, 235))
    d = ImageDraw.Draw(im)
    font = _font(size)
    for i, line in enumerate(text.splitlines()):
        d.text((120, 120 + i * int(size * 1.5)), line, font=font, fill=(25, 25, 25))
    if noise:
        arr = np.asarray(im).astype(np.int16)
        rng = np.random.default_rng(42)
        arr += rng.normal(0, noise * 255, arr.shape).astype(np.int16)
        im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    if rotate:
        im = im.rotate(rotate, expand=False, fillcolor=(245, 242, 235), resample=Image.BICUBIC)
    return im


def as_map(values: list[dict]) -> dict[str, str]:
    return {v["l"]: v["v"] for v in values}


# ---------------------------------------------------------------- machine definitions

def test_machines_match_mockup():
    assert list(MACHINES) == ["hnt1p_tono", "hrk8000a_ref", "hrk8000a_ker", "clm1_lensmeter", "ypc100k_ref",
                              "ypc100k_ker", "hbm1_biometry", "tbut_schirmer"]
    assert MACHINES["hnt1p_tono"].label == "HNT-1P — Tono-Pachy (IOP & CCT)"
    assert MACHINES["hrk8000a_ref"].fields == ("SPH (R)", "CYL (R)", "AX (R)", "SPH (L)", "CYL (L)", "AX (L)", "PD")
    assert MACHINES["clm1_lensmeter"].fields[2] == "AXS (R)"
    assert MACHINES["tbut_schirmer"].manual_only is True and MACHINES["tbut_schirmer"].fields == (
        "TBUT (R)", "TBUT (L)", "Schimer (R)", "Schimer (L)")
    assert all(not m.manual_only for k, m in MACHINES.items() if k != "tbut_schirmer")
    assert MACHINES["hrk8000a_ref"].twin_key == "hrk8000a_ker" and MACHINES["ypc100k_ker"].twin_key == "ypc100k_ref"
    assert MACHINES["hbm1_biometry"].label == "HBM-1 — Biometry (IOL report)" and MACHINES["hbm1_biometry"].fields == (
        "AL (R)", "AL (L)", "ACD (R)", "ACD (L)", "K1 (R)", "K1 (L)", "K2 (R)", "K2 (L)", "Axis (R)", "Axis (L)",
        "Target (R)", "Target (L)")
    assert MACHINES["ypc100k_ker"].as_dict() == {"key": "ypc100k_ker", "label": "YPC-100K — Keratometry (KER)",
                                                 "fields": ["K1 (R)", "K2 (R)", "K1 (L)", "K2 (L)"],
                                                 "manualOnly": False}


# ---------------------------------------------------------------- text normalisation

def test_fix_token_and_normalise():
    assert fix_token("L3") == "13" and fix_token("5O8") == "508" and fix_token("-O.Z5") == "-0.25"  # after upper()
    assert fix_token("IOP") == "IOP" and fix_token("K1") == "K1" and fix_token("SPH") == "SPH"
    assert normalise("sph - 0.25  cyl −2,00\n\nAX:l66") == ["SPH -0.25 CYL -2.00", "AX 166"]


# ---------------------------------------------------------------- parsers on noisy strings

def test_tono_parser_layouts():
    clean = hnt1p_tono.parse("IOP  R 13  L 12\nCIOP R 15 L 15\nCCT R 499 L 508")
    assert as_map(clean) == {"IOP (R)": "13", "IOP (L)": "12", "CIOP (R)": "15", "CIOP (L)": "15",
                             "CCT (R)": "499", "CCT (L)": "508"}
    noisy = hnt1p_tono.parse("HNT-1P TONO\n      R     L\nTOP   l3    I2 mmHg\nC1OP  15    1S\nCCT   499   5O8 um")
    assert as_map(noisy) == as_map(clean)
    partial = hnt1p_tono.parse("IOP 24 26\nCCT 520")
    assert as_map(partial) == {"IOP (R)": "24", "IOP (L)": "26", "CCT (R)": "520"}
    assert hnt1p_tono.parse("nothing useful here 2026/09/19") == []


def test_refraction_parser_layouts():
    want = {"SPH (R)": "-0.25", "CYL (R)": "-2.00", "AX (R)": "166", "SPH (L)": "-0.25", "CYL (L)": "-1.75",
            "AX (L)": "164", "PD": "66mm"}
    sections = "<R>\nSPH -0.25 CYL -2.00 AX 166\n<L>\nSPH - 0.25 CYL -1.75 AX 164\nPD 66mm"
    columns = "   SPH   CYL   AX\nR -0.25 -2.00 166\nL -0.25 -1.75 164\nPD 66"
    implicit = "SPH -0.25 CYL -2.00 AX 166\nSPH -0.25 CYL -1.75 AX 164\nPD 66mm"
    glued = "R SPH:-O.25 CYL:-2.OO AX:l66\nL 5PH:-0.25 CYI:-1.75 AXIS:164\nPD=66MM"
    for text in (sections, columns, implicit, glued):
        assert as_map(hrk8000a_ref.parse(text)) == want, text
    assert [v["l"] for v in hrk8000a_ref.parse(sections)] == list(MACHINES["hrk8000a_ref"].fields)


def test_keratometry_and_lensmeter_parsers():
    want = {"K1 (R)": "42.70", "K2 (R)": "43.30", "K1 (L)": "41.60", "K2 (L)": "43.50"}
    assert as_map(hrk8000a_ker.parse("R K1 42.70 D 165  K2 43.30 D 75\nL K1 41.60 D 170 K2 43.50 D 80")) == want
    assert as_map(hrk8000a_ker.parse("K1 R 42.70 L 41.60\nK2 R 43.30 L 43.50")) == want
    assert as_map(hrk8000a_ker.parse("<R>\nKl 42.7\nK2 43.3\n<L>\nK1 41.6\nK2 43.5")) == want
    lens = clm1_lensmeter.parse("R SPH -0.75 CYL -1.75 AXS 174\nL SPH -0.50 CYL -1.25 AX 163")
    assert as_map(lens) == {"SPH (R)": "-0.75", "CYL (R)": "-1.75", "AXS (R)": "174", "SPH (L)": "-0.50",
                            "CYL (L)": "-1.25", "AXS (L)": "163"}
    assert tbut_schirmer.parse("TBUT R 8s L 9s") == []


def test_positive_sign_kept():
    assert as_map(hrk8000a_ref.parse("R SPH +1.50 CYL -0.50 AX 90"))["SPH (R)"] == "+1.50"


# ---------------------------------------------------------------- sanity ranges

def test_validate_ranges():
    ok = validate.check
    assert ok("SPH (R)", "-0.25") and ok("SPH (L)", "+1.50") and not ok("SPH (R)", "-0.30") and not ok("SPH", "26")
    assert ok("CYL (R)", "-2.00") and not ok("CYL (R)", "-10.25")
    assert ok("AX (R)", "166") and ok("AXS (L)", "0") and not ok("AX (L)", "181") and not ok("AX (R)", "90.5")
    assert ok("PD", "66mm") and not ok("PD", "30mm")
    assert ok("IOP (R)", "13") and ok("CIOP (L)", "60") and not ok("IOP (R)", "4")
    assert ok("CCT (R)", "499") and not ok("CCT (L)", "1499")
    assert ok("K1 (R)", "42.70") and not ok("K2 (L)", "60.0")
    assert ok("TBUT (R)", "8s") and ok("Schimer (L)", "14mm")
    assert ok("SPH (R)", "abc") is False and ok("Unknown", "1") is None


def test_validate_flag_and_confidence():
    vals = [{"l": "SPH (R)", "v": "-0.25"}, {"l": "CYL (R)", "v": "-2.00"}, {"l": "AX (R)", "v": "999"}]
    flagged = validate.flag(vals)
    assert [v.get("ok", True) for v in flagged] == [True, True, False]
    assert "ok" not in flagged[0]
    assert validate.confidence(flagged, 7) == round(3 / 7 * 2 / 3, 2)
    assert validate.confidence([], 7) == 0.0
    assert validate.confidence(validate.flag(vals[:2]), 2) == 1.0


# ---------------------------------------------------------------- preprocessing

def test_preprocess_steps_and_deskew():
    im = render_printout("SPH -0.25 CYL -2.00 AX 166\nSPH -0.25 CYL -1.75 AX 164\nPD 66mm", canvas=(800, 500))
    rgb = np.asarray(im)
    gray = pp.to_gray(rgb)
    assert gray.ndim == 2
    big = pp.resize(gray)
    assert min(big.shape) >= 1200 or max(big.shape) / max(gray.shape) == pytest.approx(pp.MAX_UPSCALE)
    binary = pp.threshold(pp.denoise(big))
    assert set(np.unique(binary)) <= {0, 255}
    assert abs(pp.estimate_skew(binary)) < 0.5

    tilted = np.asarray(im.rotate(4, expand=False, fillcolor=(245, 242, 235), resample=Image.BICUBIC))
    tb = pp.threshold(pp.denoise(pp.resize(pp.to_gray(tilted))))
    assert pp.estimate_skew(tb) == pytest.approx(-4, abs=1.0)  # correction angle for a 4 deg CCW tilt
    assert abs(pp.estimate_skew(pp.deskew(tb))) < 1.0
    assert pp.estimate_skew(np.full((300, 300), 255, np.uint8)) == 0.0


def test_preprocess_from_file_honours_exif(tmp_path):
    im = render_printout("IOP R 13 L 12", canvas=(900, 400))
    path = tmp_path / "p.jpg"
    exif = Image.Exif()
    exif[0x0112] = 6  # orientation: rotate 90 CW on display
    im.save(path, exif=exif)
    out = pp.preprocess(path)
    assert out.shape[0] > out.shape[1]  # portrait after EXIF transpose
    assert set(np.unique(out)) <= {0, 255}


# ---------------------------------------------------------------- end-to-end with Tesseract

SYNTHETIC = {
    "hnt1p_tono": ("HNT-1P  TONO-PACHY\n2026/09/19 10:05\n      R     L\nIOP   13    12  mmHg\n"
                   "CIOP  15    15  mmHg\nCCT   499   508 um",
                   {"IOP (R)": "13", "IOP (L)": "12", "CIOP (R)": "15", "CIOP (L)": "15", "CCT (R)": "499",
                    "CCT (L)": "508"}),
    "hrk8000a_ref": ("HRK-8000A  REF\n<R>\n SPH   CYL   AX\n-0.25 -2.00 166\n<L>\n SPH   CYL   AX\n"
                     "-0.25 -1.75 164\nPD 66mm",
                     {"SPH (R)": "-0.25", "CYL (R)": "-2.00", "AX (R)": "166", "SPH (L)": "-0.25",
                      "CYL (L)": "-1.75", "AX (L)": "164", "PD": "66mm"}),
    "hrk8000a_ker": ("HRK-8000A  KER\n<R>\nK1 42.70 D 165\nK2 43.30 D  75\n<L>\nK1 41.60 D 170\nK2 43.50 D  80",
                     {"K1 (R)": "42.70", "K2 (R)": "43.30", "K1 (L)": "41.60", "K2 (L)": "43.50"}),
    "clm1_lensmeter": ("CLM-1 LENSMETER\nR SPH -0.75 CYL -1.75 AXS 174\nL SPH -0.50 CYL -1.25 AXS 163",
                       {"SPH (R)": "-0.75", "CYL (R)": "-1.75", "AXS (R)": "174", "SPH (L)": "-0.50",
                        "CYL (L)": "-1.25", "AXS (L)": "163"}),
    "ypc100k_ref": ("YPC-100K REF\nR  SPH -1.75  CYL -0.25  AX 60\nL  SPH -1.25  CYL -0.25  AX 45\nPD 65mm",
                    {"SPH (R)": "-1.75", "CYL (R)": "-0.25", "AX (R)": "60", "SPH (L)": "-1.25",
                     "CYL (L)": "-0.25", "AX (L)": "45", "PD": "65mm"}),
    "ypc100k_ker": ("YPC-100K KER\nK1  R 44.50  L 44.75\nK2  R 44.75  L 45.00",
                    {"K1 (R)": "44.50", "K2 (R)": "44.75", "K1 (L)": "44.75", "K2 (L)": "45.00"}),
}


@pytest.fixture(scope="module")
def tesseract():
    from app.ocr import tesseract_available

    if not tesseract_available():
        pytest.skip("Tesseract binary not reachable (set TESSERACT_CMD in .env or install tesseract-ocr)")


@pytest.mark.parametrize("key", list(SYNTHETIC))
def test_recognise_synthetic_printout(tesseract, key):
    from app.ocr.engine import recognise

    text, expected = SYNTHETIC[key]
    img = pp.preprocess_array(np.asarray(render_printout(text)))
    result = recognise(img, MACHINES[key])
    assert as_map(result.values) == expected, result.text
    assert result.confidence == 1.0
    assert all(v.get("ok", True) for v in result.values)


def test_recognise_tilted_noisy_printout(tesseract):
    from app.ocr.engine import recognise

    text, expected = SYNTHETIC["hrk8000a_ref"]
    img = pp.preprocess_array(np.asarray(render_printout(text, rotate=3.0, noise=0.03)))
    result = recognise(img, MACHINES["hrk8000a_ref"])
    got = as_map(result.values)
    hits = sum(1 for k, v in expected.items() if got.get(k) == v)
    assert hits >= 6, (got, result.text)  # 3 degree tilt + sensor noise: allow one miss


def test_recognise_blank_image_gives_nothing(tesseract):
    from app.ocr.engine import recognise

    blank = np.full((300, 400, 3), 245, np.uint8)
    result = recognise(pp.preprocess_array(blank), MACHINES["hnt1p_tono"])
    assert result.values == [] and result.confidence == 0.0
