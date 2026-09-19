# WhatsApp new-patient intake

A small service that replaces the paper form at the front desk. A new patient scans a QR code,
WhatsApp opens with the clinic's number, and a short, polite conversation in Gujarati or Hindi
collects the six things the paper form asks for. The answers land in the clinic's own system
(for Guru Krupa: the patient list of the Gurukrupa app) without anyone re-typing them.

This folder is self-contained. It does not import anything from `../backend` and can be reused
for another clinic by adding one YAML file.

---

## Part 1 – For the clinic owner (plain language)

### What the patient sees

1. They scan the QR at the reception desk with their phone camera (or the WhatsApp camera).
2. WhatsApp opens a chat with the clinic's number, with the word **Hi** already typed. They press send.
3. The clinic replies with two buttons: **ગુજરાતી** and **हिन्दी**. They tap one.
4. From then on every message is in that language (Gujarati/Hindi script, everyday English words
   such as "mobile number" left in English). One question at a time, no rush:
   - full name (typed)
   - age (typed – Gujarati/Hindi numerals are fine)
   - gender – **Male / Female / Other** buttons
   - address (typed)
   - contact number (typed – checked to be a 10-digit Indian mobile)
   - how they heard of the clinic – a tap list: ગૂગલ / સોશિયલ મીડિયા / મિત્ર-કુટુંબ / ડૉક્ટરની ભલામણ
5. Once the gender is known the bot addresses them properly (રમેશભાઈ, રમીલાબેન, रमेश जी).
6. They get a closing message: *"બસ, થઈ ગયું! તમે નોંધાઈ ગયા છો. આરામથી બેસો, ડૉક્ટર તમને થોડી જ
   વારમાં બોલાવશે."* The record is already in the clinic's system.

Small things it handles on its own:

- Typing a wrong age or number: it asks again, politely, in the same language.
- Half-filled form and the patient walks away: after 30 minutes of silence the next message
  gently starts again from the beginning.
- Scanning the QR twice in one day: *"તમે આજે નોંધાઈ ગયા છો…"* — no duplicate record.
- Typing **Hi** mid-way starts over.
- If the clinic system is briefly down, the patient still gets the confirmation; the record is
  kept and re-sent automatically every few minutes until it goes through.

### What the front desk sees

For Guru Krupa: the patient appears in the Gurukrupa app's patient list (name, age, sex, phone,
address, language, "how they heard of us"), with the note *Registered via WhatsApp intake*.
For a spreadsheet-based clinic: a new row in their Google Sheet. Or a CSV file that opens in Excel.

### Printing the QR

Open `http://<server>/qr/gurukrupa` in a browser and press **Print** — it is laid out for A5 with
the clinic name and a one-line instruction in Gujarati and Hindi. `/qr/gurukrupa.png` gives just
the image if you want to put it on your own poster.

### Open questions to confirm before going live (from the spec)

1. **Which CRM / sheet does the clinic already use?** For Guru Krupa this is the Gurukrupa app
   (`POST /api/patients`); other clinics may want a Google Sheet.
2. **Official BSP route or unofficial linked-device pilot first?** This build targets the official
   WhatsApp Business Platform (Meta Cloud API directly, or a BSP such as Interakt / AiSensy / WATI).
   Tap-to-select buttons only work reliably on the official route.
3. **Any specialty-specific fields beyond the standard six?** None are included for Guru Krupa.
   Adding one is a YAML edit (see the allergy-clinic example).
4. **Who owns the WhatsApp number?** The clinic's existing number (9328621216 / 7574998502) can be
   moved to the Business Platform, but a number can only be on one of "WhatsApp app" or
   "WhatsApp Business API" at a time — moving it changes how the clinic uses that number day to
   day. A new dedicated number avoids that.

Also worth confirming: the exact wording of the messages (the scripts follow the spec verbatim)
and whether "Other" gender in Gujarati should get an honorific (currently skipped, per spec).

---

## Part 2 – Technical

### Layout

```
whatsapp-intake/
  app/
    config.py            # YAML -> validated ClinicConfig (pydantic); ${ENV} substitution
    conversation.py      # the state machine (one persisted session per phone number)
    validation.py        # text / number / phone / choice validation
    messages.py          # IncomingMessage / OutgoingMessage / Option
    db.py                # SQLAlchemy: sessions, intake_records, pending_records (SQLite by default)
    qr.py                # wa.me QR (PNG) and the printable A5 page
    main.py              # FastAPI: /webhook/{clinic}, /health, /qr/{clinic}[.png], /retry-pending/{clinic}
    providers/
      base.py            # Provider interface: send_text / send_buttons / send_list / parse_incoming
      meta_cloud.py      # Meta WhatsApp Business Cloud API (Graph v20+)
      console.py         # prints to the terminal (local dev, simulator)
    destinations/
      base.py            # Destination interface: save(record)
      gurukrupa_api.py   # POST /api/patients with Bearer token (login via /api/auth/login)
      google_sheet.py    # JSON POST to an Apps Script web app (script included in the docstring)
      csv_file.py        # append to a CSV file
      __init__.py        # factory, deliver() with retries/backoff, pending queue + retry_pending()
  clinics/
    gurukrupa.yaml                 # Guru Krupa Eye Hospital – scripts exactly as in the spec
    example-allergy-clinic.yaml    # a second clinic: different wording, extra question, sheet destination
  tests/                 # pytest
  simulate.py            # terminal simulator
  .env.example
```

### Run locally

```powershell
cd whatsapp-intake
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env          # edit values (for local play nothing is required)

# try the conversation in the terminal, no WhatsApp needed
.venv\Scripts\python simulate.py gurukrupa
#   buttons/lists show as numbered options: type 1, 2, ... or the label; "Hi" restarts; "quit" exits
#   completed forms go to data/simulate-gurukrupa.csv
#   the simulator remembers you (data/simulate.db): use --phone 9190000000xx for another "patient"

# run the tests
.venv\Scripts\pytest -q

# run the web service
set WHATSAPP_PROVIDER=console   # optional: print instead of calling Meta
.venv\Scripts\uvicorn app.main:app --reload --port 8000
#   GET  /health
#   GET  /qr/gurukrupa           printable page      GET /qr/gurukrupa.png  image
#   GET  /webhook/gurukrupa      Meta verification   POST /webhook/gurukrupa  messages
#   POST /retry-pending/gurukrupa  push queued records now (also runs every 5 min)
```

Non-interactive demo of the whole flow:

```powershell
printf "1\nRamesh Patel\n45\n1\nVesu, Surat\n9876543210\n1\n" | .venv\Scripts\python simulate.py gurukrupa
```

### Configure a new clinic

1. Copy `clinics/gurukrupa.yaml` to `clinics/<clinic-id>.yaml` and change:
   - `id`, `name`, `name_local`, `whatsapp_number` (digits with country code, used in the QR link)
   - `default_language` (`gujarati` or `hindi`), `triggers`, `qr_trigger`
   - `messages.*` – per-language text for the language prompt, re-ask messages, closing, etc.
   - `questions` – ordered list. Each has `key`, `type` (`text` | `number` | `phone` | `choice`),
     per-language `text`, and for `choice` a list of `{value, label: {gujarati, hindi}}`.
     Up to 3 choices are sent as WhatsApp buttons, 4–10 as a list. `number` takes `min`/`max`,
     `text` takes `min_length`. `{name}` / `{name_hon}` placeholders may be used in any text.
   - `honorifics` – per language: suffix by gender value, separator, first-name-only.
     `{name_hon}` only adds the suffix once the `gender_key` question has been answered.
   - `provider` – `meta_cloud` with that clinic's `phone_number_id` (use a different env var per clinic).
   - `destination` – `gurukrupa_api` | `google_sheet` | `csv` (see below).
2. Restart the service. The clinic gets its own `/webhook/<clinic-id>` and `/qr/<clinic-id>`.
3. The `gurukrupa_api` destination expects question keys `name, age, gender (M/F/O), address,
   contact, source` and maps `source` values through `destination.referral_source_map` to the
   Gurukrupa `REFERRAL_SOURCES` keys (`online`, `patient`, `doctor`, …). Other destinations take the
   answers as they are, so any keys work.

### Connect the WhatsApp number (Meta Cloud API)

1. In Meta Business Manager create a WhatsApp Business app, add/verify the clinic number and note
   the **Phone number ID** (`META_PHONE_NUMBER_ID`).
2. Create a **System User**, give it the WhatsApp app's `whatsapp_business_messaging` and
   `whatsapp_business_management` permissions and generate a **permanent token**
   (`META_TOKEN`). Temporary tokens from the API-setup page expire in 24 h.
3. Deploy this service somewhere with HTTPS (Meta requires it), e.g. `https://intake.example.com`.
4. In the app's WhatsApp > Configuration page set:
   - Callback URL: `https://intake.example.com/webhook/gurukrupa`
   - Verify token: the same string as `WEBHOOK_VERIFY_TOKEN` in `.env`
   - Subscribe to the `messages` webhook field.
   Meta will GET the URL with `hub.challenge`; the service echoes it back when the token matches.
5. Send "Hi" from a phone to the number. Note: until the number is approved for production you
   must add tester numbers in Meta, and within a customer-initiated 24-hour window free-form
   messages are allowed (the whole intake is customer-initiated, so no templates are needed).

**BSP instead of Meta directly.** Interakt / AiSensy / WATI expose the same interactive
button/list messages with a slightly different HTTP shape. Add `app/providers/<bsp>.py` as a
subclass of `Provider` implementing the four methods, register it in `providers/__init__.py`,
and set `provider.kind` in the YAML. The clinic's chosen provider documents its API at the Postman
link in `../../Whatsapp API.txt` (it could not be fetched from the build machine; check it before
writing the adapter — in particular how it delivers button/list replies to the webhook).

### Destinations

- **gurukrupa_api** – `POST {GURUKRUPA_API_URL}/auth/login {username,password}` once to get a
  Bearer token (cached, refreshed on 401), then `POST {GURUKRUPA_API_URL}/patients` with
  `{name, age, sex, phone, address, language, referralSource, referralDetail, note}`. Create a
  dedicated staff login for the bot (`GURUKRUPA_API_USER/PASSWORD`).
- **google_sheet** – JSON POST to an Apps Script web-app URL; the script to paste is in
  `app/destinations/google_sheet.py`. Set `GOOGLE_SHEET_WEBHOOK_URL`.
- **csv** – appends to `destination.path` (default `data/<clinic>-intake.csv`, UTF-8 with BOM so
  Excel shows Gujarati/Hindi correctly).

Every completed form is also kept in the local `intake_records` table. If the destination fails
after `attempts` tries (exponential backoff), the record is queued in `pending_records` and retried
by the background loop (every `RETRY_INTERVAL_SECONDS`, default 300) or by
`POST /retry-pending/<clinic>`. `/health` reports how many are waiting.

### Environment (`.env`)

See `.env.example`: `META_TOKEN`, `META_PHONE_NUMBER_ID`, `WEBHOOK_VERIFY_TOKEN`, `DATABASE_URL`
(default `sqlite:///./data/intake.db`; any SQLAlchemy URL works), `GURUKRUPA_API_URL`,
`GURUKRUPA_API_USER`, `GURUKRUPA_API_PASSWORD`, `GOOGLE_SHEET_WEBHOOK_URL`. Optional:
`WHATSAPP_PROVIDER=console` for local runs, `LOG_LEVEL`, `RETRY_INTERVAL_SECONDS`.

### Tests

`pytest -q` covers: full Gujarati and Hindi happy paths asserted against the YAML scripts,
honorific rules, invalid age/phone re-asks, typed-instead-of-tapped answers, resume after a
service restart, "Hi" restart, 30-minute expiry, same-day re-scan, Meta webhook parsing (text,
button_reply, list_reply, statuses, verification), outgoing button/list payload shapes, Gurukrupa
API mapping with a mocked HTTP client (sex, referralSource/Detail, login and 401 re-login),
retry/backoff, pending queue and retry, CSV and sheet flattening, and the HTTP endpoints.
