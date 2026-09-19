An editable, reorderable row in a configuration list — a queue stage or a dilation protocol step.

**When to use.** In Admin, for lists the hospital owns: the stages of the patient journey, the drops in the dilation protocol, the referral sources.

**What the consumer provides.** The row value, its order index, the rename handler, the reorder handlers, and delete. The name is an inline `<input>` with no visible border — edit in place, no separate edit mode.

**Anatomy.** `surface` row, `line` border, `radius-md`. A `grip` on the left for drag; `step-order` for a numbered step; the name input flexing; an optional `mins` group; a `ink-faint` delete that goes `alert-ink` on hover.

**Keyboard reordering is not optional.** Drag is the fast path, but ship the up/down buttons too — they are the only path for keyboard and touch-assistive users, and the prototype already has them.

**Guard the list.** Deleting a stage moves its patients to the first stage; keep a minimum of two stages and say why when the delete is refused. Never let a configuration change silently orphan a patient.

**Minutes are minutes.** The protocol's duration field is a plain number with `min` beside it — no unit dropdown; every drop in this practice is timed in whole minutes.
