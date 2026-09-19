A rounded chip naming where a patient is or what just happened to them.

**When to use.** In the queue's Status column, on a `PatientCard`'s status row, and in the drawer's meta line. Several may sit together — `Dilating`, `Drop 2 running`, `Records from elsewhere`.

**What the consumer provides.** The text and the variant. The variant is derived from state, never chosen for looks.

| Variant | Means | Ink on ground | Ratio |
| --- | --- | --- | --- |
| *(none)* | neutral, in progress | `ink-soft` on `surface-sunk` | 5.9:1 |
| `info` | informational, no action | `sapphire-deep` on `sapphire-wash` | 9.6:1 |
| `gold` | a clock is running | `gold-deep` on `gold-wash` | 5.4:1 |
| `alert` | overdue, needs attention | `alert-ink` on `alert-wash` | 6.4:1 |
| `done` | done, confirmed | `done-ink` on `done-wash` | 7.0:1 |

**The word carries the meaning, and the hue backs it up.** `done` is a cyan-teal at hue 182°, not a green — deliberately off the red–green axis, so it stays separable from `alert` (hue 8°) for a reader with deuteranopia or protanopia. That is the safety net. The rule on top of it: **every pill is labelled**. A pill with a colour and no word is a bug. The optional `dot` is reinforcement, never a substitute.

**Why not lightness separation too?** Both inks have to be dark enough to read on their own pale wash, which puts them within about 1.1:1 of each other — the two constraints cannot both be satisfied with this pair. The hue route is the one the system takes, and it is why `done` is cyan rather than the prototype's green.

**Keep them short** — two or three words. A pill is a glance, not a sentence; anything longer belongs in the drawer.
