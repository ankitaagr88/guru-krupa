A pill naming how an appointment was booked: WhatsApp, a phone call, or a walk-in.

**When to use.** On the right of an `AppointmentCard`, and nowhere else. It is provenance, not status — it says how this person reached the hospital, and it never changes once set.

**What the consumer provides.** The channel key and its label.

| Variant | Ground | Ink | Ratio |
| --- | --- | --- | --- |
| `whatsapp` | `whatsapp-wash` | `whatsapp-ink` | 4.8:1 |
| `call` | `call-wash` | `call-ink` | 5.5:1 |
| `walkin` | `surface-sunk` | `ink-soft` | 5.9:1 |

**Why its own green and blue.** These two are borrowed from the channels themselves, not from the brand ramp, so a receptionist recognises them without reading. It is the one place in this system where an outside brand's colour is allowed in — keep it to this component and the channel variants of `SegmentedToggle`.

**Both pass AA.** The prototype set WhatsApp text at `#1f9254`, 3.6:1 on its wash. `whatsapp-ink` is darkened to `#16794a` so the tag meets AA at its real size.

**Don't** let the channel colours leak into status. `done` is cyan and `whatsapp-ink` is green precisely so a green chip never reads as "complete".
