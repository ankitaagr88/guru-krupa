The queue's stage filter: one pill per stage of the patient journey, each carrying its live count.

This is secondary navigation — it moves you along the six stages of a visit (Registration, Pre-testing, With Doctor, Dilating, Billing, Done) without leaving the queue. It sits directly above the queue, not in `TopBar`, because it filters what is underneath it.

**When to use.** Above `QueueTable` or `PatientCard` lists. The stage set is configurable in Admin, so never hardcode six.

**What the consumer provides.** The stages in journey order, each with a label and count, the active key, and the handler. Counts are live and drop to `0` rather than disappearing — a stage with nobody in it is information.

**It scrolls, it does not wrap.** `overflow-x: auto` on one line keeps the journey readable as a sequence at any width. A wrapped second row breaks the left-to-right reading of the patient's path through the hospital.

**Active state** gives the pill a `sapphire-wash` ground, a `sapphire` border, 600 weight and a `sapphire` count chip — four signals, none of them colour alone. The `done` stage takes `done-ink` when active, the one stage whose colour means something.

**Don't** use these pills as actions. Tapping a stage filters the list; moving a patient between stages happens in the drawer, where the clinical steps are.
