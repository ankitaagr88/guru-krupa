A native `<select>` restyled to match the form — used for lists too long for `SegmentedToggle`.

**When to use.** Five or more closed options: *How did they hear about us?* (Self / Walk-in, another doctor, family or another patient, Online / Google, BNI, Insurance / TPA, Camp / Outreach), or the dilation drop to start.

**What the consumer provides.** The options, the value, the handler, and any follow-up field the choice reveals — picking *Referred by another doctor* reveals a name input directly beneath.

**Why native.** It is a real `<select>` with `appearance: none` and a `ink-soft` chevron drawn as a data-URI background. Keyboard, screen-reader and mobile pickers all come free, and on a phone the OS wheel beats any custom list.

**Styling notes.** `surface` fill (not `canvas` — it sits on `canvas` and needs to lift off it), `line` border, `radius-md`, and the value set in `button` weight so the current choice reads as strongly as a control label. Focus is the standard `focus`.

**Don't** hide the follow-up field's purpose behind a placeholder alone: label it `Referred by — name`, naming both the relationship and what to type.
