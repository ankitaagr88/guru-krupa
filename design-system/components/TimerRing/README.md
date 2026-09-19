A 52px countdown ring for a dilation drop — the product's one piece of live, ticking UI.

**When to use.** On a patient who is mid-dilation: in the drawer beside the running protocol step, and on their queue card. One ring per patient, showing the *current* drop only.

**What the consumer provides.** Minutes remaining and the step's total minutes. Compute `stroke-dashoffset` from the fraction remaining against a circumference of `2πr`; the `fg` stroke carries a 1s linear transition so it moves smoothly without animating every frame.

**States.** Running is an `gold` arc on an `gold-wash` track with `sapphire-deep` numerals. Add `overdue` and the arc goes `alert` and the numerals `alert-ink` — and the patient's card takes `alert-wash` at the same moment, so the state is visible from across the room, not only inside the ring.

**The number is the fallback.** The arc is a ratio nobody reads precisely; the minutes in the middle are what staff act on. Keep them at 13px in mono and never drop them for a bare ring.

**Motion.** The overdue card pulses at 1.8s. Honour `prefers-reduced-motion` — the stylesheet already does. The ring's own arc transition is fine to keep either way; it is state, not decoration.

**Don't** show a ring for a step that has not started. A pending step gets a plain `dstep-tag` with its duration.
