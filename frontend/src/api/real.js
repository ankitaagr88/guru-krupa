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

/* Per-visit bill, standard charges and receipts (lane B owns this block).
   GET 404s until a bill exists; PUT upserts {items:[{label,amount}], paymentMode?}. */
export const billing = {
  get: (visitId) => data(client.get(`/visits/${visitId}/bill`)),
  save: (visitId, bill) => data(client.put(`/visits/${visitId}/bill`, bill)),
  pay: (visitId, paymentMode) => data(client.post(`/visits/${visitId}/bill/pay`, { paymentMode })),
};

/* Read-only reports — the "Today" summary page (lane B owns this block). */
export const reports = {};

/* Reception additions — duplicate-patient check etc. (lane A owns this block). */
export const reception = {};

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
    // {name?, brand?, composition (required), form="drops", strength?, packSize?, manufacturer?} — 409 dup, 422 bad form
    create: (body) => data(client.post('/admin/medicines', body)),
    // any field; "" clears an optional one; {active:true} reactivates
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
