Gurukrupa is a working eye hospital's reception desk, rendered as software. Everything here answers one question a receptionist asks a hundred times a day: *where is this patient, and what happens to them next?* Design for a glance across a busy room, not for a considered read.

The structure, the components and the clinical vocabulary come from the hospital's patient-flow prototype. The colour and type layers do not — they are built here, from the GK monogram, because the prototype's own palette had drifted off its brand and seven of its text pairs were unreadable.

## Voice

Write the way the desk speaks. Plain, specific, present tense.

- **Name real things.** `Dilating · Wait`, `Pre-testing`, `Tono-Pachy (IOP & CCT)`, `Tropicamide 0.8%`. The vocabulary is clinical because the users are clinical; don't soften it into `Step 2` or `Eye test`.
- **A control says what happens.** `Check in`, `Add to queue`, `Print prescription` — a verb and its object. Never `Submit`, never `OK`. What follows says it back in the past tense: `Checked in`.
- **Empty states are facts, not apologies.** `Nobody is waiting for billing.` Not `No results found`.
- **Errors say what to do.** Name what went wrong and the next action. No apologies.
- **Sentence case everywhere.** The one uppercase run in the product is `eyebrow`, on a `SummaryCard` title, and that is what makes it read as a standing note rather than live data.
- **Three scripts.** Patient-facing strings appear in English, हिंदी and ગુજરાતી. Never letter-space a label that might carry Devanagari or Gujarati — it breaks conjuncts.
- **No emoji in the product.** Icons carry the visual load.

## Colour

The mark is a gold monogram with a sapphire set into it. The interface is the same two colours doing two different jobs.

**Sapphire is what you act on.** `sapphire` for primary buttons, active pills, selected borders and links; `sapphire-deep` for hover and for blue text that needs weight; `sapphire-ink` for the navigation ground and the rule under the prescription head; `sapphire-wash` for every selected or informational surface.

**Gold is what is counting.** In this product the brand's metal has exactly one job in the interface: **a clock is running**. Dilation arcs, the running-timer tag, a processing test, the navigation's active indicator. Nothing else is gold. That is a real constraint and it is why the dilation ring — the one piece of live UI in the app — carries the brand's colour: the app's signature moment wears the hospital's metal.

`gold` is 3.3:1 on `surface`. It is a **fill and a stroke, never text on light**. Gold text is `gold-deep` (6.1:1). Gold on navy is `gold-bright` (9.3:1).

**Two signals beside them.**
- `alert` — overdue, someone must act.
- `done` — complete, confirmed. A **cyan-teal at hue 182°**, not a green. See *Colour is never the only signal* in `accessibility.md`.

**Grounds are warm, ink is cool.** `canvas` is a warm stone; `surface` a warm white a half-step above it; `surface-sunk` is pressed into the page for inputs, table headers and bill rows. The ink is a deep sapphire-navy. Warm ground against cool ink is the logo's own arrangement — gold metal, blue gem — and it is what stops the interface reading as generic blue-grey SaaS.

**Every text token passes AA on every ground it is used on.** There is no decorative-only text colour in this system; `line-strong` is for dashes, grips and disabled strokes, never for words.

## Type

Three faces, each with a job you can state in one line:

- **Source Serif 4** (`serif`) — **names and headings.** Every patient name, every heading, the wordmark, the prescription head. The logo's own wordmark is a heavy serif; this is the interface agreeing with it.
- **IBM Plex Sans** (`ui`) — **the interface.** Labels, buttons, prose, status words. Plex is drawn for instrument panels, which is what this is.
- **IBM Plex Mono** (`mono`) — **anything a machine measured.** Refraction and IOP values, queue tokens, clock times, waiting durations, bill amounts, source stamps.

That third face is the one that makes this system specific. `SPH -1.00`, `IOP 24`, `CCT 520`, `#014`, `11:42 AM`, `₹1,050` — these are instrument output and money, they are compared down a column, and setting them in mono makes that legible instead of decorative. Plex Sans and Plex Mono are drawn together, so the two sit side by side without a seam.

The split is strict, and it is what gives the interface its texture: a patient's **name** is the serif, their **address** is Plex Sans, their **IOP** is Plex Mono — in the same card.

**Scale.** Body is **14px**, up from the prototype's 12.5px; the smallest type in the system is 11px, and it is reserved for machine stamps. The prototype set navigation labels at 9px and section headings at 8px. Nothing here goes below 11px.

## Space, radius, elevation

**Spacing** is a real 4px scale, `space-0.5` to `space-10`, replacing the prototype's nineteen ad-hoc padding values. Desktop gutter `space-8` (32px), mobile gutter `space-4` (16px). Lay groups out with flex or grid and `gap`.

**Radius** is five steps, down from twelve, and softer throughout: `radius-md` (10px) on controls and rows, `radius-lg` (14px) on cards, `radius-xl` (18px) on modals and the drawer. More generous rounding is most of why the refreshed system reads calmer than the original.

**Elevation is restrained.** A card leans on its border and on the `canvas`→`surface` step, not on a shadow. `shadow-sm` at rest, `shadow-md` under a pointer, `shadow-lg` only for things floating over the page. Shadows are tinted with `sapphire-ink`, not neutral black, so they stay in key against the warm ground.

**Grounds over borders, borders over shadows.** A state changes the ground (`dilating`, `overdue`). A selection changes the border. Only `Toast` carries a coloured edge bar, where it is load-bearing in a stack — **no left-border accent cards**.

## Iconography

24×24 outline icons, Feather-style: `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, rendered at 19–22px. They inherit colour from their container, which is why the same glyph works on the navy navigation and on a white card. Every icon that is the only content of a control carries an `aria-label`.

## States and interaction

**Focus is visible, always.** 2px `focus` at 2px offset on light grounds; `focus-inverse` — gold — on navy, applied by the `gk-on-navy` class. The prototype had no focus style at all.

**Motion is state, not decoration.** The countdown arc, the drawer slide, the toast entrance, the overdue pulse. All of it collapses under `prefers-reduced-motion`, which `bundle.css` handles.

**Never colour alone.** Every status carries a word. Every navigation active state carries a gold indicator and a weight change as well as a ground.

## Layout

One shell, two arrangements:

- **Desktop (≥900px)** — `SideNav` left, then `TopBar`, `StageStrip` and the content. `QueueTable` for the queue, `Drawer` from the right.
- **Mobile (<900px)** — `TopBar` with a `nav-trigger`, content, `BottomTabBar` fixed to the bottom. `PatientCard` list instead of the table; the drawer goes full-width.

Tables become stacked cards, never squeezed tables. Horizontal strips (`StageStrip`, `DatePill`) scroll sideways rather than wrapping — they are sequences, and a wrapped sequence stops reading as one. Respect `env(safe-area-inset-bottom)` on the bottom bar.

Read `navigation.md` for the navigation, and `accessibility.md` for the full contrast audit.
