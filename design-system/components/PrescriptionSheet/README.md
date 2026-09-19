The printable prescription — the one artefact in this product that leaves the building.

**When to use.** At the end of a consultation, as a modal the doctor reviews and prints. It is the only surface designed for paper, and the only place `rx-title` — the serif at 700, the heaviest weight in the system — appears.

**What the consumer provides.** The hospital's name and line of address, the patient's name and token, the date, and the medicine list with dosages. An empty list renders `rx-empty` — *No medicines prescribed* — rather than a bare sheet.

**Anatomy.** 420px, centred head with a 2px `sapphire-ink` rule beneath the hospital name, a patient line spread left-to-right, then medicines separated by dashed `line` rules. Each medicine is `rx-name` (serif 600) over `rx-dose` in `ink-soft`.

**Printing.** The print stylesheet hides everything but this sheet and drops the footer buttons. Test it on A5 — that is what the practice prints on.

**Name the hospital exactly as the letterhead does.** The prototype's header says *Gurukrupa Eye Hospital & Research Center*; the supplied logo says *GURU KRUPA EYE HOSPITAL & LASER CENTER*. These disagree, and this sheet is where it matters — settle it before anything is printed. See *The name* in the brand book.

**Don't** put the queue token on the patient's copy as an identifier. It is a today-only number and means nothing tomorrow; the printed copy needs the name and date.
