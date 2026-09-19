A dismissible alert in the top-right stack — in this product, almost always an overdue dilation.

**When to use.** When something crossed a threshold while nobody was looking at the screen: a drop ran over, a machine reading failed to parse. Not for confirmations — a successful save shows in the thing that was saved.

**What the consumer provides.** The title, one line of body naming the patient and the overage, and the dismiss handler. Stack them in a fixed top-right container with a 10px gap; on mobile the stack goes full-width with a 12px inset.

**Anatomy.** `surface` ground, `alert-line` hairline, a 4px `alert` left rule, `radius-lg`, `shadow-lg`. The title is set in the serif, which is what makes a toast read as a sentence someone is telling you rather than a system string. The left rule is the one place this system uses a coloured edge bar — it is load-bearing here (it is what makes the toast scannable in a stack), not decoration, and it does not appear on cards.

**Dismissal is explicit.** The `t-dismiss` button is `alert-wash` with `alert-ink`. Don't auto-dismiss an overdue alert: the patient is still waiting, and a toast that vanishes on its own has told nobody anything.

**Motion.** Slides in over 250ms from 20px right. Under `prefers-reduced-motion` it appears in place — the stylesheet handles this.

**Don't** stack more than three. Beyond that, collapse to one toast naming the count and point at the queue.
