The dashed placeholder shown where a stage has nobody in it.

**When to use.** As the single full-width cell of a `QueueTable` with no rows, or in place of a `PatientCard` list. An empty stage is a fact about the clinic, not an error — say it plainly.

**What the consumer provides.** One sentence naming the stage: `Nobody is waiting for billing.` Not `No results`, not `Empty`.

**Styling.** 1.5px dashed `line`, `radius-lg`, 40px of vertical room, text in `ink-faint` at `body`. The dashed edge matches `DashedAction` — both mean space waiting to be filled.

**Don't** add an illustration or a call to action. Reception cannot conjure a patient, and the empty stage will fill on its own.
