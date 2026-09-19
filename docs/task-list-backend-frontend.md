# Task List — Gurukrupa Eye Hospital Core Tool

Companion to `vscode-parallel-agents-setup.md`. Source of truth for every data shape and behaviour: `guru-krupa-eye-hospital-mockup.html` (function/variable names below point into it). Phase 2 (WhatsApp) is out of scope.

Legend: **[A1]**…**[A4]** = which parallel agent owns the task. ☐ = to do.

---

## BACKEND (FastAPI + PostgreSQL) — Agent 1 owns the foundation; A2/A3/A4 add their module's endpoints once A1 lands

### B0. Project bootstrap [A1]
- ☐ `backend/` skeleton: `app/main.py`, `app/models/`, `app/routes/`, `app/auth/`, `app/ocr/`, `app/schemas/` (Pydantic), `app/db.py`
- ☐ `requirements.txt` (fastapi, uvicorn, sqlalchemy, alembic, psycopg[binary], passlib[bcrypt], python-jose, python-multipart, python-dotenv, pillow, opencv-python-headless, pytesseract, pytest, httpx)
- ☐ `.env.example` (DATABASE_URL, SECRET_KEY, JWT_EXPIRE_MIN, UPLOAD_DIR, TESSERACT_CMD)
- ☐ `docker-compose.yml` with PostgreSQL 15 for local dev
- ☐ Alembic init + first migration
- ☐ CORS config for the Vite dev server; `/health` endpoint
- ☐ pytest fixtures: test DB, test client, seeded admin user

### B1. Auth & roles [A1]
- ☐ `staff` table: id, name, username, password_hash, role, active, created_at
- ☐ Roles enum: `admin`, `doctor`, `optometrist`, `reception`, `ot_staff` (confirm with Dr Anu — the mockup has no login screen)
- ☐ `POST /auth/login` → JWT (bcrypt verify); `GET /auth/me`
- ☐ `require_role(...)` dependency; permission matrix per route (Admin config = admin only; OT operative notes = doctor/ot_staff; prescriptions = doctor; queue moves = any staff)
- ☐ Seed script: first admin user
- ☐ Tests: login ok/fail, expired token, role denial

### B2. Core schema & migrations [A1]
Tables mirror the mockup shapes (`STAGES`, `PROTOCOL_STEPS`, `REFERRAL_SOURCES`, `patients`, `appointments`, `INVENTORY`, `mrVisits`, `LENS_TIERS`, `otCases`, `TEST_TYPES`):
- ☐ `patients` — name, age, sex, phone, address, occupation, screen_hours, language (gujarati/hindi/english/null), elsewhere (bool), note, referral_source_id, referral_detail, existing_conditions (JSONB array from `CONDITIONS`), condition_other, created_at
- ☐ `visits` — patient_id, date, token (`#014` style, resets daily), stage_key, stage_entered_at, va_r, va_l, status
- ☐ `stages` — key, label, cls, sort_order (seed: reg, pretest, doctor, dilate, billing, done)
- ☐ `protocol_steps` — name, minutes, sort_order (seed: Tropicamide 0.8% 5 min, Cyclopentolate 1% 20 min)
- ☐ `referral_sources` — key, label, needs_detail (seed the 7 from the mockup; `doctor` and `patient` need detail)
- ☐ `readings` — visit_id, machine_key, source (`scanned`/`manual`), captured_at, image_path, status (`pending`/`processing`/`done`/`failed`), values (JSONB `[{l,v}]`), confidence
- ☐ `exam_photos` — visit_id, image_path, captured_at
- ☐ `dilation_runs` + `dilation_steps` — visit_id, current_index; step name, minutes, given, started_at, done
- ☐ `bills` + `bill_items` — visit_id, label, amount, payment_mode (cash/upi/card/mediclaim)
- ☐ `medicines` — name (master list, seed the 10 from `MEDICINE_LIST`)
- ☐ `inventory_items` — medicine_id/name, unit (bottles/tubes/strips), stock, reorder_level
- ☐ `stock_movements` — item_id, delta, reason (dispensed/adjusted/received), ref_prescription_id, by_staff_id, at
- ☐ `prescriptions` + `prescription_lines` — visit_id, medicine name, matched (bool), dosage (treatment plan), qty_given (from inventory), print_language
- ☐ `appointments` — name, phone, date (date only — no time slots), channel (whatsapp/call/walkin), checked_in, patient_id (nullable, set on check-in)
- ☐ `ot_cases` — patient_id/name, age, sex, date, time_slot, procedure, status (scheduled/in_progress/completed/cancelled), pre_op_biometry JSONB (AL/ACD/K1/K2/targetRefraction × R/L), operative JSONB, post_op JSONB, billing JSONB (lens_tier, mediclaim, payment_mode)
- ☐ `ot_consent_photos` — ot_case_id, image_path, captured_at
- ☐ `lens_tiers` — key, label, price (seed: monofocal 28500, multifocal 45000, toric 38000)
- ☐ `mr_visits` — rep_name, company, phone, products, visit_date, next_visit_date, notes
- ☐ `audit_log` — who/what/when for stage moves, stock adjustments, deletions
- ☐ Alembic migration + seed script for all reference tables

### B3. Patients & Queue API [A1 → A2 extends]
- ☐ `POST /patients` (new patient = `addNewPatient` fields) · `GET /patients?q=` (name/phone search for `openSearchModal`) · `GET /patients/{id}` (summary + history = `patientHistory`, `lookupLastVisit`)
- ☐ `PATCH /patients/{id}` (detail edits: `onDetailInput`, conditions, referral, language, sex)
- ☐ `POST /visits` (register today's visit, auto-token) · `GET /visits/today?stage=` (queue board)
- ☐ `POST /visits/{id}/move` — stage change with `stage_entered_at` reset, validation of allowed transitions (`moveTo` / `moveToWithConfirm`)
- ☐ `PATCH /visits/{id}/va` (VA R/L)
- ☐ `POST /visits/{id}/complete` (`recordVisitCompletion` → updates last-visit date)
- ☐ Waiting-time: return raw timestamps, compute `fmtElapsed` / `computeRowStatus` thresholds client-side (document the thresholds once)
- ☐ Tests: token sequencing, stage transitions, search

### B4. Appointments API [A2]
- ☐ `GET /appointments?date=` · `POST /appointments` · `PATCH /appointments/{id}` · `DELETE`
- ☐ `POST /appointments/{id}/checkin` → creates/links patient + today's visit at `reg` (`checkInAppointment`)
- ☐ Day-strip counts: `GET /appointments/counts?from=&to=` (for `buildDateStrip`)

### B5. Dilation protocol API [A2]
- ☐ `POST /visits/{id}/dilation/start` — copies current `protocol_steps` into a run (`startDilationProtocol`)
- ☐ `POST /visits/{id}/dilation/steps/{n}/given` · `.../done`; auto-advance rule (`tickStep`, `checkTimers`) — timers stay client-side, server stores `started_at`
- ☐ `GET /visits/{id}/dilation` for `renderDilationChecklist`

### B6. Machines / OCR API [A3]
- ☐ `POST /readings` (multipart: visit_id, machine_key, image, client_captured_at, client_uuid for idempotent offline retry) → returns `pending`
- ☐ Background task (FastAPI BackgroundTasks now; a worker queue later if needed): preprocess → Tesseract → parse → store values, status `done`/`failed`
- ☐ `GET /readings/{id}` (poll) · `GET /visits/{id}/readings` · `PATCH /readings/{id}/values` (manual correction = `applyExtractedReading`)
- ☐ `app/ocr/preprocess.py`: deskew, crop to template ROI, grayscale, threshold, upscale
- ☐ `app/ocr/templates/` — one parser per machine (7 keys from `TEST_TYPES`): HNT-1P Tono-Pachy (IOP/CIOP/CCT), HRK-8000A REF (SPH/CYL/AX/PD), HRK-8000A KER (K1/K2), CLM-1 Lensmeter (SPH/CYL/AXS), YPC-100K REF, YPC-100K KER, TBUT/Schirmer (manual-entry only)
- ☐ Value sanity checks per field (SPH range, AX 0–180, IOP range, CCT range) → flag low-confidence
- ☐ `POST /visits/{id}/exam-photos` · `DELETE` (`attachExamPhoto` / `removeExamPhoto`)
- ☐ Real printout photos from the hospital in `backend/tests/ocr_samples/` + accuracy tests per template
- ☐ Upload storage: local `UPLOAD_DIR` on the VPS, served via Nginx on an auth-protected path

### B7. OT / Surgery API [A3]
- ☐ `GET /ot/cases?date=` · `POST /ot/cases` · `PATCH /ot/cases/{id}` (nested section updates: biometry, operative, post_op, billing)
- ☐ `POST /ot/cases/{id}/status` (`setOtStatus`)
- ☐ Time-slot calendar: `GET /ot/slots?date=` with conflict check on create/move
- ☐ `POST /ot/cases/{id}/consent-photos` · `DELETE`
- ☐ `GET /lens-tiers` · surgical bill computation (lens tier price + mediclaim flag + payment mode)

### B8. Prescription & Inventory API [A4]
- ☐ `GET /medicines?q=` (datalist autocomplete = `buildMedDatalist`)
- ☐ `POST /visits/{id}/prescription` — lines with `dosage` (treatment plan) and `qty_given`; on save decrement inventory only by `qty_given` (`decrementInventory`), write `stock_movements`, transaction-safe
- ☐ `GET /visits/{id}/prescription/print?lang=hinglish|gujlish|english` → print payload (`setLanguage`)
- ☐ Unmatched medicine names (`matched:false`) → stored as free text; admin can promote to master list
- ☐ `GET /inventory` · `POST /inventory` · `PATCH /inventory/{id}/adjust` (`adjustStock`) · `GET /inventory/low` (stock ≤ reorder → `pushLowStockToast`)
- ☐ `POST /visits/{id}/bill` · `PATCH /bills/{id}/payment` (`addBillItem`, `selectPaymentMode`)

### B9. Admin config API [A4]
- ☐ CRUD + reorder: `/admin/stages`, `/admin/protocol-steps`, `/admin/referral-sources` (`addStage`, `renameStage`, `deleteStage`, `moveProtocolStep`, …) — block deleting a stage that has active visits
- ☐ `/admin/staff` CRUD + role assignment + reset password (admin only)
- ☐ `/admin/lens-tiers` CRUD

### B10. MR visits API [A4]
- ☐ `GET /mr-visits?rep=` · `POST` · `PATCH` · `DELETE`; `GET /mr-visits/reps` (rep history grouping for `openMrDetail`)

### B11. Deployment [A1, end]
- ☐ systemd unit for uvicorn; Nginx site config (`/api` → 8000, `/` → built frontend, `/uploads` protected)
- ☐ Certbot; `.env` on VPS; nightly `pg_dump` cron to off-box storage
- ☐ `deploy.sh`: `git pull` → `alembic upgrade head` → `npm run build` → restart

---

## FRONTEND (React + Vite PWA) — Agents 2, 3, 4; shared shell by A2 first

### F0. Bootstrap & shared shell [A2 — do first, merge early so A3/A4 build on it]
- ☐ Vite + React + React Router + vite-plugin-pwa + idb + axios scaffold
- ☐ Port mockup CSS tokens (teal, coral, surface, line, Manrope/Inter fonts) into a global stylesheet
- ☐ Layout: left rail (`buildRail`), top title bar (`setTopTitle`), mobile bottom nav / drawer (`buildMobileNav`, `openMobileNav`)
- ☐ Device mode detection (`setDeviceMode`) — mobile vs desktop views
- ☐ `api/` client: axios instance, JWT header injection, 401 → redirect to login
- ☐ Auth context (`currentUser`, role) + `<RequireRole>` route guard
- ☐ Shared components: Modal, Drawer, Toast (`pushToast`), DateStrip (`buildDateStrip`), PatientCard, SearchModal (`openSearchModal` / `renderSearchResults`), ConnectivityBanner (`renderConnectivityBanner`, `isOffline`)
- ☐ Routes: `/login /queue /queue/:stage /appointments /machines /ot /inventory /admin /mrs`
- ☐ Vitest + React Testing Library setup
- ☐ Mock-data mode (`VITE_USE_MOCKS=1`) using the mockup's arrays so A3/A4 can work before backend endpoints exist

### F1. Login [A4]
- ☐ Login screen (username/password), error states, session persistence (token in localStorage), logout in rail
- ☐ Role-based rail items (hide Admin for non-admins, etc.)

### F2. Queue [A2]
- ☐ Stage screens (`renderStageScreen`, `rowHtml`, `patientCardHtml`) — desktop table + mobile cards
- ☐ Waiting-time ticker (`tickClock`, `fmtElapsed`, `computeRowStatus` colour thresholds)
- ☐ Move-to-stage action with confirmation where the mockup requires it (`moveToWithConfirm`)
- ☐ Patient detail drawer (`openDrawer`): summary (`renderPatientSummary`), editable details (`onDetailInput`, sex, language, referral source/detail with `REFERRAL_NEEDS_DETAIL`), existing-conditions grid (`buildConditionGrid`, `toggleCondition`, `onConditionOtherInput`), "treated elsewhere" toggle, VA inputs (`onVAInput`), readings (`renderReadings`), exam photos (`renderExamPhotos`), last-visit lookup (`fmtLastVisit`)
- ☐ New-patient modal (`addNewPatient`, `npToggleElsewhere`, `setNpLanguage`, `setNpSex`, `onNpReferralChange`, `toggleNpCondition`)
- ☐ Billing stage panel (`renderBilling`, `addBillItem`, `removeBillItem`, `selectPaymentMode`)
- ☐ Done stage → `recordVisitCompletion`
- ☐ Jump-to-patient from search (`jumpToPatient`)
- ☐ Polling / refresh strategy for the shared board (simple interval; SSE later if needed)

### F3. Dilation protocol [A2]
- ☐ Dilation checklist in drawer (`renderDilationChecklist`, `startDilationProtocol`, `tickStep`, auto-advance, `checkTimers`, reminder toast `reminProtocolStep`)
- ☐ Timer survives page reload (recompute from `started_at`)

### F4. Appointments [A2]
- ☐ Day strip + list (`renderAppointments`, `renderApptList`, `selectApptDate`)
- ☐ Add-appointment modal (`openApptModal`, `selectApptChannel` whatsapp/call/walkin) — date only, no time slots
- ☐ Check-in → creates visit and navigates to Queue (`checkInAppointment`)

### F5. Machines / OCR [A3]
- ☐ Machines screen: patient picker with filter (`filterMachinePatients`, `selectMachinePatient`, `changeMachinePatient`) → machine picker (`renderMachineOptions`, 7 `TEST_TYPES`)
- ☐ Capture area (`renderMachineCaptureArea`): mobile-only camera capture (`<input capture="environment">`), desktop shows a "use phone" hint
- ☐ Offline queue in IndexedDB (`pendingCaptures`, `captureMachineTest`): store blob + meta + client_uuid; `processPendingCaptures` on reconnect; PWA background sync where supported, fallback to `online`-event retry
- ☐ Reading status chips (pending / processing / done / failed) and poll until done (`markReadingProcessing`)
- ☐ Review/correct extracted values before applying (`applyExtractedReading`) — highlight low-confidence fields
- ☐ Manual-entry form for TBUT/Schirmer and as fallback for failed OCR
- ☐ Exam photo attach/remove (`attachExamPhoto`, `removeExamPhoto`)
- ☐ Offline demo toggle for testing (`toggleDemoOffline`)
- ☐ PWA manifest, icons (from `logo.jpg`), install prompt

### F6. OT / Surgery [A3]
- ☐ OT date strip + case list (`buildOtDateStrip`, `selectOtDate`, `renderOtList`) with real time slots
- ☐ New case modal (`openOtModal`, `addOtCase`) with slot conflict feedback
- ☐ Case detail (`openOtCase`): tabs — Pre-op biometry (AL/ACD/K1/K2/target, R+L), Operative (`updateOtField`, `updateOtNested`; surgeon defaults to Dr. Anu Juneja Pathak), Consent photos (`attachOtConsent`, `renderOtConsentList`, `removeOtConsent`), Post-op (`updateOtRx`, follow-up VA, next follow-up), Billing (`setOtLensTier`, `toggleOtMediclaim`, `setOtPayment`)
- ☐ Status change (`setOtStatus`) and close (`closeOtCase`)

### F7. Prescription [A4]
- ☐ Prescription modal (`openPrescriptionModal`): medicine datalist (`buildMedDatalist`), add manual/unmatched (`addMedManual`), dosage (`updateMedDosage`), remove (`removeMed`), `renderMeds`
- ☐ Treatment-plan vs quantity-given split per line; inventory availability inline; low-stock warning
- ☐ Language toggle (`setLanguage`) + print view (Hinglish / Gujlish / English) — print CSS, hospital header from `About the client.txt`, logo
- ☐ Photograph handwritten prescription fallback (`photographPrescription`)

### F8. Inventory [A4]
- ☐ Inventory screen (`renderInventory`): stock, unit, reorder level, low-stock highlight; add item (`addInventoryItem`), adjust (`adjustStock`) with reason
- ☐ Low-stock toast on dispense (`pushLowStockToast`) and movement history per item

### F9. Admin [A4]
- ☐ Admin screen (`renderAdmin`): Stages (add/rename/delete/reorder), Dilation protocol steps (name + minutes, `moveProtocolStep`, `renameProtocolStep`, `deleteProtocolStep`), Referral sources (add/rename/delete)
- ☐ Staff & roles management (list, add, role select, deactivate, reset password)
- ☐ Lens tiers & prices

### F10. MR visits [A4]
- ☐ MR list (`renderMRs`), add-visit modal (`openMrModal`, `addMrVisit`), rep detail/history (`openMrDetail`), next-visit-due indicator

### F11. Integration pass [all, after A1 merges]
- ☐ Replace mock adapters with real API calls module by module; keep `VITE_USE_MOCKS` working for demos
- ☐ Error/loading states on every screen; optimistic updates for stage moves
- ☐ Production build served by Nginx; PWA tested on Android Chrome at the clinic (camera + offline)
- ☐ Smoke test: register → pre-test capture (offline → online) → doctor → dilation → prescription (stock decrement) → billing → done; OT case end-to-end

---

## Suggested order
1. **A1:** B0 → B1 → B2 → B3 (publish the API contract via OpenAPI at `/docs`)
2. **A2:** F0 (merge to main ASAP) → F2 → F3 → F4 → B4/B5
3. **A3:** F5 → B6 (OCR is the riskiest — start collecting real printout photos on day 1) → F6 → B7
4. **A4:** F1 → F7 → F8 → F9 → F10 → B8/B9/B10
5. **All:** F11, then B11
