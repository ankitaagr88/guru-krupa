The desktop queue: one row per patient in the selected stage, sorted by how long they have waited.

**When to use.** On desktop, below `StageStrip`. Below 900px it is replaced wholesale by a `PatientCard` list — not by a squeezed table.

**Columns.** Token, Name, Age/Sex, Phone, Waiting, Status. Token is `td-token` (mono, `ink-faint`); Name is `td-name` (serif 600, `ink`) — a person's name is set in the serif throughout this system; Waiting is `td-num` (mono); the rest is `body`. Status holds one or more `StatusPill`s in a `status-cell`, which wraps.

**What the consumer provides.** The rows and a row handler — clicking anywhere opens that patient's `Drawer`. Give each `<tr>` a `tabindex` and an Enter handler, or wrap the name in a button: a table whose only affordance is a click is unreachable by keyboard.

**Hover and selection share `sapphire-wash`.** That is deliberate — the row you are pointing at and the row whose drawer is open should look alike, because they usually are the same row. Selected rows additionally carry `row-selected` so the state survives the pointer leaving.

**Empty stages** use a full-width `EmptySlot` cell rather than a blank table. Never render a table with a zero-row body.

**Waiting times** are the column staff actually scan. Set them in tabular numerals and keep the column right of Phone, where the eye lands after the identifying details.
