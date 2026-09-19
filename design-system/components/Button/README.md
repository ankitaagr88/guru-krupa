The text action, in two weights: `btn-primary` (filled `sapphire`) and `btn-ghost` (quiet, on `canvas`).

**When to use.** One `btn-primary` per screen or per surface — `+ New patient` in the header, `Save` in a modal, `Add` beside the medicine search. Everything that cancels, dismisses or steps back is `btn-ghost`.

**What the consumer provides.** The label, the handler, and `full` when the button should share a modal footer row equally with its ghost sibling.

**Labels say what happens.** `Check in`, `Add medicine`, `Print prescription` — a verb and its object. Not `Submit`, not `OK`. The toast or state that follows uses the past tense of the same verb.

**Sizes.** Default is `button` (14px/600) at 11px 20px. `sm` (13px at 9px 14px) is for a button sharing a row with a field, and is what `TopBar` uses on mobile.

**Contrast.** `on-sapphire` on `sapphire` is 7.7:1; the hover `sapphire-deep` is 11.4:1. Never put a button's label in `gold` on white — that pair is 3.4:1.

**Don't** stack two primaries. If two actions feel equally important, one of them is really the ghost.
