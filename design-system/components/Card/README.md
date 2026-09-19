The base panel: `surface` ground, `line` hairline, `radius-lg`, `shadow-sm`.

**When to use.** As the container for anything that is one object — a patient, an appointment, a reading. Everything else on a white ground is not a card: field groups, list rows and sections are separated by rules and spacing, not by borders and shadows.

**What the consumer provides.** The content, and `interactive` plus a handler when the whole card opens something.

**Elevation is nearly flat.** `shadow-sm` is `0 1px 2px` at 6% — the edge is doing the work, not the shadow. On hover an `interactive` card takes a `sapphire` border and `shadow-md`; selected takes a `sapphire` border and a 3px `sapphire-wash` ring instead of a heavier shadow.

**Not everything is a card.** The prototype's own drift is instructive: once cards were the default, sections that were really lists grew borders too, and the hierarchy flattened. If two adjacent things are both cards, ask whether one of them is a row.

**No left-border accents.** The only coloured edge bar in this system is `Toast`'s, where it is load-bearing. A card signals its state by its ground (`dilating`, `overdue`), not by a stripe.
