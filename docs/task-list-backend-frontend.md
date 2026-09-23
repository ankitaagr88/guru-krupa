# Task List — Gurukrupa Eye Hospital Core Tool

**Live status board.** Updated at the end of every working session together with `handoff.md`.
Last updated: **2026-09-23 (session 3)**

Status key: ✅ Done · 🔄 In progress · ⏳ Not started · ⛔ Blocked/waiting on someone · 🧪 Done, needs real-world check · ⏸ Parked at your request

Source of truth for behaviour: `guru-krupa-eye-hospital-mockup.html` (copy in `gurukrupa-system/docs/mockup-reference.html`). Source of truth for the look: `gurukrupa-system/design-system/` (brand book, tokens, components).

---

## Summary

**Overall progress: 86%** (56 of 65 tasks done)

| Area | Done | In progress | Not started | Blocked | % complete |
|---|---|---|---|---|---|
| Backend (server side) | 17 | 0 | 1 | 0 | 94% |
| Frontend (screens) | 22 | 0 | 0 | 0 | 100% |
| Improvements from the session-2 review | 8 | 0 | 0 | 0 | 100% |
| New requests (N1–N3) | 3 | 0 | 0 | 0 | 100% |
| Data & go-live | 3 | 0 | 4 | 2 | 33% |
| WhatsApp intake | 3 | 0 | 1 | 1 | 60% |
| **Total** | **56** | **0** | **6** | **3** | **86%** |

How the % is worked out: done = 1, in progress = ½, not started / blocked = 0, divided by the number of tasks in that area.

---

## Backend (server side)

| # | Task | Status | Notes |
|---|---|---|---|
| B0 | Project setup, database connection, test setup | ✅ | Runs on Postgres; tests use a throwaway database |
| B1 | Staff login, passwords, roles & permissions | ✅ | Roles: admin, doctor, optometrist, reception, OT staff — **confirm with Dr Anu** |
| B2 | All data tables + starting data (stages, drops routine, referral sources, lens prices, medicines, stock) | ✅ | 24 tables |
| B3 | Patients & queue (register, daily token, stage moves, waiting time, search) | ✅ | Clinic day follows India time |
| B4 | Appointments (day-based, check-in into queue) | ✅ | |
| B5 | Dilation drops routine with timers | ✅ | First drop is ticked by the technician, as in the mockup |
| B6 | Machine printout reading (photo → numbers) | ✅ | Reads all real samples correctly (HRK-8000A ×2, CLM-1, HNT-1P); one HRK photo fills both refraction + keratometry; HBM-1 biometry report fills OT pre-op fields. More samples wanted (G5) |
| B6b | Approve reading → delete the photo; auto-clean old photos | ✅ | Photo deleted on approval; unapproved photos purged after 7 days |
| B7 | OT / surgery (calendar slots, pre-op, notes, consent photos, billing) | ✅ | Biometry report will auto-fill pre-op numbers (part of B6) |
| B8 | Prescriptions, stock deduction, Hinglish/Gujlish print, billing | ✅ | |
| B8b | Medicine master: brand, composition, type, strength, pack size, maker | ✅ | Types (drops, gel, tablet, syrup, gummies…) are admin-configurable |
| B9 | Admin settings (stages, drops routine, referral sources, lens tiers, staff, medicines, medicine types) | ✅ | |
| B10 | Medical-rep (MR) visit log | ✅ | |
| B11 | Server deployment scripts (Hostinger VPS), backups | ✅ | Not yet run on a real server |
| B12 | OT time slots & procedure list made admin-configurable | ✅ | Done 2026-09-20: Admin → OT time slots (add / switch off / regenerate a grid) and OT procedures (add / rename / reorder / switch off); booked slots protected |
| B13 | Import from KivHealth: medicines, patients, stock (spreadsheet upload with column matching + preview) | ✅ | Built 2026-09-20 generically: CSV/Excel upload, auto column matching (KiviHealth headers known), preview, run; patients / medicines / stock / prescriptions. 🧪 Needs the real export files to confirm the matching |
| B14 | Retention rule for OT consent photos / exam photos | ⏳ | Decision needed: keep consent photos? delete exam photos after X months? |
| B15 | Treatment standards per diagnosis/symptom: (a) admin-set list of medicines + dosages (one-time setup by Dr Anu); (b) where none is set, the most common prescription **across all patients** with that diagnosis from KiviHealth history + new Rx; **statistics only, no AI** | ✅ | Done 2026-09-20: diagnoses list (11 starters, editable), standards API, history counting (medicine in ≥50% of past Rx, most-written dosage). KiviHealth history will feed it once imported (B13) |

## Frontend (screens)

| # | Task | Status | Notes |
|---|---|---|---|
| F0 | App shell: navigation, mobile layout, search (Ctrl+K), pop-ups, toasts, offline banner, installable app | ✅ | Demo-data mode lets screens work without the server |
| F1 | Login screen | ✅ | |
| F2 | Queue board + patient details drawer + new patient + billing | ✅ | |
| F3 | Dilation checklist with countdowns | ✅ | |
| F4 | Appointments | ✅ | |
| F5 | Machines: pick patient & machine, take photo, offline queue, review numbers | ✅ | |
| F6 | OT calendar & case details | ✅ | |
| F7 | Prescription form + print | ✅ | |
| F8 | Stock (inventory) screen | ✅ | |
| F9 | Admin screen | ✅ | |
| F10 | MR visits screen | ✅ | |
| F11 | Connect every screen to the real server instead of demo data; full click-through test | ✅ | Done 2026-09-20: every screen + every write flow exercised against the live server and PostgreSQL (desktop + phone); no mismatches; one fix ("Last visit" excludes the visit just finished). F13 also verified on the real server |
| F12 | Show brand / composition / type on prescription & print; Admin tabs for medicines & types | ✅ | 2026-09-20: simplified to **name only** per Dr Anu's team / KiviHealth (details removed from all screens, Medicine types tab hidden) |
| F13 | "Approve reading" button on Machines (photo disappears after approval); scan biometry report in OT | ✅ | Done 2026-09-20. Approve stamps who/when, deletes the photo; OT pre-op "Scan biometry report" fills the grid and names any value it could not read. verified on the real server 2026-09-20 |
| F14 | Open prescription from the Queue drawer; "Rx" in the mobile menu | ✅ | |
| F15 | KiviHealth import screen (upload, match columns, preview) | ✅ | Admin → Import from KiviHealth: 4-step screen, done 2026-09-20 |
| F17 | Prescription auto-fills when a diagnosis is picked (B15); Admin page "Diagnoses & treatment standards": add/rename/reorder, per-diagnosis editor starting from the history-derived set | ✅ | Done 2026-09-20; verified on the real server |
| F18 | **Patient screen** (`/patients/:id`): full record — details, every visit with readings / prescription / bill / photos / notes, surgeries, appointments; every patient name in the app links to it | ✅ | Done 2026-09-20 |
| F21 | Staff mobile number on logins; patient/case window centred at 75% | ✅ | Done 2026-09-20 |
| F20 | Stock screen rework (problems first, one action per row, last received, no ± buttons) and Admin jump list | ✅ | Done 2026-09-20 after user review |
| F19 | **Stock: Ordered / Received with quantities** (alert quiet while on order; shortfall stays on order) and **billing confirms each medicine bought** ("Bought here" per line is the only thing that deducts stock; doctor's qty = "to give") | ✅ | Done 2026-09-20 |
| F16 | Re-dress every screen in the official design system (colours, 3 typefaces, components, labelled side menu + bottom tab bar, wording rules) | ✅ | Done 2026-09-20: every screen, login, drawers, modals, toasts, print sheet. No emoji anywhere. Name is "Guru Krupa Eye Hospital & Laser Center" throughout. Logo updated 2026-09-23 from the clean PNG (see R7); a vector (SVG) version would still be nicer but is no longer blocking |

## Improvements from the session-2 review

Built on 2026-09-23 by three helpers working side by side (A = reception, B = billing, C = doctor's panel), joined together and clicked through on the real database (desktop + phone). Fixed during the click-through: phone search ignoring spaces, search opening the record for patients not in today's queue, Appointments "Another day" picker, and "Other" as sex crashing registration.

| # | Task | Status | Notes |
|---|---|---|---|
| R1 | Duplicate-patient check by phone on "New patient" | ✅ | Built (A): after 10 digits, lists everyone on that number — "Use this patient" (today's queue, no second record) or "No — new patient". Ignores spaces / +91 so KiviHealth numbers match |
| R2 | Billing: standard charges, medicine prices (bought-here adds to bill), receipt print, daily collection total | ✅ | Built (B): Admin → Standard charges (4 starters at ₹0 — **Dr Anu to set amounts**); one-tap charges on the bill, amounts editable; price per medicine in Admin → Medicines, "Bought here" adds "name × qty", Undo removes it, no price → ₹0 flagged red; receipt numbers GK-2026-00001 and an A5 printable receipt |
| R3 | Doctor's panel: diagnosis on the panel (fills Rx), follow-up date → auto appointment | ✅ | Built (C): Diagnosis picker fills the usual medicines (asks before replacing); follow-up 1 wk / 2 wk / 1 mo / 3 mo / date + note books the appointment, tagged "Follow-up", printed as "Next visit"; "No follow-up" removes it |
| R4 | Date of birth instead of fixed age | ✅ | Built (A): DOB in new-patient form, registration drawer and patient page; age worked out; a told age now grows with the calendar; KiviHealth import reads a DOB column, falls back to Age |
| R5 | "Today" summary: patients, time per stage, collections, medicines sold | ✅ | Built (B): new "Today's summary" page (admin, doctor, reception) — patients seen, average time per visit and per stage, money by payment mode, unpaid bills, medicines sold, receipts with reprint, earlier days |
| R6 | Small annoyances: visible search box, hide demo button, Save/Saved state, edit patient from record | ✅ | Built (C + A): search box in the top bar ("/" or Ctrl+K); demo-only buttons hidden outside demo mode; Save / Saving… / "Saved at 10:42 am" + unsaved-changes warning; "Edit details" on the patient page |
| R7 | New logo (`GK LOGO NEW.png`): full logo on login + prescriptions, symbol-only in menu, browser tab and phone icon | ✅ | Built (C); old blurry JPG removed |
| R8 | Printed prescription came out blank (old print rule hid everything) | ✅ | Found by B while testing the receipt; fixed and confirmed with a real print 2026-09-23 |

## New requests (2026-09-23)

| # | Task | Status | Notes |
|---|---|---|---|
| N1 || ✅ | Built (helper D), checked on the real database: QR poster in Admin (English / Gujarati / Hindi), patient fills it on their phone, lands in today's queue with a token and a note for reception; staff use the same form ("New patient form" button). **Gujarati/Hindi wording to be checked by a native reader.** Works on phones once the app is on the rented server (same Wi-Fi only until then) |
| N2 | **Families on one mobile number**: the number's owner (e.g. parent) + other patients on it, each with a relation (Son, Daughter, Spouse… — list editable in Admin) | ✅ | Built (helper E1) and checked on the real database: \"Add as a family member\" with relation on the new-patient forms; \"Family on this number\" card + \"Son of …\" line on the patient page (change relation / make owner / remove / add member); family prompt in the registration drawer; relation shown in search and queue; Admin → Family relations (editable list) + \"Group patients who share a number\" for after the KiviHealth import. Public QR form never reveals or links anyone. **Question:** \"Add family member\" from the patient page saves without queueing — OK? |
| N3 | **Follow-up or new issue → the right fee**, from Dr Anu's fee sheets: new patient ₹700; back within 6 days free; 7 days–6 months follow-up ₹350; after 6 months or a different problem new case ₹500; emergency ₹1000 suggested 8 pm–8 am and Sundays; tests with one-eye / both-eyes prices (Perimetry, Fundus photo, Macular OCT, RNFL, CCT) and two packages. All limits and prices editable in Admin | ✅ | Built (helper E2) and checked on the real database (new patient / free follow-up after 3 days / follow-up after 40 days / new case after 200 days; bill pre-filled; Perimetry both eyes). Fee list loaded; everything editable in Admin → Standard charges and Visit types & fees. **To confirm with Dr Anu:** after-surgery rule (now free for 30 days), 6 months = 182 days, delete the switched-off Pre-test / Dilation charges? |
| N4 | Returning-patient QR (type your number, say what the problem is) | ⏸ | Skipped for now at your request — reception handles returning patients at the desk |

## Data & go-live

| # | Task | Status | Notes |
|---|---|---|---|
| G1 | Local database on your PC created, tables + starting data loaded | ✅ | Admin login: `admin` / `admin123` — change before go-live |
| G2 | Code saved in git (63 commits) | ✅ | |
| G3 | Push to GitHub `ankitaagr88/guru-krupa` | ✅ | Pushed 2026-09-23 (63 commits, `5363da0`); push after each session |
| G4 | Confirm roles & who sees which screens with Dr Anu | ⛔ | Waiting on Dr Anu |
| G5 | More real printout photos: YPC-100K (none yet), extra HNT-1P/HRK slips, phone photos at an angle | ⏳ | Improves reading accuracy |
| G6 | Set up the server, domain, SSL — **a small rented server (VPS) in an Indian data centre (DPDP Act)**, e.g. DigitalOcean Bangalore / Linode Mumbai / E2E Networks | ⏳ | Decided 2026-09-20. Scripts ready (B11). Start small; migrate to AWS Mumbai later if the business grows (restore backup + copy photos + re-point domain — no provider-specific code)  **Recommended buy (2026-09-23):** DigitalOcean Bangalore — Basic Droplet 2 GB / 1 CPU / 50 GB ($12) + Daily backups ($3.60) + Spaces ($5) ≈ $20.60/month + GST |
| G6a | **Data never lost:** nightly Postgres + photo backup on the server (30 days) + automatic off-site copy to Indian object storage + a copy pulled to the clinic laptop **at start-up and mid-day** (machines are off by 8 pm, so nothing nightly on the clinic side); missed-backup alert; restore drill documented and tested before go-live; later an Admin "download my data" export | ⏳ | Firm requirement from the user 2026-09-20 |
| G7 | First real import from KiviHealth + staff logins created | ⛔ | Import screen ready; waiting on the export files |
| G8 | Staff training / first day at the clinic | ⏳ | |

---

## WhatsApp new-patient intake (separate tool, reusable for other clinics)

| # | Task | Status | Notes |
|---|---|---|---|
| W1 | Conversation flow in Gujarati/Hindi with tap buttons, per the spec | ✅ | Honorific starts from the address question (gender is asked after age) |
| W2 | Details land in the Gurukrupa patient list (with Google Sheet / CSV alternatives) | ✅ | Retries automatically if the clinic system is down |
| W3 | Printable QR page + on-PC simulator | ✅ | |
| W4 | Connect a real WhatsApp Business number | ⛔ | Decisions needed: provider (official API vs linked phone), whose number, data destination, extra questions |
| W5 | Pilot at the front desk | ⏳ | After W4 |

## Out of scope for this build
WhatsApp follow-up reminders and care messages (later phase). API reference kept in `Whatsapp API.txt`.
