A booked slot: time, patient, purpose, how it was booked, and the check-in action.

**When to use.** In the Appointments view, under a `DatePill` strip, one per slot in time order.

**What the consumer provides.** The time, patient name, the reason line, the channel, and the check-in handler. Checking in moves the patient into the queue at Registration — so this button is the bridge between the two views, and its label should stay `Check in`, matching the stage it creates.

**Anatomy.** `appt-time` is a fixed 86px mono column so times align down the list regardless of name length; `appt-info` flexes; `ChannelTag` and the button sit at the end. The row wraps on narrow screens rather than shrinking the time column.

**After check-in** the button takes `done`: `done-wash` ground, `done-ink` text, no pointer. It stays visible rather than disappearing, so the list still reads as a complete record of the day.

**Time format.** `10:30 AM` — 12-hour with a space, matching the clock in `TopBar` and the reading stamps in `ReadingCard`. Set it in tabular numerals.

**Don't** put clinical detail here. The reason line is one phrase — `Post-op review, day 7` — and the record lives in the drawer once they are checked in.
