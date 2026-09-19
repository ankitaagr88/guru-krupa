"""Inspect the OCR pipeline on one photo, for tuning at the clinic:

    python -m app.ocr.debug <image> <machine_key> [--rows] [--save-tile out.png]

Prints the raw Tesseract text (the layout pass row by row, then the plain whole-page passes),
the parsed values with sanity flags, the twin section (REF <-> KER) and the confidence.
`--rows` also dumps every word with its x-position and alternative readings; `--save-tile`
writes the straightened row tile that Tesseract actually saw.
"""
from __future__ import annotations

import argparse
import sys
import time

import cv2

from app.ocr import tesseract_available
from app.ocr.engine import FALLBACK_CONFIG, image_to_text, recognise
from app.ocr.layout import PASSES, read_page, render_tile, segment
from app.ocr.preprocess import preprocess
from app.ocr.templates import MACHINES


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image")
    ap.add_argument("machine_key", choices=sorted(MACHINES))
    ap.add_argument("--rows", action="store_true", help="dump words with x-positions and alternative readings")
    ap.add_argument("--save-tile", metavar="PNG", help="write the straightened row tile image")
    ap.add_argument("--save-binary", metavar="PNG", help="write the preprocessed (binarised, deskewed) image")
    args = ap.parse_args(argv)

    if not tesseract_available():
        print("Tesseract not reachable: set TESSERACT_CMD in .env (e.g. C:\\FPI\\tesseract\\tesseract.exe)")
        return 2
    machine = MACHINES[args.machine_key]
    t0 = time.time()
    img = preprocess(args.image)
    if args.save_binary:
        cv2.imwrite(args.save_binary, img)
    page = read_page(img, passes=machine.passes or PASSES)
    t_page = time.time() - t0
    print(f"== {args.image}  [{machine.key}: {machine.label}]  binary {img.shape[1]}x{img.shape[0]}px, "
          f"glyph height {page.char_h:.0f}px, layout pass {t_page:.1f}s")

    print("\n-- layout pass (row by row; [alt readings] where the scales disagree)")
    for row in page.rows:
        if not row.words:
            continue
        if args.rows:
            words = "  ".join(f"{w.text}@{w.x0}" + (f"{w.alts}" if any(a != w.text for a in w.alts) else "")
                              for w in row.words)
        else:
            words = row.text
        print(f"  y={int(row.y):5}  {words}")
    if args.save_tile:
        wlab, rows, ch = segment(img)
        tile, _ = render_tile(img, wlab, rows, ch)
        cv2.imwrite(args.save_tile, tile)
        print(f"  (tile written to {args.save_tile})")

    print(f"\n-- plain Tesseract text ({machine.tess_config})")
    print(image_to_text(img, machine.tess_config).rstrip())
    print(f"\n-- plain Tesseract text ({FALLBACK_CONFIG})")
    print(image_to_text(img, FALLBACK_CONFIG).rstrip())

    result = recognise(img, machine, page=page)
    print(f"\n-- parsed values (confidence {result.confidence:.2f}, total {time.time() - t0:.1f}s)")
    for v in result.values:
        print(f"  {v['l']:12} {v['v']:>8}" + ("   <-- outside sanity range" if v.get("ok") is False else ""))
    missing = [f for f in machine.fields if f not in {v["l"] for v in result.values}]
    if missing:
        print("  missing: " + ", ".join(missing))
    if machine.twin_key:
        print(f"\n-- twin section [{machine.twin_key}] (confidence {result.twin_confidence:.2f})")
        for v in result.twin_values:
            print(f"  {v['l']:12} {v['v']:>8}" + ("   <-- outside sanity range" if v.get("ok") is False else ""))
        if not result.twin_values:
            print("  (nothing readable)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
