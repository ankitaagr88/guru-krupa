The mobile primary navigation: up to five destinations fixed to the bottom of the viewport, on `nav-surface`.

The prototype gave mobile a hamburger only — every destination was two taps away, behind a button in the top-left corner, which is the hardest place to reach one-handed on a phone. This puts the four destinations reception actually uses all day inside the thumb arc, and leaves the hamburger for the long tail.

**When to use.** Below 900px, as the app shell's last child. Pair it with `TopBar`'s `nav-trigger` for everything that doesn't fit here — on this app that is Machines, Stock and Admin.

**What the consumer provides.** Four or five items (icon, short label, optional badge count), the active key, and the handler. Never more than five: at six the labels start truncating on a 360px screen.

**Labels stay on.** Icon-only tabs are a guessing game for a receptionist who uses this between patients; the 12px/500 label costs 16px of height and removes the guess. Keep labels to one word — `Queue`, `Appts`, `OT`, `More`.

**Active state**, as in `SideNav`, is three signals at once: `nav-active`, the label in `nav-ink`, and a `gold-bright` bar — here across the top of the tab rather than its left edge.

**Safe area.** The component already adds `env(safe-area-inset-bottom)` to its own padding. Give the scrolling content above it matching bottom padding so the last row clears the bar.

**Badges** (`bottomnav-badge`) carry a count in `gold`/`on-gold`. Cap the displayed number at 99 and never use the badge as the only signal that something needs attention — a waiting patient who is overdue also turns their card `alert`.
