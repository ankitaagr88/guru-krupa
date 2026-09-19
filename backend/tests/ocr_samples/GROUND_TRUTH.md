# Ground truth for the real printout samples (read by hand from the scans)

Rendered at 200 dpi from the clinic's reference PDFs (2026-09-19). Handwriting on the slips is doctor annotation, not machine output.

## hrk8000a_ref_ker_01.png — HUVITZ HRK-8000A, No. 3346
Layout: `[REF]` then `<R>` block with several SPH/CYL/AX rows, `AVG` row, `S.E` row; same for `<L>`; then `[KER]` with `<R>`: `R1`/`R2` rows in columns `mm | D | AX`, `AVG` row, `CYL` row; same `<L>`; `PD = 66mm`.
REF (take AVG row):  SPH (R) +0.00, CYL (R) -1.75, AX (R) 170, SPH (L) +0.25, CYL (L) -2.00, AX (L) 161, PD 66mm
KER (D column):      K1 (R) 41.40, K2 (R) 43.85, K1 (L) 42.15, K2 (L) 44.65   (R1/R2 mm: 8.15/7.70, 8.01/7.56; axes 174/84, 170/80)

## hrk8000a_ref_ker_02.png — HRK-8000A, No. 3345 (crumpled slip, slight tilt)
REF: SPH (R) -0.25, CYL (R) -2.00, AX (R) 166, SPH (L) -0.25, CYL (L) -1.75, AX (L) 164, PD 66mm
KER: K1 (R) 41.45, K2 (R) 43.95, K1 (L) 42.20, K2 (L) 44.40

## clm1_lensmeter_01.png — CLM-1 lensmeter (current glasses)
Layout: header `NAME / NO. / DATE / NORMAL LENS / R-PD L-PD / PD`, then columns `<RIGHT> <LEFT>` with rows `SPH : v v`, `CYL : v v`, `AXS : v° v°`, footer `CLM-1 / GURU KRUPA DR ANU / 7574998502`.
SPH (R) -0.75, CYL (R) -1.75, AXS (R) 174, SPH (L) -0.50, CYL (L) -1.25, AXS (L) 163

## hnt1p_tono_01.png — HUVITZ HNT-1P `[TONO-PACHY Mode]`
Layout: `IOP  <R> <L>` then rows of starred readings (R has 2, L has 1), `AVG 0.0 0.0 (mmHg)` — the IOP/CIOP AVG rows print 0.0 and must be ignored; `CIOP` same; `CCT <R> <L>` with 1 value R and 4 values L, `AVG 499.0 508.0 (µm)` is valid.
IOP (R) 13, IOP (L) 12, CIOP (R) 15, CIOP (L) 15, CCT (R) 499, CCT (L) 508

## hbm1_iol_report_01.png — HUVITZ HBM-1 optical biometer, IOL REPORT (upper floor, OT pre-op)
Layout: OD left / OS right. `Data Measurements`: AL, ACD, LT, K1, K2, CYL, Axis, K Avg, Target, WTW, Kappa. Then IOL formula boxes.
OD: AL 22.90 mm, ACD 2.70 mm, K1 43.27 D, K2 43.48 D, Axis 65°, Target 0.00 D    OS: AL 22.80 mm, ACD 2.77 mm, K1 43.34 D, K2 43.93 D, Axis 166°, Target 0.00 D
(Maps to OtCase.preOpBiometry: AL/ACD/K1/K2/targetRefraction × R/L; mockup sample values for Rujavana Madhani came from this report.)

## hbm1_biometry_report_01.png — HBM-1 BIOMETRY REPORT (same patient, tabular Data Measurements per eye)
OD: AL 22.90, ACD 2.70, LT 4.60, K1 43.27, CYL -0.21D, AL 22.90, CCT 0.52, K2 43.48, Axis 65, WTW 12.07
OS: AL 22.80, ACD 2.77, LT 4.51, K1 43.34, CYL -0.59D, CCT 0.52, K2 43.93, Axis 166, WTW 12.13

## hbm1_topography_01.png — topography report (image-heavy; Measurement Summary block is OCR-able but not a target yet)
## case_sheet_handwritten.png — the clinic's paper case sheet (V/A, Auto Ref, ST table, NCT, PACHY, SAC, MGD, TBUT, Schirmer...). Not an OCR target; reference for the UI's exam fields.

No YPC-100K samples yet.
