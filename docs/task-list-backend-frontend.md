# Task List — Gurukrupa Eye Hospital Core Tool

**Live status board.** Updated at the end of every working session together with `handoff.md`.
Last updated: **2026-09-19 (end of session 1)**

Status key: ✅ Done · 🔄 In progress · ⏳ Not started · ⛔ Blocked/waiting on someone · 🧪 Done, needs real-world check

Source of truth for every screen's look and behaviour: `guru-krupa-eye-hospital-mockup.html` (copy in `gurukrupa-system/docs/mockup-reference.html`).

---

## Summary

**Overall progress: 68%** (32 of 47 tasks done)

| Area | Done | In progress | Not started | Blocked | % complete |
|---|---|---|---|---|---|
| Backend (server side) | 14 | 0 | 3 | 0 | 82% |
| Frontend (screens) | 13 | 0 | 4 | 0 | 76% |
| Data & go-live | 2 | 0 | 4 | 2 | 25% |
| WhatsApp intake | 3 | 0 | 1 | 1 | 60% |
| **Total** | **32** | **0** | **12** | **3** | **68%** |

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
| B12 | OT time slots & procedure list made admin-configurable | ⏳ | Currently fixed in code (9:00–4:30, 45-min slots) |
| B13 | Import from KivHealth: medicines, patients, stock (spreadsheet upload with column matching + preview) | ⏳ | ⛔ waiting on sample export from the clinic team |
| B14 | Retention rule for OT consent photos / exam photos | ⏳ | Decision needed: keep consent photos? delete exam photos after X months? |

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
| F11 | Connect every screen to the real server instead of demo data; full click-through test | ⏳ | Next after F13 |
| F12 | Show brand / composition / type on prescription & print; Admin tabs for medicines & types | ✅ | Admin can add a medicine straight from the prescription form |
| F13 | "Approve reading" button on Machines (photo disappears after approval); scan biometry report in OT | ⏳ | **First task next session** (server side is ready) |
| F14 | Open prescription from the Queue drawer; "Rx" in the mobile menu | ✅ | |
| F15 | KivHealth import screen (upload, match columns, preview) | ⏳ | After B13 |
| F16 | Re-dress every screen in the official design system (`gurukrupa-design-system`: colours, 3 typefaces, 32 components, new side menu + bottom tab bar, wording rules) | ⏳ | Design system copied into the repo; name settled as "Guru Krupa Eye Hospital & Laser Center"; vector logo still needed |

## Data & go-live

| # | Task | Status | Notes |
|---|---|---|---|
| G1 | Local database on your PC created, tables + starting data loaded | ✅ | Admin login: `admin` / `admin123` — change before go-live |
| G2 | Code saved in git (14 commits) | ✅ | |
| G3 | Push to GitHub `ankitaagr88/guru-krupa` | ⛔ | Needs you to run `git push -u origin main` (or allow me to) |
| G4 | Confirm roles & who sees which screens with Dr Anu | ⛔ | Waiting on Dr Anu |
| G5 | More real printout photos: YPC-100K (none yet), extra HNT-1P/HRK slips, phone photos at an angle | ⏳ | Improves reading accuracy |
| G6 | Set up the Hostinger server, domain, SSL | ⏳ | Scripts ready (B11) |
| G7 | First real import from KivHealth + staff logins created | ⏳ | After B13/F15 |
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
