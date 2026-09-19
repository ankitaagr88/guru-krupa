# Navigation

## What was wrong

The prototype had a fixed 76px icon rail on desktop and, on mobile, a hamburger in the top-left corner.

1. **The labels were unreadable.** Rail items at 9px, section headings at 8px. Nothing in this system goes below 11px, and 11px is reserved for machine stamps.
2. **`Machines` and `MRs` are not guessable from an icon.** A camera glyph and a stethoscope glyph at 20px do not distinguish "diagnostic devices" from "medical representative visits", and a 9px label was not doing the work.
3. **Mobile put every destination two taps away**, behind a control in the hardest corner to reach one-handed. Reception uses this standing up.
4. **The rail ink was `#b9cfc5`** — a green-grey left over from an earlier palette, on a navy ground.
5. **No focus states**, so the navigation could not be operated from a keyboard at all.

## What replaced it

**`SideNav`** — 244px, labelled, on `nav-surface`. Labels at `option` (14px/500), group headings 11px/600 uppercase in `nav-ink-soft`. Two groups, `Today` and `Manage`, which is the split the old rail implied with a spacer but never named. Counts sit right, in mono. It collapses to a 72px icon rail, and in that mode every item carries a `title` and an `aria-label`.

**`BottomTabBar`** — the four destinations reception uses all day (Queue, Appts, OT, More), fixed in the thumb arc, labelled at 12px. `More` opens the overflow: Machines, Stock, Admin. Badges in `gold-bright`.

**`TopBar`** — flex-wrap, so the right group drops below the title on a narrow screen instead of crushing it. The hospital's name is set in the serif at 22px; the clock's time is mono at 16px, because it is the number the waiting column is read against.

**`StageStrip`** — the stage filter, moved next to the content it filters, scrolling on one line so the six stages still read as a journey.

## The rules that hold it together

**The active state is three signals, never one.** `nav-active` is only 1.4:1 against `nav-surface` — as a ground on its own it is invisible to a great many people. So every active item also switches its label to `nav-ink` at 600, and grows a `gold-bright` indicator: a 3px bar inside the left edge in `SideNav`, a 3px bar across the top of the tab in `BottomTabBar`. Collapsed, `SideNav` turns the active icon gold instead, since a centred icon leaves no room for a bar. Drop the indicator and the component fails.

**Primary destinations are never behind a menu on mobile.** The hamburger exists, but only for the long tail. If a destination is used every day, it is a tab.

**Labels stay on.** An icon-only tab is a memory test. 12px/500 costs 16px of height and removes it.

**One gold accent.** The active indicator and the active count chip are the only gold in the chrome — consistent with the system-wide rule that gold means *a clock is running or this is where you are*. Spending it anywhere else in the navigation would stop it meaning either.

**Focus rings invert on navy.** `focus` (blue) is 3.4:1 on `nav-surface`; `focus-inverse` (gold) is 9.3:1. Put `gk-on-navy` on any navy container and its focus rings flip.

## Still to do

- The mobile overflow sheet behind `More` is specified here but has no component card yet; it is `SideNav`'s item list on a `nav-surface` sheet over `scrim`.
- No breadcrumbs: the app is one level deep by design, and depth lives in the `Drawer`.
