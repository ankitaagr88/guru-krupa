The mobile form of a queue row: name and token on top, labelled value rows beneath, status along the bottom.

**When to use.** Below 900px, in place of `QueueTable`. Also on any narrow panel where a patient needs summarising.

**What the consumer provides.** Name, token, the value rows that matter for the current stage, the status pills, and the tap handler. Render the card as a `<button>` or give it a role and key handling — it opens the `Drawer`.

**States carry the clinical situation.** `dilating` takes `gold-wash` with `gold-line`; `overdue` takes `alert-wash` with `alert-line` and a 1.8s pulse. These are the same two states `TimerRing` shows, and they must change together — a card that says nothing while its ring is red is the failure mode this pairing exists to prevent.

**Anatomy.** `pc-top` holds the name (`card-title`, serif 17px) and the mono token chip; `pc-row` pairs a `pc-label` (`ink-faint`, 11px) with a right-aligned `pc-val`; `pc-status` is a top-ruled row of `StatusPill`s. Rows are separated by a `canvas` hairline, not `line` — inside a card the softer rule is enough.

**Pick three or four rows, not everything.** The drawer holds the full record; the card holds what decides whether you tap it. At Registration that is age/sex, phone and waiting time; mid-dilation it is the drop and the time left.

**Token chips** sit on `surface` so they stay visible when the card's own ground turns amber or coral.
