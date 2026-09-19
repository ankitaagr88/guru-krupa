A binary setting that takes effect immediately, shown as a labelled row with a 42×24 track.

**When to use.** For a preference that applies the moment it is flipped — *Patient brought earlier records*, *Send WhatsApp reminder*. If the change only lands when a form is saved, use a checkbox (`ConditionChip`) instead.

**What the consumer provides.** The label, the state and the handler. Render the track as `<button role="switch" aria-checked>` so the state is announced; the whole `toggle-row` is the hit target, not just the 42px track.

**Anatomy.** `toggle-row` gives the label and the track a `canvas` ground, 11px 13px padding and `radius-md`. Off is a `line` track; on is `sapphire`. The knob is white with `shadow-knob` — the only place that shadow is used.

**Revealing more.** Turning a switch on may reveal a field directly beneath it (the earlier-records switch reveals a notes box). Put the revealed content inside the same block, immediately below, so the cause is adjacent to the effect.

**Don't** use a switch for anything destructive, and don't label it with a question — `Patient brought earlier records`, not `Did the patient bring records?`.
