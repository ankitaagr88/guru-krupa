A 40px square utility action carrying an icon and no label — search, print, close.

**When to use.** For a recognised utility that sits beside a labelled primary action, where a second word would compete with it. If the icon needs explaining, it is a `Button`.

**What the consumer provides.** The icon (a 24-viewBox stroke SVG at `stroke-width: 2`, rendered at 19px), the handler, and **an `aria-label` — always**. An icon button with no accessible name is invisible to a screen reader and unguessable to everyone else.

**Styling.** `canvas` fill, `line` border, `ink-soft` icon at rest; on hover the border goes `sapphire` and the icon `sapphire-deep`. The border is what makes it read as pressable on a white topbar — don't remove it.

**Icon set.** The product draws from Feather-style 24×24 outline icons at `stroke-width: 2`, `fill: none`, `stroke: currentColor`. Keep to that so a row of them shares one weight.

**Don't** use it for a destructive action without a confirmation step; a 40px target next to a patient record is easy to hit by accident.
