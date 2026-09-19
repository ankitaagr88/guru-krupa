# Gurukrupa Care System

The design system for the Gurukrupa Eye Hospital patient-flow app: compiled tokens,
32 components with guidelines and live previews, and the brand book.

## Open it

```
code gurukrupa-design-system
```

Then **run `index.html` with Live Server** (the VS Code extension `ritwickdey.liveserver`,
or any static server). The gallery uses iframes, which browsers block on `file://`.

```
npx serve .        # or: python3 -m http.server
```

`index.html` is the whole system on one page. Every card links to a standalone
preview under `preview/` that you can open and edit on its own.

## Use it in your code

Link the two stylesheets, in this order:

```html
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="components/bundle.css">
```

`tokens.css` declares every custom property on `:root` and adds one class per named
type style (`.page-title`, `.body`, `.reading`, …). `components/bundle.css` is the
component layer — it reads those properties and defines no colours of its own.

Markup for any component is in `preview/<Name>.html`; copy from there.

```html
<span class="status-pill gold">Dilating · drop 2</span>
<span class="td-token">#014</span>
<button class="btn-primary">Add to queue</button>
```

## What is here

| Path | What |
| --- | --- |
| `index.html` | the preview gallery — start here |
| `tokens.css` | **generated** from `tokens.json`; the file you link |
| `tokens.json` | the source of truth: 44 colours, 26 type styles, 10 spacing steps, 6 radii, 4 shadows |
| `components/bundle.css` | the component stylesheet |
| `components/<Name>/README.md` | when to use it, what you provide, the do/don'ts |
| `components/<Name>/preview.html` | the preview fragment (no `<html>` wrapper) |
| `preview/<Name>.html` | the same preview, standalone and runnable |
| `brand-book.md` | voice, colour, type, space, iconography, layout |
| `navigation.md` | the navigation redesign and the rules behind it |
| `accessibility.md` | the full contrast audit |
| `assets/Logos/README.md` | the logo situation — read this |
| `source/patient-flow-prototype.html` | the original single-file prototype |

Regenerate `tokens.css` after editing `tokens.json` — nothing here watches it.

## Three rules worth knowing before you build

1. **Gold means one thing: a clock is running.** Dilation, processing, and where you
   are in the navigation. Never decoration. `gold` is 3.3:1 on `surface`, so it is a
   fill and a stroke, never text on light — gold text is `gold-deep`.
2. **"Done" is cyan, not green.** Hue 182°, deliberately off the red–green axis so it
   stays separable from `alert` for red-green colour-blind readers. Don't "fix" it.
3. **Three faces, three jobs.** Serif for names and headings, Plex Sans for the
   interface, Plex Mono for anything a machine measured — readings, tokens, times,
   amounts.

## Two things still open

- **The logo is not in this package.** It was supplied as an image, not a file, and a
  hospital's mark should not be redrawn from memory. `SideNav` uses a plain
  placeholder glyph. Its colours are recorded as `mark-*` reference tokens.
- **The hospital's name disagrees with itself.** The prototype says *Gurukrupa Eye
  Hospital & Research Center*; the logo says *GURU KRUPA EYE HOSPITAL & LASER CENTER*.
  This prints on every prescription.
