A charge line and the total that closes the bill.

**When to use.** In the drawer at the Billing stage — the charges accrued during this visit, then `bill-total`, then the payment mode.

**What the consumer provides.** The line label, the amount, and the remove handler; plus the computed total. Real lines from this practice: `Consultation fee` ₹500, `Pre-test charges` ₹250.

**Anatomy.** Each `bill-item` is a `surface` row at `radius-md` with the label left and the amount right in `amount` (mono). `bill-total` is a `sapphire-wash` row at `radius-md`, 15px/600 in `sapphire-deep` with the sum in `amount` — heavier ground, heavier type, so it reads as the sum and not another line.

**Tabular numerals everywhere.** Amounts stack in a column and must align at the decimal. Both the item amount and the total carry `font-variant-numeric: tabular-nums`.

**Currency.** Write `₹500`, no space, no decimals for whole rupees. Use the symbol, not `INR`.

**Removal is destructive and quiet** — a `ink-faint` `×` that goes `alert-ink` on hover. Confirm before removing a line from a bill that has been shown to the patient.
