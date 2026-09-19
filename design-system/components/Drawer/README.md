The right-hand panel holding one patient's whole record — the app's primary working surface.

**When to use.** Whenever a patient is opened from the queue. Everything clinical happens here: details, conditions, readings, dilation, tests, prescription, billing, and the buttons that move them to the next stage.

**What the consumer provides.** The patient, the section content for their current stage, and the close handler. Sections are ordered by the visit, not by data model — what happens first appears first.

**Anatomy.** 380px wide on desktop, sliding from the right over a `scrim` at 250ms; full width on mobile. `drawer-head` carries the name (`drawer-title`, serif 20px) and a mono meta line of token · age/sex · stage; `drawer-body` scrolls; `drawer-foot` holds a `stamp` footnote.

**Section labels, not section cards.** `field-label` in `ink-soft` separates the groups. The drawer is already a surface — putting cards inside it produces the nesting that flattens the hierarchy.

**Focus management.** Opening moves focus to the close button; closing returns it to the row that opened it; Escape closes; focus is trapped while open. The prototype does none of this, and on a keyboard the drawer is currently a dead end.

**On mobile** it is full-width and behaves as a page. Keep the close control in the same corner as on desktop so the gesture is learned once.
