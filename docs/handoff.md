# Handoff — Gurukrupa Eye Hospital System

Updated at the end of every working session, together with `task-list-backend-frontend.md` (the live status board with % complete).

---

## Session 1 — 2026-09-19 (final update at session end)

### Where things stand (plain language)
The core tool is built end to end and runs on your PC against a real database: staff logins, patient queue, appointments, dilation timers, machine-printout reading (now accurate on the clinic's real slips), OT scheduling with biometry auto-fill, prescriptions with brand/generic/type and Hinglish/Gujlish printing, stock, admin settings, MR visits. A separate WhatsApp new-patient intake tool is also built and tested. **Overall progress: 70%.** All work is saved in git (14 commits) but **not yet on GitHub** — see "Waiting on you".

### Done this session
1. Whole backend (server side) and every screen, built by parallel agents, merged and tested (backend 121 automated checks, screens 71, WhatsApp tool 38 — all passing).
2. Local PostgreSQL database created (you reset the master password), tables + starting data loaded; app started against it and a test registration worked (test data then removed).
3. Printout reading tuned on your real PDFs: reads every number on the HRK-8000A (×2), CLM-1 and HNT-1P samples; one HRK photo fills both refraction and keratometry; the HBM-1 biometry/IOL report fills OT pre-op measurements. A hand-read answer key sits next to the samples.
4. Photo rule: approving a reading deletes its photo; unapproved photos are cleaned after 7 days.
5. Medicine list upgraded: brand, composition, type (admin-configurable list: drops, gel, ointment, suspension, tablet, capsule, syrup, gummies), strength, pack size, maker. Aquaray Gel and MOSI LP added from your photos. Prescription form, printout, Admin (Medicines + Medicine types tabs), stock screen and the queue's Prescription button all updated.
6. WhatsApp new-patient intake built from `patient-intake-form-CLAUDE.md`: Gujarati/Hindi tap-button conversation, patient lands in the Gurukrupa patient list, printable QR page, on-PC simulator, example second clinic.
7. Rules captured from you (saved for future sessions): everything category-like is admin-configurable; printout photos deleted once approved; medicines/patients/stock will be imported from **KivHealth**; no medicine box-photo reading; updates to you in plain language; agents run one at a time when they share files; handoff + task list updated every session.

### Stopped at your request
- F13 (Approve button on the Machines screen + "Scan biometry report" in OT) was just starting; the agent was stopped before it saved anything, so the code is clean. The server side for both is already done.

### Next session — do in this order
1. **F13** — Approve button on Machines (photo disappears after approval) + "Scan biometry report" button in OT pre-op.
2. **F11** — switch the app from demo data to the real server and click through every screen; fix the small mismatches that always show up here.
3. **B12** — OT time slots and procedure list editable by the admin.
4. **B13 / F15** — KivHealth import (upload spreadsheet, match columns, preview) — start as soon as the sample file arrives; can be built generically before then.
5. **B14** — decide and implement how long OT consent photos / exam photos are kept.
6. Push to GitHub, then server setup (G6) when you're ready.

### Waiting on you / the clinic
- **Push to GitHub:** in `gurukrupa-system\` run `git push -u origin main` (or allow `git push` for Claude).
- **KivHealth sample export** (Excel/CSV) from the clinic team → drop in `ref files\`.
- **Dr Anu:** confirm staff roles and who sees which screens; decide whether OT consent photos are kept and for how long exam photos are kept.
- **WhatsApp intake decisions:** data destination (Gurukrupa app assumed); official WhatsApp Business API vs linked-phone pilot, and which provider is behind the Postman link; extra questions; whose number. Also: should gender be asked before age so the honorific can be used earlier?
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
