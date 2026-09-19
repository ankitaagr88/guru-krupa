A set of values captured from one diagnostic machine, with its source stamp and editable fields.

**When to use.** In the drawer, under Pre-testing, one card per machine that has reported. Real machines in this product: `HRK-8000A — Refraction (REF)` and `HNT-1P — Tono-Pachy (IOP & CCT)`.

**What the consumer provides.** The machine's full name, the source stamp (`scanned, 11:42 AM` or `entered by hand`), and the value pairs. Each value is a label and a short editable input — readings are scanned by camera and often need a correction.

**Anatomy.** `surface` ground, `line` border, `radius-md`. The head pairs the machine name (`body-strong`) with its provenance in `stamp` — mono, `ink-faint`. Values wrap in an 8px-gap row, each a label plus a `reading` input on a `surface-sunk` chip 56px wide.

**Real value labels.** Refraction: `SPH (R)`, `CYL (R)`, `AX (R)`, `SPH (L)`, `CYL (L)`, `AX (L)`, `PD`. Tono-Pachy: `IOP (R)`, `IOP (L)`, `CIOP (R)`, `CIOP (L)`, `CCT (R)`, `CCT (L)`. Right eye before left, always — that is the order the machines print and the order clinicians read.

**Tabular numerals, always.** These values are compared down a column across visits; proportional digits make `-1.00` and `-0.50` misalign.

**Always show the source.** A scanned value and a typed one carry different confidence, and the stamp is how a doctor tells them apart.
