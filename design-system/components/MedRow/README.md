A prescribed medicine with its dosage, in two forms: matched to the formulary, or entered by hand.

**When to use.** In the drawer's prescription section, one row per medicine, above the manual add field.

**What the consumer provides.** The medicine name, whether it matched the formulary, the dosage text and its handler, and the remove handler.

**Two grounds, one meaning.** A matched medicine gets `sapphire-wash` with a `sapphire-deep` name and a `Matched` tag — the system recognised it and the spelling is trustworthy. `manual` gets a plain `canvas` ground with a `line` border and an `ink` name — a human typed it and nothing has checked it. That difference matters when the prescription is printed, so keep the two visually distinct.

**Dosage is free text and it is required.** `1 drop both eyes, twice daily` — the form the doctor dictates. Don't offer a structured dose builder; eye drops do not fit one, and the printed sheet needs the doctor's own words.

**Remove is a quiet `×`** at 50% opacity, top-aligned, going full opacity on hover. Prescribing is additive; removal should not compete with it.

**Don't** sort the rows. They print in the order the doctor said them, which carries priority.
