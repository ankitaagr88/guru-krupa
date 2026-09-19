The app header: who and where on the left, the clock and the primary action on the right.

**When to use.** Once, at the top of the main column, on every screen. It is the only place the hospital's name appears in the product chrome.

**What the consumer provides.** The title and sub-line, the clock value, the primary action, and — below 900px — the `nav-trigger` handler that opens the overflow navigation.

**Responsive behaviour.** The bar is `flex-wrap`, so on a narrow screen the right group drops below the title instead of crushing it. The title falls from `page-title` (22px) to 17px and the sub-line from 13px to 12px; the clock's date line can be hidden below 480px, but never the time itself — the waiting column in `QueueTable` is read against it.

**The `nav-trigger`** (hamburger) is hidden on desktop, where `SideNav` carries the same destinations. On mobile it opens the overflow list, not the primary destinations — those live in `BottomTabBar`.

**One primary action.** `+ New patient` is the only `btn-primary` on the screen. Search and other utilities are `icon-btn`, which keeps a single obvious thing to press.

**Don't** put the stage filter here — that is `StageStrip`, which belongs with the content it filters.
