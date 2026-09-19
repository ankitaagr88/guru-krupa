"""Accuracy harness on the clinic's REAL printout captures in tests/ocr_samples/ (ground truth in
GROUND_TRUTH.md, transcribed by hand). Runs the full pipeline (preprocess -> layout read ->
template parse -> sanity flags) once per image and reports per-sample field accuracy.

Skipped when Tesseract is not installed. Run `pytest tests/test_ocr_real.py -s` to see the table."""
from pathlib import Path

import pytest

from app.ocr import preprocess as pp

SAMPLES = Path(__file__).parent / "ocr_samples"

# image -> {machine_key: {label: expected}}; a REF/KER slip carries both sections.
GROUND_TRUTH: dict[str, dict[str, dict[str, str]]] = {
    "hrk8000a_ref_ker_01.png": {
        "hrk8000a_ref": {"SPH (R)": "+0.00", "CYL (R)": "-1.75", "AX (R)": "170", "SPH (L)": "+0.25",
                         "CYL (L)": "-2.00", "AX (L)": "161", "PD": "66mm"},
        "hrk8000a_ker": {"K1 (R)": "41.40", "K2 (R)": "43.85", "K1 (L)": "42.15", "K2 (L)": "44.65"},
    },
    "hrk8000a_ref_ker_02.png": {  # crumpled slip, slight tilt
        "hrk8000a_ref": {"SPH (R)": "-0.25", "CYL (R)": "-2.00", "AX (R)": "166", "SPH (L)": "-0.25",
                         "CYL (L)": "-1.75", "AX (L)": "164", "PD": "66mm"},
        "hrk8000a_ker": {"K1 (R)": "41.45", "K2 (R)": "43.95", "K1 (L)": "42.20", "K2 (L)": "44.40"},
    },
    "clm1_lensmeter_01.png": {  # handwritten strokes between the columns
        "clm1_lensmeter": {"SPH (R)": "-0.75", "CYL (R)": "-1.75", "AXS (R)": "174", "SPH (L)": "-0.50",
                           "CYL (L)": "-1.25", "AXS (L)": "163"},
    },
    "hnt1p_tono_01.png": {  # R has 2 IOP rows, L has 1; IOP/CIOP AVG rows print 0.0
        "hnt1p_tono": {"IOP (R)": "13", "IOP (L)": "12", "CIOP (R)": "15", "CIOP (L)": "15", "CCT (R)": "499",
                       "CCT (L)": "508"},
    },
    "hbm1_iol_report_01.png": {  # A4 laser print, OD left / OS right, phone shadow at the bottom
        "hbm1_biometry": {"AL (R)": "22.90", "AL (L)": "22.80", "ACD (R)": "2.70", "ACD (L)": "2.77",
                          "K1 (R)": "43.27", "K1 (L)": "43.34", "K2 (R)": "43.48", "K2 (L)": "43.93",
                          "Axis (R)": "65", "Axis (L)": "166", "Target (R)": "0.00", "Target (L)": "0.00"},
    },
    "hbm1_biometry_report_01.png": {  # OD block above OS; no Target on this report
        "hbm1_biometry": {"AL (R)": "22.90", "AL (L)": "22.80", "ACD (R)": "2.70", "ACD (L)": "2.77",
                          "K1 (R)": "43.27", "K1 (L)": "43.34", "K2 (R)": "43.48", "K2 (L)": "43.93",
                          "Axis (R)": "65", "Axis (L)": "166"},
    },
}
LOWER_FLOOR = ("hrk8000a_ref_ker_01.png", "hrk8000a_ref_ker_02.png", "clm1_lensmeter_01.png", "hnt1p_tono_01.png")
# Minimum fields that must match per (image, machine); the lower-floor slips must be perfect.
REQUIRED = {("hbm1_biometry_report_01.png", "hbm1_biometry"): 9}  # ACD (L) sits in the phone shadow


@pytest.fixture(scope="module")
def tesseract():
    from app.ocr import tesseract_available

    if not tesseract_available():
        pytest.skip("Tesseract binary not reachable (set TESSERACT_CMD in .env or install tesseract-ocr)")


@pytest.fixture(scope="module")
def results(tesseract) -> dict[tuple[str, str], tuple[dict[str, str], float]]:
    """Run every sample once; {(image, machine): ({label: value}, confidence)}."""
    from app.ocr.engine import recognise
    from app.ocr.layout import read_page
    from app.ocr.templates import MACHINES

    out = {}
    for image, machines in GROUND_TRUTH.items():
        binary = pp.preprocess(SAMPLES / image)
        page = None
        for key in machines:
            machine = MACHINES[key]
            if page is None or machine.passes:
                page = read_page(binary, passes=machine.passes) if machine.passes else read_page(binary)
            result = recognise(binary, machine, page=page)
            out[(image, key)] = ({v["l"]: v["v"] for v in result.values if v.get("ok", True)}, result.confidence)
    return out


def accuracy_table(results) -> str:
    lines = [f"{'sample':30} {'machine':15} {'fields':>7}  {'conf':>5}  misses"]
    for (image, key), (got, conf) in results.items():
        expected = GROUND_TRUTH[image][key]
        misses = [f"{label}: got {got.get(label)!r} want {want!r}" for label, want in expected.items()
                  if got.get(label) != want]
        hits = len(expected) - len(misses)
        lines.append(f"{image:30} {key:15} {hits:>3}/{len(expected):<3}  {conf:5.2f}  {'; '.join(misses)}")
    return "\n".join(lines)


def test_print_accuracy_table(results):
    print("\n" + accuracy_table(results))


@pytest.mark.parametrize("image,key", [(img, key) for img, machines in GROUND_TRUTH.items() for key in machines])
def test_real_sample(results, image, key):
    got, conf = results[(image, key)]
    expected = GROUND_TRUTH[image][key]
    hits = sum(1 for label, want in expected.items() if got.get(label) == want)
    required = REQUIRED.get((image, key), len(expected))
    assert hits >= required, f"{image} {key}: {hits}/{len(expected)}\n{accuracy_table(results)}"
    if image in LOWER_FLOOR:
        assert got == expected, accuracy_table(results)
        assert conf == 1.0


def test_hrk_slip_yields_twin_section(tesseract):
    """One HRK photo parses both REF and KER: the REF template's twin values are the KER fields."""
    from app.ocr.engine import recognise
    from app.ocr.templates import MACHINES

    result = recognise(pp.preprocess(SAMPLES / "hrk8000a_ref_ker_01.png"), MACHINES["hrk8000a_ref"])
    assert {v["l"]: v["v"] for v in result.twin_values} == GROUND_TRUTH["hrk8000a_ref_ker_01.png"]["hrk8000a_ker"]
    assert result.twin_confidence == 1.0


def test_debug_cli_runs(tesseract, capsys):
    from app.ocr.debug import main

    assert main([str(SAMPLES / "hnt1p_tono_01.png"), "hnt1p_tono"]) == 0
    out = capsys.readouterr().out
    assert "IOP (R)" in out and "parsed values" in out and "layout pass" in out
