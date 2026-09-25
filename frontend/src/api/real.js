/* Real axios adapters. Method names / return shapes match src/mocks/adapters.js.
   Endpoints that EXIST today (backend B0/B1): auth.login, auth.me, auth.health.
   Everything else follows the paths in docs/task-list-backend-frontend.md
   (B3–B10) and will 404 until the backend agent lands them — use
   VITE_USE_MOCKS=1 in the meantime. Screen agents: when your endpoint lands,
   fix the path here, not in the screen. */
import client from './client';

const data = (p) => p.then((r) => r.data);

export const auth = {
  login: ({ username, password }) => data(client.post('/auth/login', { username, password })),
  me: () => data(client.get('/auth/me')),
  health: () => data(client.get('/health')),
};

export const patients = {
  list: ({ q = '' } = {}) => data(client.get('/patients', { params: { q } })),
  get: (id) => data(client.get(`/patients/${id}`)),
  // The patient screen: {patient, visits:[{…, readings, prescription, bill, examPhotos}], otCases, appointments, totals}
  fullHistory: (id) => data(client.get(`/patients/${id}/history`)),
  create: (body) => data(client.post('/patients', body)),
  update: (id, patch) => data(client.patch(`/patients/${id}`, patch)),
  remove: (id) => data(client.delete(`/patients/${id}`)),
  history: (phone) => data(client.get('/patients/history', { params: { phone } })),
  conditions: () => data(client.get('/patients/conditions')),
  referralSources: () => data(client.get('/admin/referral-sources')),
  referralNeedsDetail: () => Promise.resolve(['doctor', 'patient']),
};

export const visits = {
  today: ({ stage } = {}) => data(client.get('/visits/today', { params: stage ? { stage } : {} })),
  counts: () => data(client.get('/visits/today/counts')),
  // B3: register today's visit for an existing patient (409 if one is already active today)
  create: (body) => data(client.post('/visits', body)),
  get: (id) => data(client.get(`/visits/${id}`)),
  // B3: PATCH /visits/{id} {note?, doctorNotes?, elsewhere?, elsewhereNote?, diagnosisId?}
  update: (id, patch) => data(client.patch(`/visits/${id}`, patch)),
  move: (id, stage) => data(client.post(`/visits/${id}/move`, { stage })),
  setVA: (id, va) => data(client.patch(`/visits/${id}/va`, va)),
  complete: (id) => data(client.post(`/visits/${id}/complete`)),
  dilation: (id) => data(client.get(`/visits/${id}/dilation`)),
  startDilation: (id) => data(client.post(`/visits/${id}/dilation/start`)),
  dilationStepGiven: (id, n) => data(client.post(`/visits/${id}/dilation/steps/${n}/given`)),
  dilationStepDone: (id, n) => data(client.post(`/visits/${id}/dilation/steps/${n}/done`)),
  clearDilation: (id) => data(client.delete(`/visits/${id}/dilation`)),
};

/* Per-visit bill, standard charges, part payments and receipts (lane B; payments: lane M).
   GET 404s until a bill exists; start() creates it with the visit's suggested fee lines (visit kind's
   charge + Emergency when flagged). PUT upserts {items:[{label, amount, kind?, qty?, standardChargeId?,
   prescriptionLineId?, eyes? ('one'|'both'), accountHeadKey? (day-book column; left out = worked out)}],
   paymentMode?}. BillOut: {id, visitId, items:[…, priceMissing, eyes, suggested, accountHeadKey], total,
   paymentMode (mode of the latest payment), paidAt (when the balance reached 0), paid (nothing left to
   collect), receiptNo, payments:[{id, amount, mode, at, byName, note}], paidAmount, balance (total −
   paidAmount; < 0 = money to give back), status ('unpaid'|'part_paid'|'paid'|'no_charge'|'overpaid'),
   patientId, patientName, token, visitDate, visitKindKey, visitKindLabel, emergency, feeNote}.
   The first payment gives the bill its receipt number. */
export const billing = {
  get: (visitId) => data(client.get(`/visits/${visitId}/bill`)),
  start: (visitId) => data(client.post(`/visits/${visitId}/bill/start`)),
  save: (visitId, bill) => data(client.put(`/visits/${visitId}/bill`, bill)),
  // Receive the whole balance in one mode (a ₹0 bill closes as "No charge"). → BillOut
  pay: (visitId, paymentMode) => data(client.post(`/visits/${visitId}/bill/pay`, { paymentMode })),
  // Receive part (or all) of the balance: {amount, mode, note?}; 422 over the balance, 409 nothing owed. → BillOut
  receive: (visitId, body) => data(client.post(`/visits/${visitId}/bill/payments`, body)),
  // Undo a payment entered by mistake. → BillOut
  undoPayment: (visitId, paymentId) => data(client.delete(`/visits/${visitId}/bill/payments/${paymentId}`)),
  // Close a ₹0 bill (free follow-up) as "No charge". → BillOut
  noCharge: (visitId) => data(client.post(`/visits/${visitId}/bill/no-charge`)),
  // A patient's bills with money still owed, oldest first:
  // [{visitId, patientId, name, token, visitDate, total, paidAmount, balance}]
  owing: (patientId) => data(client.get(`/patients/${patientId}/owing`)),
  // The active standard charges, in order, for the one-tap chips:
  // [{id, label, amount, amountBothEyes (null = one price), groupLabel, active, sortOrder}]
  charges: () => data(client.get('/standard-charges')),
};

/* Read-only reports — the "Today" summary page (lane B owns this block).
   today(date?) → {date, patients:{registered, seen, inProgress}, avgVisitMinutes, stages:[{key, label,
   avgMinutes, visits, waitingNow}], collections:{byMode:[{mode, bills (payments), amount}], total, billsPaid,
   unpaid:[{visitId, patientId, name, token, visitDate, total, paidAmount, balance}] ("money still owed":
   every bill still owing from that day or before), unpaidTotal (sum of balances)}, medicines:[{name, qty,
   amount}], medicinesQty, medicinesAmount, receipts:[{receiptNo, visitId, paymentId, name, token, total
   (this payment), billTotal, balance, paymentMode, paidAt}]}. Money counts by the day each payment was
   received. */
export const reports = {
  today: (date) => data(client.get('/reports/today', { params: date ? { date } : {} })),
};

/* Reception additions — duplicate-patient check etc. (lane A owns this block). */
export const reception = {
  // Everyone already registered with this number (last 10 digits compared), as PatientOut:
  // age, sex, lastVisitDate and — when they are in today's queue — visitId, token, stage.
  samePhone: (phone) => data(client.get('/patients/by-phone', { params: { phone } })),
};

/* New-patient form, /register (lane D owns this block). PUBLIC: no sign-in needed.
   lists() → {referralSources:[{key, label, needsDetail}], conditions:[…]}
   submit(body) → {token} (+ patientId, visitId when a staff member is signed in). Body = the
   new-patient questions + `website` (a hidden honeypot, always ''). 429 = too many from here. */
export const intake = {
  lists: () => data(client.get('/intake/lists')),
  submit: (body) => data(client.post('/intake', body)),
};

/* Families on one mobile number + admin relations list (lane E1 owns this block).
   get(patientId) → FamilyOut {patientId, ownerId (null = in no family), phone, members:[owner first, then
   members: {id, name, age, sex, phone, isOwner, relationKey, relationLabel, lastVisitDate}], samePhone:[others on
   the number who are not in this family, + familyOwnerId/familyOwnerName/familySize], message}. Every change
   answers with the fresh FamilyOut; `message` says what else changed (a phone that followed the owner…).
   PatientOut also carries familyOwnerId, relationKey, relationLabel, familyOwnerName, familySize; a PATCH
   answer carries familyPhoneUpdated (members whose phone followed the owner's new number). */
export const family = {
  get: (patientId) => data(client.get(`/patients/${patientId}/family`)),
  // join the family of ownerId (or of that person's owner); relationKey null = not set yet
  link: (patientId, ownerId, relationKey = null) =>
    data(client.post(`/patients/${patientId}/family`, { ownerId, relationKey })),
  setRelation: (patientId, relationKey) => data(client.patch(`/patients/${patientId}/family`, { relationKey })),
  // this member becomes the owner; the old owner becomes a member with `oldOwnerRelationKey` (null = not set)
  makeOwner: (patientId, oldOwnerRelationKey = null) =>
    data(client.post(`/patients/${patientId}/family/owner`, { oldOwnerRelationKey })),
  remove: (patientId) => data(client.delete(`/patients/${patientId}/family`)),
  // [{id, key, label, sortOrder, active, patientCount}] — switched-on ones unless includeInactive
  relations: ({ includeInactive = false } = {}) =>
    data(client.get('/relations', includeInactive ? { params: { includeInactive: true } } : undefined)),
  admin: {
    create: (label) => data(client.post('/admin/relations', { label })),
    update: (key, patch) => data(client.patch(`/admin/relations/${key}`, patch)),
    // 409 while patients have it: switch it off instead
    remove: (key) => data(client.delete(`/admin/relations/${key}`)),
    reorder: (keys) => data(client.put('/admin/relations/order', { keys })),
    // "Group patients who share a number" → {numbers, newFamilies, membersLinked, written, sample:[…]}
    groupingPreview: () => data(client.get('/admin/family/grouping')),
    groupingRun: () => data(client.post('/admin/family/grouping')),
  },
};

/* Visit kinds, fee rules and the suggested fee for a visit (lane E2 owns this block).
   kinds() → active [{id, key, label, standardChargeId, chargeLabel, chargeAmount (null = free), sortOrder, active}]
   rules() → {freeFollowUpDays, newCaseAfterDays, postOpDays, emergencyFrom, emergencyTo ('HH:MM'),
   emergencyOnSunday, emergencyChargeId, newPatientKind, freeFollowUpKind, followUpKind, newCaseKind, postOpKind}
   visitFee(id) → {visitKindKey, visitKindLabel, suggestedKindKey, emergency, suggestedEmergency,
   daysSinceLastVisit, reason, lines:[{label, amount, standardChargeId}], note}
   setKind(id, {visitKindKey?, emergency?}) → VisitOut; an unpaid bill's suggested fee line follows. */
export const fees = {
  kinds: () => data(client.get('/visit-kinds')),
  rules: () => data(client.get('/fee-rules')),
  visitFee: (visitId) => data(client.get(`/visits/${visitId}/fee`)),
  setKind: (visitId, patch) => data(client.put(`/visits/${visitId}/kind`, patch)),
  admin: {
    // + inUse (visits carrying the kind); DELETE 409s when a rule or a visit uses it
    kinds: crud('/admin/visit-kinds'),
    rules: () => data(client.get('/admin/fee-rules')),
    // any subset of the rules; 422 with a plain message when they don't add up
    saveRules: (patch) => data(client.put('/admin/fee-rules', patch)),
  },
};

/* Doctor's panel — diagnosis on the visit, follow-up date (lane C owns this block).
   Each returns the updated visit (VisitOut: …, diagnosisId, diagnosisName, followUpDate,
   followUpNote, followUpAppointmentId). */
export const doctor = {
  // null clears; the prescription's diagnosis follows server-side
  setDiagnosis: (visitId, diagnosisId) => data(client.patch(`/visits/${visitId}`, { diagnosisId })),
  // books (or moves) the patient's appointment on `date` ('YYYY-MM-DD'), tagged with this visit
  setFollowUp: (visitId, date, note = '') => data(client.put(`/visits/${visitId}/follow-up`, { date, note })),
  // "No follow-up": the booked appointment is removed unless already checked in
  clearFollowUp: (visitId) => data(client.delete(`/visits/${visitId}/follow-up`)),
};

// GET /config → { stages, protocolSteps, referralSources, lensTiers, conditions, medicineForms:[{key,label}] }
export const config = {
  get: () => data(client.get('/config')),
};

// Rows: {id, name, phone, date, channel, checkedIn, patientId, visitId, createdAt, note,
//        sourceVisitId} — sourceVisitId set = booked by a doctor's follow-up date.
export const appointments = {
  list: ({ date } = {}) => data(client.get('/appointments', { params: { date } })),
  counts: ({ from, to } = {}) => data(client.get('/appointments/counts', { params: { from, to } })),
  create: (body) => data(client.post('/appointments', body)),
  update: (id, patch) => data(client.patch(`/appointments/${id}`, patch)),
  remove: (id) => data(client.delete(`/appointments/${id}`)),
  checkin: (id) => data(client.post(`/appointments/${id}/checkin`)),
};

export const readings = {
  // B6 contract: GET /machines → [{key, label, fields, manualOnly}]
  machines: () => data(client.get('/machines')),
  testTypes: () => data(client.get('/machines')),
  listForVisit: (visitId) => data(client.get(`/visits/${visitId}/readings`)),
  // multipart, camelCase form fields (visitId, machineKey, image, clientCapturedAt, clientUuid);
  // 202 pending, or 200 with the existing reading when clientUuid was already uploaded.
  capture: ({ patientId, visitId, machine, machineKey, file, clientUuid, capturedAt }) => {
    const fd = new FormData();
    fd.append('visitId', String(visitId ?? patientId));
    fd.append('machineKey', machineKey ?? machine);
    if (file) fd.append('image', file, file.name || 'capture.jpg');
    if (clientUuid) fd.append('clientUuid', clientUuid);
    if (capturedAt) fd.append('clientCapturedAt', new Date(capturedAt).toISOString());
    return data(client.post('/readings', fd, { headers: { 'Content-Type': 'multipart/form-data' } }));
  },
  manual: ({ visitId, machineKey, values, capturedAt }) =>
    data(
      client.post('/readings/manual', { visitId, machineKey, values, ...(capturedAt ? { capturedAt } : {}) })
    ),
  get: (id) => data(client.get(`/readings/${id}`)),
  setValues: (id, vals) => data(client.patch(`/readings/${id}/values`, { values: vals })),
  remove: (id) => data(client.delete(`/readings/${id}`)),
  // A person confirms the values (optionally correcting them in the same call). The printout
  // photo is deleted server-side; imagePath/imageUrl come back null. 409 while OCR still runs.
  approve: (id, values) => data(client.post(`/readings/${id}/approve`, values ? { values } : {})),
  apply: (id) => data(client.post(`/readings/${id}/apply`)),
  examPhotos: (visitId) => data(client.get(`/visits/${visitId}/exam-photos`)),
  addExamPhoto: (visitId, meta) => {
    const fd = new FormData();
    if (meta?.file) fd.append('image', meta.file, meta.file.name || 'exam.jpg');
    if (meta?.capturedAt) fd.append('capturedAt', new Date(meta.capturedAt).toISOString());
    return data(
      client.post(`/visits/${visitId}/exam-photos`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    );
  },
  removeExamPhoto: (_visitId, photoId) => data(client.delete(`/exam-photos/${photoId}`)),
  /** Absolute URL for an uploaded image path (backend serves /api/uploads/{path}). */
  imageUrl: (r) => r?.imageUrl ?? r?.url ?? (r?.imagePath ? `/api/uploads/${r.imagePath}` : null),
};

export const ot = {
  // B7 contract: GET /ot/slots?date= → [{timeSlot, caseId, patientName}]
  slots: (date) => data(client.get('/ot/slots', { params: { date } })),
  lensTiers: () => data(client.get('/lens-tiers')),
  cases: ({ date } = {}) => data(client.get('/ot/cases', { params: { date } })),
  counts: ({ from, to } = {}) => data(client.get('/ot/counts', { params: { from, to } })),
  get: (id) => data(client.get(`/ot/cases/${id}`)),
  create: (body) => data(client.post('/ot/cases', body)),
  // partial; preOpBiometry/operative/postOp/billing are deep-merged server-side
  update: (id, patch) => data(client.patch(`/ot/cases/${id}`, patch)),
  setStatus: (id, status) => data(client.post(`/ot/cases/${id}/status`, { status })),
  remove: (id) => data(client.delete(`/ot/cases/${id}`)),
  // multipart field is `file`; returns the full OtCaseOut
  addConsentPhoto: (id, meta) => {
    const fd = new FormData();
    if (meta?.file) fd.append('file', meta.file, meta.file.name || 'consent.jpg');
    return data(
      client.post(`/ot/cases/${id}/consent-photos`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    );
  },
  removeConsentPhoto: (_caseId, photoId) => data(client.delete(`/ot/consent-photos/${photoId}`)),
  // Photo of the HBM-1 biometry / IOL report → {case, values:[{l,v,ok}], confidence}; readable
  // values are already merged into case.preOpBiometry.
  scanBiometry: (id, file) => {
    const fd = new FormData();
    fd.append('image', file, file.name || 'biometry.jpg');
    return data(
      client.post(`/ot/cases/${id}/biometry/scan`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    );
  },
};

/* OT team: who was in the operating theatre, including outside doctors / partners, and their fees.
   The team of a case is saved with ot.update(id, {billing: {team: [...]}}) — any staff; the list replaces
   the old one. Shapes:
     TeamMember = {roleKey, roleLabel, name, qualification, regNo, external (outside, not clinic staff),
                   partnerId|null, fee (whole ₹)}   role label / name / qualification / reg. no. are copies,
                   so old cases keep them when the lists change. An outside member without a qualification
                   is refused (422, the message names the row). case.billing = {lensTier, mediclaim,
                   paymentMode, team:[TeamMember], lensPrice, teamFees, total (= lensPrice + teamFees)}.
     Role       = {id, key, label, defaultFee, sortOrder, active}
     Partner    = {id, name, qualification, regNo, phone, defaultRoleKey|null, defaultFee, note, active, createdAt}
   Nothing is deleted: roles and outside doctors are switched off. */
export const otTeam = {
  // → {roles:[Role] switched on, in order, partners:[Partner] switched on, staff:[{name, role}]}
  options: () => data(client.get('/ot/team-options')),
  admin: {
    roles: () => data(client.get('/admin/ot-team-roles')), // all, switched-off too
    createRole: (label, defaultFee = 0) => data(client.post('/admin/ot-team-roles', { label, defaultFee })),
    // patch {label?, defaultFee?, active?}
    updateRole: (key, patch) => data(client.patch(`/admin/ot-team-roles/${key}`, patch)),
    reorderRoles: (keys) => data(client.put('/admin/ot-team-roles/order', { keys })),
    partners: () => data(client.get('/admin/ot-partners')), // all, switched-off too
    // body {name, qualification (required), regNo?, phone?, defaultRoleKey?, defaultFee?, note?}
    createPartner: (body) => data(client.post('/admin/ot-partners', body)),
    // patch: any of those + active; defaultRoleKey '' clears it
    updatePartner: (id, patch) => data(client.patch(`/admin/ot-partners/${id}`, patch)),
  },
};

export const prescriptions = {
  // GET /medicines?q= → [{id, name, brand, composition, form, formLabel, strength, packSize, manufacturer, displayName}]
  // matches name, brand or composition (brand/prefix hits first); active rows only
  medicines: ({ q = '' } = {}) => data(client.get('/medicines', { params: { q } })),
  get: (visitId) => data(client.get(`/visits/${visitId}/prescription`)),
  // lines: [{name, medicineId?, dosage, qtyGiven}] → {…, lines:[{…, matched, form, formLabel}], lowStock:[names]}
  save: (visitId, lines, printLanguage, diagnosisId = null) =>
    data(client.post(`/visits/${visitId}/prescription`, { lines, printLanguage, diagnosisId })),
  // → {hospital, patient, language, lines:[{name, dosage, dosageLocal, qtyGiven, brand, composition, form, formLabel, packSize}]}
  printPayload: (visitId, lang) =>
    data(client.get(`/visits/${visitId}/prescription/print`, { params: { lang } })),
  // Front desk confirms the patient bought this medicine here (deducts stock); DELETE undoes it.
  dispense: (visitId, lineId, qty) =>
    data(client.post(`/visits/${visitId}/prescription/lines/${lineId}/dispense`, { qty })),
  undispense: (visitId, lineId) => data(client.delete(`/visits/${visitId}/prescription/lines/${lineId}/dispense`)),
};

/* Diagnoses + treatment standards (B15/F17). A standard = the admin-saved lines, else the most
   common prescription across every past prescription for that diagnosis (counted, not AI). */
export const treatments = {
  // → [{id, name, active, sortOrder, prescriptionCount, hasStandard}]
  diagnoses: ({ includeInactive = false } = {}) =>
    data(client.get('/diagnoses', includeInactive ? { params: { includeInactive: true } } : undefined)),
  // → {diagnosisId, diagnosisName, source: 'admin'|'history'|'none', lines:[{name, medicineId, matched, dosage,
  //    qtyGiven, frequency?}], historyCount, updatedAt?, updatedBy?, historyLines}
  standard: (diagnosisId) => data(client.get(`/diagnoses/${diagnosisId}/standard`)),
  admin: {
    create: (name) => data(client.post('/admin/diagnoses', { name })),
    update: (id, patch) => data(client.patch(`/admin/diagnoses/${id}`, patch)),
    remove: (id) => data(client.delete(`/admin/diagnoses/${id}`)),
    reorder: (ids) => data(client.put('/admin/diagnoses/order', { ids })),
    // lines: [{name, medicineId?, dosage, qtyGiven?}]
    saveStandard: (id, lines) => data(client.put(`/admin/diagnoses/${id}/standard`, { lines })),
    clearStandard: (id) => data(client.delete(`/admin/diagnoses/${id}/standard`)),
  },
};

/* Spreadsheet import (B13/F15), admin only. upload → {token, filename, headers, rowCount, sample, suggested};
   preview/run → {target, total, new, update, skip, written, rows:[{row, action, label, reason}]} */
export const imports = {
  targets: () => data(client.get('/admin/import/targets')),
  upload: (file) => {
    const fd = new FormData();
    fd.append('file', file, file.name || 'import.csv');
    return data(client.post('/admin/import/files', fd, { headers: { 'Content-Type': 'multipart/form-data' } }));
  },
  preview: (token, target, mapping) => data(client.post('/admin/import/preview', { token, target, mapping })),
  run: (token, target, mapping) => data(client.post('/admin/import/run', { token, target, mapping })),
};

export const inventory = {
  list: () => data(client.get('/inventory')),
  low: () => data(client.get('/inventory/low')),
  // {name?, medicineId?, unit, stock, reorderLevel} — name optional when medicineId is given
  create: (body) => data(client.post('/inventory', body)),
  adjust: (id, delta, reason, note) => data(client.post(`/inventory/${id}/adjust`, { delta, reason, note })),
  update: (id, patch) => data(client.patch(`/inventory/${id}`, patch)),
  movements: (id) => data(client.get(`/inventory/${id}/movements`)),
  // "Order placed" for qty: the low-stock alert stays quiet until stock is received (adjust reason
  // "received" reduces / clears the outstanding quantity). DELETE undoes it.
  markOrdered: (id, qty) => data(client.post(`/inventory/${id}/ordered`, { qty })),
  clearOrdered: (id) => data(client.delete(`/inventory/${id}/ordered`)),
};

function crud(base, orderKey = 'ids') {
  return {
    list: () => data(client.get(base)),
    create: (body) => data(client.post(base, body)),
    update: (id, patch) => data(client.patch(`${base}/${id}`, patch)),
    remove: (id) => data(client.delete(`${base}/${id}`)),
    move: (id, dir) => data(client.post(`${base}/${id}/move`, { direction: dir })),
    // PUT {base}/order {keys|ids: [...]} — full ordered list of refs
    reorder: (refs) => data(client.put(`${base}/order`, { [orderKey]: refs })),
  };
}

export const admin = {
  stages: crud('/admin/stages', 'keys'),
  protocolSteps: crud('/admin/protocol-steps'),
  referralSources: crud('/admin/referral-sources'),
  lensTiers: crud('/admin/lens-tiers'),
  /* Medicine master: rows carry `active`; includeInactive=true also returns retired ones. */
  medicines: {
    list: ({ includeInactive = false } = {}) =>
      data(client.get('/admin/medicines', includeInactive ? { params: { includeInactive: true } } : undefined)),
    get: (id) => data(client.get(`/admin/medicines/${id}`)),
    // {name?, brand?, composition (required), form="drops", strength?, packSize?, manufacturer?, price?} — 409 dup, 422 bad form
    create: (body) => data(client.post('/admin/medicines', body)),
    // any field; "" clears an optional one; {price:null} clears the price; {active:true} reactivates
    update: (id, patch) => data(client.patch(`/admin/medicines/${id}`, patch)),
    // soft delete → inactive
    remove: (id) => data(client.delete(`/admin/medicines/${id}`)),
  },
  // [{id, key, label, sortOrder, active}]; rows addressed by key; DELETE 409s when medicines use the form
  medicineForms: crud('/admin/medicine-forms', 'keys'),
  // OT time slots [{id, label, active, sortOrder}] — label like "9:00 AM"; 409 when upcoming surgeries use it
  otSlots: {
    list: () => data(client.get('/admin/ot-slots')),
    create: (label) => data(client.post('/admin/ot-slots', { label })),
    update: (id, patch) => data(client.patch(`/admin/ot-slots/${id}`, patch)),
    remove: (id) => data(client.delete(`/admin/ot-slots/${id}`)),
    // replace with a regular grid: start/end "HH:MM" (24h), every N minutes; booked slots are kept
    generate: (start, end, everyMin) => data(client.post('/admin/ot-slots/generate', { start, end, everyMin })),
  },
  // Standard charges [{id, label, amount, amountBothEyes, groupLabel, active, sortOrder}] — one tap onto a bill;
  // DELETE 409s once a bill uses it. amountBothEyes set = priced per eye (amount = one eye).
  standardCharges: crud('/admin/standard-charges'),
  // OT procedure list [{id, name, active, sortOrder}]
  otProcedures: {
    ...crud('/admin/ot-procedures'),
    create: (name) => data(client.post('/admin/ot-procedures', { name })),
  },
  staff: {
    ...crud('/admin/staff'),
    resetPassword: (id, password) => data(client.post(`/admin/staff/${id}/reset-password`, { password })),
  },
};

export const mr = {
  list: ({ rep, company } = {}) =>
    data(client.get('/mr-visits', { params: { ...(rep ? { rep } : {}), ...(company ? { company } : {}) } })),
  reps: () => data(client.get('/mr-visits/reps')),
  create: (body) => data(client.post('/mr-visits', body)),
  update: (id, patch) => data(client.patch(`/mr-visits/${id}`, patch)),
  remove: (id) => data(client.delete(`/mr-visits/${id}`)),
};

/* Day book (the daily cash sheet), its columns and the cash drawer (lane M owns this block).
   heads({includeInactive}) → [{id, key, label, sortOrder, active, useCount}]; settings() →
   {medicineHead, otherHead, otHead} (the column medicines / hand-typed lines / OT payments go under).
   day(date) → {date, heads:[{key, label}], rows:[{kind ('visit'|'old_balance'|'ot'), visitId, otCaseId,
   patientId, name, phone, ageSex ("20/F"), area, token, visitDate, amounts:{headKey: ₹}, total, received,
   modes:[mode], left, status, note}], totals:{amounts, total, received, left}, byMode:[{mode, payments,
   amount}], receivedTotal, cash:{openingCash, openingSource ('set'|'carried'|'none'), openingSetBy,
   openingSetAt, openingNote, cashReceived, movements:[{id, direction ('out'|'in'), amount, person, reason,
   at, byName}], cashIn, cashOut, closingCash}}. setOpening / addMovement / removeMovement return the day.
   download(date) → {blob, filename} (an .xlsx laid out like the paper sheet). */
const fileName = (res, fallback) =>
  /filename="?([^";]+)"?/.exec(res.headers?.['content-disposition'] || '')?.[1] || fallback;

export const daybook = {
  heads: ({ includeInactive = false } = {}) =>
    data(client.get('/account-heads', { params: includeInactive ? { includeInactive: true } : {} })),
  settings: () => data(client.get('/daybook-settings')),
  admin: {
    create: (label) => data(client.post('/admin/account-heads', { label })),
    update: (key, patch) => data(client.patch(`/admin/account-heads/${key}`, patch)),
    remove: (key) => data(client.delete(`/admin/account-heads/${key}`)),
    reorder: (keys) => data(client.put('/admin/account-heads/order', { keys })),
    saveSettings: (patch) => data(client.put('/admin/daybook-settings', patch)),
  },
  day: (date) => data(client.get(`/daybook/${date}`)),
  // {openingCash, note?}
  setOpening: (date, body) => data(client.put(`/daybook/${date}/opening`, body)),
  // {direction: 'out'|'in', amount, person, reason}
  addMovement: (date, body) => data(client.post(`/daybook/${date}/movements`, body)),
  removeMovement: (date, id) => data(client.delete(`/daybook/${date}/movements/${id}`)),
  // names typed on earlier cash entries, most recent first
  people: () => data(client.get('/daybook/people')),
  download: (date) =>
    client
      .get(`/daybook/${date}.xlsx`, { responseType: 'blob' })
      .then((res) => ({ blob: res.data, filename: fileName(res, `day-book-${date}.xlsx`) })),
};
/* Printed-prescription extras: glasses prescription, exam findings, print settings (lane R owns
   this block). Shapes:
     ExamGlasses = {visitId, exam:[{key, label, r, l}], glasses: Glasses|null,
                    fromReading: {readingId, machine, capturedAt, r:{sph,cyl,axis}, l:{…}, ipd}|null,
                    va:{r, l}}                       (fromReading = latest approved refraction reading)
     Glasses     = {r:{dist:{sph,cyl,axis,va}, near:{…}}, l:{…}, lensTypes:[keys], ipd:'66', note}
                   Sph/Cyl come back tidied ('-2.5' → '-2.50', '1' → '+1.00', '0' → 'Plano'); axis 0–180.
                   null = no glasses this visit (nothing prints).
     Settings    = {doctorName, degrees, regNo, footerNote:{english, hindi, gujarati}}
     ExamFinding = {id, key, label, defaultValue, sortOrder, active}; LensType = {id, key, label, sortOrder, active}
   The print payload (prescriptions.printPayload) carries the printed forms: exam [{label, r, l}],
   glasses {rows:[{key, label, r, l}], lensTypes:[labels], ipd, note}|null, doctor {name, degrees, regNo},
   footerNote, patient.patientId / patient.area. */
export const rxPrint = {
  get: (visitId) => data(client.get(`/visits/${visitId}/exam-glasses`)),
  // body {exam:[{key, r, l}], glasses: Glasses|null} → ExamGlasses; doctor / admin only; 422 names the bad value
  save: (visitId, body) => data(client.put(`/visits/${visitId}/exam-glasses`, body)),
  // → {examFindings:[ExamFinding], lensTypes:[LensType]} — switched-on rows, in order
  lists: () => data(client.get('/rx-print/lists')),
  settings: () => data(client.get('/rx-print/settings')),
  admin: {
    saveSettings: (settings) => data(client.put('/admin/rx-print/settings', settings)),
    // all rows, switched-off too
    examFindings: () => data(client.get('/admin/exam-findings')),
    createExamFinding: (label, defaultValue = '') => data(client.post('/admin/exam-findings', { label, defaultValue })),
    // patch {label?, defaultValue?, active?}
    updateExamFinding: (key, patch) => data(client.patch(`/admin/exam-findings/${key}`, patch)),
    reorderExamFindings: (keys) => data(client.put('/admin/exam-findings/order', { keys })),
    lensTypes: () => data(client.get('/admin/lens-types')),
    createLensType: (label) => data(client.post('/admin/lens-types', { label })),
    // patch {label?, active?}
    updateLensType: (key, patch) => data(client.patch(`/admin/lens-types/${key}`, patch)),
    reorderLensTypes: (keys) => data(client.put('/admin/lens-types/order', { keys })),
  },
};
