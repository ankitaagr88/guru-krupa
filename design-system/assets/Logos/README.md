# Logos

**The real mark is not in this system yet.**

The GK monogram was shown to us as an image in conversation, not supplied as a file, so there was nothing to copy. This system does not redraw it — a hospital's mark is not something to reconstruct from memory.

## What the previews use instead

`SideNav` shows a simple outline eye glyph in a `gold-bright` tile, drawn in `currentColor`. It is a placeholder, and it is deliberately generic so nobody mistakes it for the real mark. The wordmark is set in the `serif` family at `wordmark`, which matches the logo's own heavy serif.

## What the mark looks like, for colour reference

Gold monogram with a faceted sapphire set as the eye of the `G`, silver on the `K`'s lower stroke and the arrow, over a white ground. The wordmark is gold; the rule and the subtitle `EYE HOSPITAL & LASER CENTER` are silver-grey.

Four tokens record those values, marked REFERENCE ONLY: `mark-gold` `#c9922f`, `mark-sapphire` `#1b4fc4`, `mark-silver` `#9aa3aa`, `mark-silver-dim` `#6b7379`. They are for matching the mark in print. The screen palette's `gold` and `sapphire` ramps are tuned from them — darker, because the artwork's values do not hold contrast as interface colours.

## To finish this group

Drop the real files onto this system and they will be filed here:

- `gk-mark.svg` — the monogram alone, for the navigation and the favicon
- `gk-lockup.svg` — monogram over wordmark, for print and the prescription head
- `gk-mark-mono.svg` — a single-ink version for stamps and faxes

Vector, please. A single-ink version must name its ink in this file, because an `<img>` cannot inherit `currentColor`.

## The name

The two sources disagree and it is not cosmetic:

- The prototype's header says **Gurukrupa Eye Hospital & Research Center**
- The supplied logo says **GURU KRUPA EYE HOSPITAL & LASER CENTER**

One word, one space, and *Research* against *Laser*. This prints on every prescription, so settle it before anything goes to paper. The system currently follows the prototype in `TopBar` and the logo in the wordmark — which is not a resolution, it is the disagreement preserved.
