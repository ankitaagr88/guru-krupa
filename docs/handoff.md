# Handoff — Gurukrupa Eye Hospital System

Updated at the end of every working session, together with `task-list-backend-frontend.md` (the live status board with % complete).

---

## Session 3 — 2026-09-23 (final update at session end)

### Where things stand (plain language)
**The app is built.** Every feature on the list works and has been clicked through on the real database on your PC, on desktop and phone. All checks pass: server 215, screens 133. The code is on GitHub (`ankitaagr88/guru-krupa`, latest `989e901`). The overall task list is at 86%. What's left is putting it online (server + backups) and a few answers from the clinic. Nothing is running now: the app, the helpers and the hourly handoff timer are all stopped.

### Done this session
1. **Front desk**
   - **Number already on file:** as soon as 10 digits are typed, the form shows "This number belongs to the family of …" with who is on it. It then asks the new patient's **relation** (required before saving). "Use this patient" is there for the same person, and "Not related — separate patient" for someone unrelated.
   - **Phone boxes everywhere** show a fixed **+91** and take only the 10 digits.
   - **Date of birth** instead of a fixed age; the age works itself out. The KiviHealth import reads a DOB column and falls back to Age.
   - **Edit details** on the patient page.
   - **Phone search** ignores spaces and dashes. Picking someone not in today's queue opens their record.
2. **Families on one mobile number**
   - Owner + members, each a full patient with a relation. The relations list is **in Hindi with English**: पति (Husband), पत्नी (Wife), बेटा (Son), बेटी (Daughter)… It can be edited in Admin → Family relations.
   - The patient page has a "Family on this number" card (change relation / make owner / remove / add member) and a "बेटा (Son) of Rasila Patel" line.
   - Admin → "Group patients who share a number" is for after the KiviHealth import.
3. **New-patient form patients fill in themselves (QR code)**
   - The QR poster is in Admin → New patient form, in English / Gujarati / Hindi.
   - Patients fill the form on their phone, get a token and land in today's queue with a note for reception. Staff use the same form ("New patient form" button).
   - The public form never shows or links anyone. It works on phones once the app is on the rented server.
4. **Doctor's panel**
   - The **Diagnosis** picker fills the prescription with the usual medicines.
   - **Follow-up** (1 week / 2 weeks / 1 month / 3 months / date + note) books the appointment. It's tagged "Follow-up" on Appointments and printed as "Next visit".
   - Appointments has an **"Another day"** picker to reach follow-ups weeks ahead.
   - The prescription button now says **Save / Saving… / Saved at 10:42 am**.
5. **Billing like a till**
   - **Dr Anu's fee list** is loaded (Consultation / new file ₹700, Follow-up ₹350, New case ₹500, OT follow-up ₹350, Emergency ₹1000; tests and packages with one-eye / both-eyes prices).
   - **The visit type is picked automatically:** new patient / free within 6 days / follow-up up to 182 days / new case after that or for a different problem / after surgery; emergency suggested 8 pm–8 am and Sundays.
   - The bill starts with the suggested fee. Charges are one tap each, a medicine price is added on "Bought here", and receipts are numbered **GK-2026-00001** and print on A5.
   - **All prices and rules can be changed in Admin at any time:** Standard charges, Visit types & fees, Medicines.
6. **"Today's summary" page:** patients seen, time per stage, visits by type, money by payment mode, unpaid bills, medicines sold, receipts with reprint.
7. **New logo:** the full logo on login and prescriptions; the "GK" symbol in the menu, browser tab and phone icon.
8. **Bugs found and fixed**
   - **The printed prescription came out blank**, from an old print rule. Checked with a real print.
   - **Registering someone as "Other" crashed** on the real database.
9. **For the client: the server purchase guide**
   - `Guru-Krupa-Server-Purchase-Guide.pdf` in the project folder, plus an online copy (https://claude.ai/artifact/2ifgGaazhMKTNkcVb5XaW1 — share it before sending).
   - What to buy: DigitalOcean **Bangalore**, Basic Droplet 2 GB ($12) + **Daily backups** ($3.60) + Spaces ($5) ≈ **$20.60/month + GST**.
   - It includes your SSH key and the invite address `ankita.gyl15@gmail.com`.
   - **Your SSH key:** the private file is `C:\Users\ankitaa\.ssh\gurukrupa_do`. **Back it up and never send it to anyone.** It has no password yet; to add one run `ssh-keygen -p -f ~/.ssh/gurukrupa_do`.

### Questions waiting on you / Dr Anu
1. **After-surgery follow-up rule.** It's set as "free for 30 days" for now; change it in Admin → Visit types & fees.
2. Is "6 months" = **182 days**?
3. Delete the switched-off **Pre-test** and **Dilation** charges (they're not on her fee sheet)?
4. "Add family member" from the patient page saves **without** putting the person in today's queue. OK?
5. If only the age is corrected while a date of birth is on file, the DOB is dropped. OK, or keep the DOB?
6. Are the follow-up quick buttons (1 week / 2 weeks / 1 month / 3 months) right? Should the follow-up note print on the prescription?
7. Someone who reads **Gujarati / Hindi** should check the QR form's wording (`frontend/src/screens/Register/strings.js`).

### Next session — do in this order
1. **Before the server arrives:** finish the backup plan (task G6a). What exists today is only a nightly database dump that stays on the server. Still to build:
   - the nightly off-site copy to **Spaces**, including photos;
   - the clinic laptop pulling a copy at start-up and mid-day;
   - a missed-backup alert.
2. **When the client has bought the server (guide above):**
   - adapt the setup scripts (written for Hostinger, never run on a real server) to DigitalOcean;
   - install the app, connect the domain, turn on https;
   - create the real database and load the fee list + relations;
   - **run a full practice restore** before go-live.
3. **Security:** change `admin / admin123` and create the real staff logins (once Dr Anu confirms the roles, G4).
4. **KiviHealth import** when the export files arrive (G7), then "Group patients who share a number".
5. Apply Dr Anu's answers to the questions above. Decide photo retention (B14). Print the QR poster once the real address works.
6. Small: a stray space in "Age 62  y" under the date of birth.

### Waiting on you / the clinic
- The client buying the server + domain (send them the guide PDF and share the online copy).
- KiviHealth export files.
- Dr Anu: the questions above, staff roles (G4), photo retention (B14).
- A Gujarati / Hindi reader for the QR form.
- More printout photos (YPC-100K none yet); WhatsApp Business number (W4) — optional.

### How to run it on your PC
1. Server: PowerShell in `gurukrupa-system\backend` → `.venv\Scripts\uvicorn app.main:app` → http://localhost:8000/docs
2. Screens: PowerShell in `gurukrupa-system\frontend` → `npm run dev` → http://localhost:5173 (demo data; `admin / admin`). For the real database set `VITE_USE_MOCKS=0` in `frontend\.env.development` (real login `admin / admin123`).
3. Patient QR form: http://localhost:5173/register. QR poster: Admin → New patient form.

### How the work was done (for next time)
- Big pieces were split between helpers working at the same time, each in its own copy of the code and each only editing its own files. I prepared the shared parts first (database change, empty slots), then joined their work in one at a time.
- All test data I created was removed from the real database afterwards. The fee list and the relations list stay in the real database on purpose.
- Screen checks now allow 15 seconds each (the long Admin checks ran past 5 seconds on a busy PC).

---

## Session 2 — 2026-09-20 (final update at session end)

### Done so far this session
1. **F16 — the app now wears the official design system.** Every screen, the login page, the side drawers, pop-ups, notices and the printed prescription sheet use the new colours (warm stone background, navy menu, sapphire buttons, gold only where a timer is running), the three typefaces (serif for names and headings, Plex Sans for the interface, Plex Mono for readings, tokens, times and money) and the new navigation:
   - Desktop: a 244px **labelled side menu** in two groups (Today / Manage) with a queue count, your name and role at the bottom, and a "Collapse" button that shrinks it to icons (remembered per browser).
   - Phone: a **bottom tab bar** (Queue · Appts · OT · Machines · More) plus a slide-in menu with the queue stages and their counts.
   - Hospital name is **Guru Krupa Eye Hospital & Laser Center** everywhere (menu, top bar, login, app title, phone home-screen name, prescription head).
   - **No emoji** left in the product — replaced with icons (camera, paperclip, pencil) or plain words; "OK" buttons on notices now say "Got it".
   - Dilation row status reads "Dilating 08:57 · Step 2/2 …" instead of an hourglass.
   - OT status colours: Scheduled = blue, In progress = gold (a clock is running), Completed = teal, Cancelled = red.
   - All 71 screen checks still pass; app builds cleanly. Saved in git (commit `2a4d6e0`).
   - Checked visually on desktop (1440px) and phone (390px) with screenshots of every screen, the queue drawer, the prescription pop-up and the phone menu.

2. **F13 — Approve readings + scan the biometry report.** On the Machines screen every finished reading now has an **Approve** button (or "Save and approve" if you corrected a number first). After approval the card says who approved it and when, the printout photo is deleted (as agreed), and the machine list shows "approved". In OT → Pre-op there is a **Scan biometry report** button: photograph the HBM-1 IOL report and the grid fills itself; a note says how many values were read and names any it could not read so you type just those. 72 screen checks pass. Commit `8371a68`.

3. **Medicines are now just the name** (your instruction, matching KiviHealth, which only keeps "Medicine Name" + "Company"). Adding a medicine is one box; the picker, the prescription lines and the printed sheet show the name and the dosage only; the Admin "Medicine types" tab is gone. Commits `c9d5bd0`, `39182ab`.
4. Looked at the four KiviHealth screenshots in `KiviHealth\`: patient list has Name, Contact, Gender, Age, Local Id (GK1234), Area, City, last Appointment; the Data Export gives Patients / Appointments / Treatment Plans / Prescriptions / Payments **per date range, max 366 days** — so a full history means several exports. Still need the actual files.

5. **New request noted — treatment auto-fill from history (B15/F17):** when the doctor picks a diagnosis/treatment already seen in the KiviHealth history, the prescription pre-fills with the usual medicines and dosages (the most common set, counted from the records — **no AI**), and she edits only the differences. **Decided:** use the most common prescription across all patients with that diagnosis. Where there is no history, Dr Anu sets the standard herself in an Admin page (diagnosis/symptom → medicines + dosages), a one-time effort; whatever she saves there wins over the history-derived set. Goal: less time per patient, more patients per day. The Admin part can be built before the export arrives.

6. **Hosting decisions (you, 2026-09-20):** a small rented server (VPS) **in India** because of the DPDP Act — DigitalOcean Bangalore, Linode Mumbai or E2E Networks; not AWS for now — start small and migrate to AWS Mumbai later if the business grows (a one-evening job: restore the backup, copy photos, re-point the domain). Keep the domain registered in your own name. And a firm requirement that **clinic data can never be lost**: nightly database + photo backup on the server, an automatic off-site copy in Indian object storage, a copy pulled down to the clinic laptop at start-up and mid-day (the laptop and PC are off by 8 pm, so no nightly job on the clinic side), an alert if a night is missed, and a tested restore drill before go-live (task G6a).

7. **F11 — real-server click-through done.** With the server and PostgreSQL running on your PC, I drove the app through every screen and every action a staff member would take (register, move through stages, dilation timer, machine reading + approve, billing + complete, appointment + check-in, stock, OT case + biometry + billing, prescription save + print, MR visit, and the phone layout). Everything worked; one small fix — a first-time patient no longer shows "Last visit: Today" once their visit is completed. Test data was cleared afterwards, so the local database is back to its starting state. Backend 121 checks and screens 71 checks pass. Commit `5dbc7ae`.

8. **B15/F17 — Treatment standards, built and working on the real server.** In the prescription pop-up there is now a **Diagnosis** dropdown. Picking one fills the medicines and dosages from that diagnosis's standard — Dr Anu's own if she has set one, otherwise the most common prescription written for that diagnosis so far (a medicine counts when it appears in at least half of those prescriptions, with the dosage written most often — plain counting, no AI). A note says which of the two it came from; if medicines are already listed it asks before replacing them. The diagnosis is saved with the prescription, so every new prescription feeds the count. **Admin → Diagnoses & treatment standards:** 11 starter diagnoses (rename, reorder, switch off, add), and per diagnosis an editor that opens with the history-derived set so she can save it as-is or change it; "Use history instead" removes her override. KiviHealth prescriptions will feed the same counting once imported. Backend 124 checks, screens 74 checks. Commits `7e96513`, `9803f87`.

9. **B12 — OT time slots and procedures are now editable in Admin.** "OT time slots": add a time (9:00 AM or 14:15 both work), switch one off, or replace the whole list with a regular grid (from–to, every N minutes). A slot with upcoming surgeries booked can be switched off but not deleted or renamed, and a surgery already booked in a switched-off slot still shows on that day. "OT procedures": add, rename, reorder, switch off; the Schedule-surgery form reads this list. Backend 126 checks, screens 75. Commit `682f613`.

10. **G3 — pushed to GitHub.** All 23 commits are on `https://github.com/ankitaagr88/guru-krupa` (`main`). The B13 import work was started and immediately reverted at your request — nothing of it is in the repo.

11. **B13/F15 — the KiviHealth import is built (generically).** Admin → "Import from KiviHealth": pick the CSV or Excel export → the app guesses what it holds (patients / medicines / stock / prescriptions) and matches its columns to our fields from the header names (KiviHealth's own headers — Name, Contact, Gender, Age(Y), Local Id, Area, City, Medicine Name, Company — are already known) → you check or change the matching → **Preview** shows what every row would do (new / update / skip, with the reason) without writing anything → **Import**. Importing the same file twice changes nothing: patients are recognised by their KiviHealth Local Id (now stored on each patient) or by name + phone; medicines by name; stock levels are set with a movement; prescription rows (one per medicine) are grouped into one completed visit per patient per day and immediately count towards the treatment standards. When the real files arrive, the only work left is to confirm the column matching on screen. Backend 132 checks, screens 76. Commits `3ab7e2a`, `2614c5f`, pushed.

12. **Patient screen (your request after seeing the OT drawer).** Every patient name in the app — queue rows and cards, the drawers, OT, appointments, prescriptions list, the Machines "capturing for" line — is now a link to `/patients/<id>`: the whole record on one page (details, every visit newest-first with vision, notes, machine readings, prescription with diagnosis, bill and exam photos; surgeries; appointments; totals), with "Open today's visit" / "Add to today's queue" and View/print per prescription. Imported KiviHealth visits show as "from the previous system". Commit `b191fde`.
13. **Stock flow (your three requests).** (a) **Ordered…** on a Stock row asks how many were ordered; the row shows "7 on order · 20 Sept" and its low-stock alert stays quiet. (b) **Received…** pre-fills that amount and adds what actually arrived — if fewer, the remainder stays on order; "Not ordered" undoes. (c) **The doctor's prescription no longer deducts stock.** Its quantity is "To give". At billing the drawer lists each prescribed medicine with a **"Bought here"** button and the quantity; only that comes off the stock (with who confirmed and when); Undo restores it; medicines not stocked here say "Patient buys outside". If the doctor edits the prescription afterwards, confirmations are kept for medicines that stay and stock is returned for ones removed. Backend 134 checks, screens 79. Commits `f4e636d`, `9c87b7f`, pushed.

14. **Stock screen reworked after your review.** No more +/− buttons (stock only moves through Received, Bought here, or a reasoned Adjust). Rows sort problems first: low → on order → OK. Only low rows show an **Ordered** button, on-order rows show **Received**; Adjust / History / "Not ordered after all" sit behind a small "⋯" menu. New **Last received** column; dilation drops carry a small tag; the explanation is one line. Commit `6874fa1`.
15. **Admin jump list.** A row of chips at the top of Admin (Process stages … Staff & roles) that scrolls to the section and stays pinned under the top bar. Commit `a9b5086`, pushed.

16. **Staff logins carry a mobile number** (required when adding a login, editable in Admin → Staff; tidied to 10 digits, must be unique). The existing `admin` login has none yet — fill it in from Admin. **Patient window**: the side panel that opened from the right is now a centred window taking 75% of the screen (full screen on phones). Commit `d413b4a`, pushed.

17. **Machines on the desktop is now a readings dashboard, not a capture tool.** The phone keeps the capture flow (machine buttons, camera, offline queue, install prompt, typed entry). On the desktop you pick the patient and see the values read from their printouts for checking and approval; a printout image file can be added with a "which machine" chooser. No camera talk, no demo/offline controls there. Also: Admin/OT/Machines pages now use the screen width. Commits `788f1cc`, `fb84f02`, pushed.

### Next session — do in this order (from the honest review at the end of session 2)
These came from walking through the app as the clinic would use it. Do them before any more features.
1. **Duplicate-patient check** — when reception types a phone number in "New patient", show any existing patients with that number ("is it one of these?") and let them pick instead of creating a duplicate.
2. **Billing that works like a till** — admin-configurable **standard charges** (consultation, pre-test, dilation…) added with one tap; a **price on each medicine** (admin-editable) so "Bought here" adds a line to the bill; a printable **receipt**; a **daily collection total** by payment mode.
3. **Doctor's panel** — put **Diagnosis** on the doctor's panel (not inside the prescription pop-up) so picking it fills the prescription right there; add a **follow-up date** ("come back in 2 weeks") that creates the appointment automatically.
4. **Date of birth** instead of a fixed age (age computed and shown; the import keeps working with Age when there is no DOB).
5. **"Today" summary page** — patients seen, average time per stage, collections, medicines sold — so the goal (more patients per day) is measurable.
6. **Small daily annoyances** — visible search box in the top bar instead of the magnifier icon; hide the "Demo: no connection" button outside demo mode; make the prescription Save / Saved button state clearer; allow editing patient details from the patient record page.
7. Then the open items: **B14** photo retention (needs Dr Anu), **G7** first KiviHealth import (needs the files), **G6/G6a** Indian VPS + backups, change `admin / admin123`, role sign-off with Dr Anu.

### Where things stand at the end of session 2 (plain language)
Every screen exists and works on the real server; the code is on GitHub (`ankitaagr88/guru-krupa`, 35 commits). Backend 134 automated checks and screens 80 — all passing. What remains is the go-live list and the review items above.

### How to run it (unchanged)
1. Server: PowerShell in `gurukrupa-system\backend` → `.venv\Scripts\uvicorn app.main:app --reload`
2. Screens: PowerShell in `gurukrupa-system\frontend` → `npm run dev` → http://localhost:5173 (demo data; `admin / admin`). For the real database set `VITE_USE_MOCKS=0` in `frontend\.env.development`.

### Notes for the restyle
- The logo is still the JPG, shown in a white tile in the menu and on the login page. A **vector logo (SVG)** from the clinic will replace it in the menu, the browser tab icon and the prescription head.
- Old colour names (`--teal`, `--amber`, `--coral`, `--sage`, `--muted`, `--faint`) still work as aliases of the new tokens, so nothing older breaks; new work should use the design-system names (`--sapphire`, `--gold`, `--alert`, `--done`, `--ink-soft`, `--ink-faint`).

---

## Session 1 — 2026-09-19 (final update at session end)

### Where things stand (plain language)
The core tool is built end to end and runs on your PC against a real database: staff logins, patient queue, appointments, dilation timers, machine-printout reading (now accurate on the clinic's real slips), OT scheduling with biometry auto-fill, prescriptions with brand/generic/type and Hinglish/Gujlish printing, stock, admin settings, MR visits. A separate WhatsApp new-patient intake tool is also built and tested. **Overall progress: 68% at the end of session 1 (83% after F16, F13, F11, B15/F17, B12, B13/F15, patient screen, stock flow on 2026-09-20).** All work is saved in git (21 commits) and, since 2026-09-20, on GitHub.

### Done this session
1. Whole backend (server side) and every screen, built by parallel agents, merged and tested (backend 121 automated checks, screens 71, WhatsApp tool 38 — all passing).
2. Local PostgreSQL database created (you reset the master password), tables + starting data loaded; app started against it and a test registration worked (test data then removed).
3. Printout reading tuned on your real PDFs: reads every number on the HRK-8000A (×2), CLM-1 and HNT-1P samples; one HRK photo fills both refraction and keratometry; the HBM-1 biometry/IOL report fills OT pre-op measurements. A hand-read answer key sits next to the samples.
4. Photo rule: approving a reading deletes its photo; unapproved photos are cleaned after 7 days.
5. Medicine list upgraded: brand, composition, type (admin-configurable list: drops, gel, ointment, suspension, tablet, capsule, syrup, gummies), strength, pack size, maker. Aquaray Gel and MOSI LP added from your photos. Prescription form, printout, Admin (Medicines + Medicine types tabs), stock screen and the queue's Prescription button all updated.
6. WhatsApp new-patient intake built from `patient-intake-form-CLAUDE.md`: Gujarati/Hindi tap-button conversation, patient lands in the Gurukrupa patient list, printable QR page, on-PC simulator, example second clinic.
7. Rules captured from you (saved for future sessions): everything category-like is admin-configurable; printout photos deleted once approved; medicines/patients/stock will be imported from **KivHealth**; no medicine box-photo reading; updates to you in plain language; agents run one at a time when they share files; handoff + task list updated every session.

### Stopped at your request
- F13 (Approve button on the Machines screen + "Scan biometry report" in OT) was just starting; stopped before it saved anything. The server side for both is already done.
- F16 (re-dressing the app in the official design system) was also just starting; stopped before it changed any screen. The design system itself is now copied into the repo at `gurukrupa-system\design-system\` (with your logo JPG added under `assets/Logos/`).

### Design system — decisions taken so the restyle can start straight away
- Hospital name everywhere: **Guru Krupa Eye Hospital & Laser Center** (logo and client notes agree; the prototype's "Research Center" is wrong).
- Logo: your `logo.jpg` for now; ask the clinic for a **vector** logo (SVG/AI/PDF) — the design system needs it for the side menu, favicon and prescription head.
- No emoji in the product; buttons say what they do ("Add to queue", "Print prescription").

### Next session — do in this order
0. **F16** — re-dress the app in the design system (one agent, it touches every screen). Do this first so later screen work is built on the final look.
1. **F13** — Approve button on Machines (photo disappears after approval) + "Scan biometry report" button in OT pre-op.
2. **F11** — switch the app from demo data to the real server and click through every screen; fix the small mismatches that always show up here.
3. **B12** — OT time slots and procedure list editable by the admin.
4. **B13 / F15** — KivHealth import (upload spreadsheet, match columns, preview) — start as soon as the sample file arrives; can be built generically before then.
5. **B14** — decide and implement how long OT consent photos / exam photos are kept.
6. Push to GitHub, then server setup (G6) when you're ready.

### Waiting on you / the clinic
- **KivHealth sample export** (Excel/CSV) from the clinic team → drop in `ref files\`.
- **Dr Anu:** confirm staff roles and who sees which screens; decide whether OT consent photos are kept and for how long exam photos are kept.
- **WhatsApp intake decisions:** data destination (Gurukrupa app assumed); official WhatsApp Business API vs linked-phone pilot, and which provider is behind the Postman link; extra questions; whose number. Also: should gender be asked before age so the honorific can be used earlier?
- **Vector logo** from the clinic (SVG preferred).
- **More printout photos:** YPC-100K (none yet), HNT-1P with different row counts, HRK with one eye only / plus values, phone photos at an angle or with glare, a post-cataract biometry report.
- Change the admin password (`admin` / `admin123`) before anything goes near the clinic.

### How to run it yourself (for a look)
1. Server: PowerShell in `gurukrupa-system\backend` → `.venv\Scripts\uvicorn app.main:app --reload` → http://localhost:8000/docs
2. Screens: PowerShell in `gurukrupa-system\frontend` → `npm run dev` → http://localhost:5173 (demo data; log in admin/admin)
3. WhatsApp form on your PC: PowerShell in `gurukrupa-system\whatsapp-intake` → `.venv\Scripts\python simulate.py gurukrupa`
4. QR page: `.venv\Scripts\uvicorn app.main:app --port 8010` in the same folder → http://localhost:8010/qr/gurukrupa

### Key locations
- Project: `C:\ai4work\Dr Anu - Opthamologist\gurukrupa-system` (backend, frontend, whatsapp-intake, deploy, docs)
- Reference files you gave me: `C:\ai4work\Dr Anu - Opthamologist\ref files\`; the WhatsApp intake spec: `patient-intake-form-CLAUDE.md`
- Real printout samples + answer key: `gurukrupa-system\backend\tests\ocr_samples\`
- Tesseract (printout reading engine): `C:\FPI\tesseract`
- PostgreSQL 18: `C:\Program Files\PostgreSQL\18` (app login `gurukrupa` / `gurukrupa`, local only)
- WhatsApp provider API link: `Whatsapp API.txt`
