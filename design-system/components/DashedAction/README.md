A full-width dashed button that adds something to a list, or opens the camera.

**When to use.** At the end of an editable list — add a stage, add a protocol step, add a bill line — and as the phone's `Capture with camera` affordance in the drawer. The dashed edge reads as "there is room here for one more", which a solid button does not.

**What the consumer provides.** The label (a verb plus what gets added), an optional leading icon, and the handler.

**Styling.** 1.5px dashed `line-strong` border, transparent fill, `ink-soft` label; on hover the border goes `sapphire` and the label `sapphire-deep`. It sits directly on whatever ground the list uses — don't give it a fill.

**Pairs with `EmptySlot`,** which uses the same dashed language for a stage with nobody in it. Together they mean the same thing: space that is meant to be filled.

**Don't** use it for the screen's main action — dashed reads as secondary, and `+ New patient` must not.
