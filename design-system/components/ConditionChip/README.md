A checkbox in a chip, laid out two to a row — the existing-conditions grid.

**When to use.** For a known, closed list the person scans and ticks several of: Diabetes, Hypertension, Asthma, Arthritis, Thyroid disorder, Heart disease / stroke history, Allergy, Acidity / GERD, BPH. An `Other` free-text field follows the grid.

**What the consumer provides.** The condition list, the checked set, and the handler. The `<label>` wraps the `<input type="checkbox">` so the whole chip is the target — 10px 12px of padding makes it comfortably tappable without a separate hit area.

**Checked state** swaps the ground to `sapphire-wash` and the border to `sapphire`, alongside the native checkmark (`accent-color: teal`). The checkbox itself is the primary signal; the ground is reinforcement.

**Two columns, always.** `condition-grid` is `1fr 1fr` with an 8px gap. A one-column list of nine conditions is a scroll; three columns truncate `Heart disease / stroke history`, the longest label in the set.

**Don't** reorder the list between visits. Reception ticks these from muscle memory, and a stable order is worth more than alphabetising.
