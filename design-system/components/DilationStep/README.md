One drop in the dilation protocol, with its state: done, running, or pending.

**When to use.** In the drawer, as an ordered list for a patient at the Dilating stage. The protocol itself (drop names and minutes) is configured in Admin, so render whatever the list holds — the default is Tropicamide 0.8% at 5 minutes, then Cyclopentolate 1% at 20.

**What the consumer provides.** The step name, its duration, its state, and — for a tickable step — the handler that marks the drop as given.

**States.**
- `done` — 65% opacity, a `done-ink` check. Faded, because it is history.
- `active` — `gold-wash` ground, `gold-line`, an `gold-deep` marker, and a `dstep-tag timer` counting down. Pair it with a `TimerRing`.
- `pending` — plain `canvas` and `line`, a `ink-faint` marker, and a `dstep-tag next` naming the wait.

**The running tag uses `on-gold`, not white.** The prototype set white on its amber (2.2:1); white on this system's `gold` is 3.4:1. `on-gold` is `ink` at 4.7:1 — same fill, readable digits.

**Order is clinical, not cosmetic.** Steps run in sequence and a later drop cannot be ticked before an earlier one. Show the whole protocol at once, including steps not yet reached, so staff can see what is still coming.

**When every step is done,** replace the list with `dstep-complete` — a `done-wash` banner saying the patient is ready for the doctor. Don't leave a list of six faded rows as the end state.
