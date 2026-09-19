# Accessibility

Every pair below was measured against the values in `tokens.json`. The system has one theme, so these are the only numbers there are.

## Every text pair passes

Unlike the prototype this system was built from, there are no failing text pairs to document and no decorative-only text colours. Each text token was chosen to clear 4.5:1 on **every** ground it is used on.

| Pair | Ratio |
| --- | --- |
| `ink` on `surface` | 15.7:1 |
| `ink` on `canvas` | 14.1:1 |
| `ink` on `surface-sunk` | 13.0:1 |
| `ink-soft` on `surface` | 7.1:1 |
| `ink-soft` on `canvas` | 6.4:1 |
| `ink-soft` on `surface-sunk` | 5.9:1 |
| `ink-faint` on `surface` | 5.8:1 |
| `ink-faint` on `canvas` | 5.2:1 |
| `ink-faint` on `surface-sunk` | 4.8:1 |
| `sapphire` on `surface` | 7.5:1 |
| `sapphire-deep` on `sapphire-wash` | 9.6:1 |
| `on-sapphire` on `sapphire` | 7.7:1 |
| `on-sapphire` on `sapphire-deep` | 11.4:1 |
| `gold-deep` on `surface` | 6.1:1 |
| `gold-deep` on `gold-wash` | 5.4:1 |
| `on-gold` on `gold` | 4.7:1 |
| `alert-ink` on `alert-wash` | 6.4:1 |
| `done-ink` on `done-wash` | 7.0:1 |
| `whatsapp-ink` on `whatsapp-wash` | 4.8:1 |
| `call-ink` on `call-wash` | 5.5:1 |
| `nav-ink` on `nav-surface` | 16.3:1 |
| `nav-ink-soft` on `nav-surface` | 8.1:1 |
| `nav-ink-soft` on `nav-active` | 6.5:1 |
| `gold-bright` on `nav-surface` | 9.3:1 |

## Non-text marks, at the 3:1 floor

| Mark | On | Ratio |
| --- | --- | --- |
| `focus` ring | `surface` | 4.8:1 |
| `focus` ring | `canvas` | 4.3:1 |
| `focus-inverse` ring | `nav-surface` | 9.3:1 |
| `gold` arc / fill | `surface` | 3.3:1 |
| `alert` arc / rule | `surface` | 5.5:1 |
| `done` mark | `surface` | 5.9:1 |

**`gold` is 3.0:1 on `canvas`** — right at the floor. Gold marks belong on `surface`, which in practice they are: the countdown ring lives on a card. Don't put a gold stroke straight onto the canvas.

**Colours that are not for text.** `gold` (3.3:1 on surface) and `line-strong` (1.5:1 on canvas) are fills, strokes and dashes. They never carry words.

## What the prototype got wrong, and what changed

Seven pairs in the source failed AA. None survive:

| Prototype | Was | Now |
| --- | --- | --- |
| `faint` `#93a0c6` as text | 2.6:1 | `ink-faint` `#5a6382`, 5.8:1 |
| white on the amber timer tag | 2.2:1 | `on-gold` `#16203d`, 4.7:1 |
| amber pill ink on its wash | 4.2:1 | `gold-deep` on `gold-wash`, 5.4:1 |
| coral as text on its wash | 3.1:1 | `alert-ink`, 6.4:1 |
| sage as text on its wash | 3.1:1 | `done-ink`, 7.0:1 |
| WhatsApp ink on its wash | 3.6:1 | `whatsapp-ink` `#16794a`, 4.8:1 |
| 9px nav labels, 8px headings | below any floor | 14px labels, 11px headings |

## Colour is never the only signal

The prototype's `sage` and `coral` sat at **1.05:1 against each other** — for a red-green colour-blind reader, the same chip. The refresh fixes this at the palette level rather than papering over it:

**`done` is a cyan-teal at hue 182°, not a green.** Against `alert` at hue 8°, that is 174° of separation on the wheel, and cyan-versus-red survives deuteranopia and protanopia in a way green-versus-red does not.

Lightness separation would have been the other route the rule allows, but it is not available here: both inks have to be dark enough to read on their own pale wash, which pins them within ~1.1:1 of each other. The hue route is the one this system takes, deliberately, and it is the reason "complete" is cyan.

On top of that, two rules:
- **Every `StatusPill` carries a word.** A pill with a colour and no text is a bug.
- **Every clinical state has a second channel.** An overdue patient is an `alert` ring *and* an `alert-wash` card *and* the word `Overdue` *and* a toast.

## Keyboard and screen reader

- **Focus rings.** 2px `focus` at 2px offset everywhere; `focus-inverse` inside `gk-on-navy`.
- **Icon-only controls carry an `aria-label`** — `IconButton`, the collapsed `SideNav`, every `✕`.
- **Table rows are reachable.** `QueueTable`'s rows open the drawer; give each a `tabindex` and an Enter handler, or wrap the name in a button.
- **The drawer and modal manage focus** — in on open, trapped while open, back to the opener on close; Escape closes.
- **`role="switch"` with `aria-checked`** on `Switch`; `aria-current` on the active nav item and the selected `DatePill`.
- **`prefers-reduced-motion`** collapses the drawer slide, the toast entrance and the overdue pulse. Handled in `bundle.css`.

## Text sizing

11px is the floor and it is reserved for machine stamps (`stamp`) and the smallest tags. Body is 14px. Anything a person reads to make a decision is 12px or larger.
