The single-line input and textarea: `canvas` fill, `line` border, `radius-md`.

**When to use.** Every free-text entry in the drawer and the modals — name, phone, address, occupation, doctor's notes.

**What the consumer provides.** The value and handler, a `placeholder` that names the field (the drawer labels many fields by placeholder alone), and a real `id` with a `<label>` wherever the layout has room for one.

**Placeholders are set in `ink-faint`.** It is 5.2:1 on `canvas` and 4.8:1 on `surface-sunk` — a placeholder that names the field must be readable, and in this drawer it often is the only name the field has. `line-strong` is for dashes and grips, never for words.

**Focus** is a 2px `focus` outline at 1px offset plus a `sapphire` border. The prototype had no focus style anywhere; this is an addition, and it is the one style that must survive into production — reception staff tab through this form all day.

**Grouping.** Two fields that belong together go in `detail-grid` (two equal columns, 8px gap) — age beside sex, occupation beside screen hours. `field-label` sits above a group, not above every input.

**Numbers** get `font-variant-numeric: tabular-nums` when they sit in a column, as in `ReadingCard`.
