A centred dialog over a `scrim-strong` overlay — new patient, patient search.

**When to use.** For a short task that must finish or be abandoned before anything else happens. Registering a walk-in is the archetype. Anything longer than about eight fields belongs in the `Drawer`.

**What the consumer provides.** The heading, an optional sub-line, the fields, and the two footer actions.

**Anatomy.** 400px wide (440px for the longer entry form), `radius-xl`, 28px padding, `surface`. The heading is `modal-title` (serif, 18px); the sub-line is `meta`. The footer is a `modal-actions` row: `btn-ghost` then `btn-primary full`, cancel on the left.

**Scrim order.** `scrim-strong` (0.4) sits above the drawer's `scrim` (0.35), because a modal can open on top of an open drawer. Don't reuse the lighter value here.

**Long forms scroll inside.** Cap the scrolling region at about 62vh with a thin `line` scrollbar so the footer actions stay on screen — a save button below the fold is a save button nobody finds.

**Focus and Escape.** Focus moves to the first field on open, is trapped while open, and returns to the trigger on close. Escape cancels. Clicking the scrim cancels only when nothing has been typed.
