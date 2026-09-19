A row of two to four mutually exclusive choices, each an equal-width button.

**When to use.** For a short, closed set the person should see all of at once: sex (F / M / Other), preferred language (English / हिंदी / ગુજરાતી), booking channel (WhatsApp / Call / Walk-in). Above four options, use `DropSelect`.

**What the consumer provides.** The options, the selected key, and the handler. Render as `<button type="button">` inside a container with `role="group"` and a label, or as real radios if the form posts.

**Selected state** is `sapphire-wash` ground, `sapphire` border and `sapphire-deep` text — ground, border and weight together, never colour alone.

**Channel variants.** Add `whatsapp` or `call` alongside `active` and the selected segment takes that channel's own wash and ink, matching `ChannelTag` so the two read as the same fact in two places. Both channel inks pass AA on their washes — see `ChannelTag`.

**Script support.** The language toggle carries Devanagari and Gujarati. Keep the label in the language it names — `हिंदी`, not `Hindi` — and don't letter-space these segments; it breaks conjuncts.
