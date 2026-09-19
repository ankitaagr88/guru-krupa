A day in the appointment date strip: weekday above, date number below.

**When to use.** As a horizontally scrolling strip at the top of the Appointments view, showing roughly a fortnight from today.

**What the consumer provides.** The dates, which is selected, and the handler. Mark today distinctly from the selected day — they are often, but not always, the same.

**Anatomy.** 66px minimum width, `radius-lg`, `surface` ground. `dow` is 11px/600 `ink-soft`; `dnum` is the `time` style at 18px — mono, because it is a date. Selected flips the whole pill to a `sapphire` fill with `on-sapphire` text — the strongest selected state in the system, because it governs everything below it.

**It scrolls.** `overflow-x: auto`, no wrapping. Dates are a line, and a wrapped date strip stops reading as one.

**Don't** disable past dates. Reception looks backwards to find someone who did not turn up.
