The desktop primary navigation: a 244px labelled sidebar on `nav-surface`, collapsible to a 72px icon rail.

Replaces the prototype's fixed 76px icon rail, whose labels were set at 9px and whose section headings at 8px — both below the 10px floor this system sets for any text a person is expected to read. Here labels are `option` (14px/500) and group headings 11px/600 uppercase, and the rail keeps an icon-only mode for people who want the width back.

**When to use.** On viewports 900px and wider, as the left column of the app shell. Below that, use `BottomTabBar` for the primary destinations and a slide-in copy of this component for the full list.

**What the consumer provides.** The items (icon, label, optional count), which one is active, the collapse state and its handler, and the brand mark. Each item is a `<button>` or `<a>`; the active one carries `aria-current="page"`.

**The active state is never colour alone.** `nav-active` is only 1.4:1 against `nav-surface`, so the state is carried by three things together: the raised ground, the label switching from `nav-ink-soft` to `nav-ink`, and a 3px `gold-bright` bar inside its left edge (9.3:1 against the ground). Keep all three — dropping the bar leaves the state legible only to people who can resolve a 1.27:1 shade difference.

**Counts** use `sidenav-count`. On the active item the chip flips to `gold` with `on-gold` text, which is the one place the brand's gold does load-bearing work in the chrome.

**Collapsed mode** hides labels, group headings and the footer, and centres the icons. There is no room for the indicator bar beside a centred icon, so the active item's **icon** turns `gold-bright` instead — the state keeps a second, non-shade signal either way. Give every item a `title` and `aria-label` in that mode; an icon with no accessible name is the failure this component exists to fix.

**Don't** nest a second level inside it; the app's depth lives in the drawer, not the nav. **Don't** put more than three items in a group — the prototype's six-item rail already read as a wall.
