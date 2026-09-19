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
  // B3: PATCH /visits/{id} {note?, doctorNotes?, elsewhere?, elsewhereNote?}
  update: (id, patch) => data(client.patch(`/visits/${id}`, patch)),
  move: (id, stage) => data(client.post(`/visits/${id}/move`, { stage })),
  setVA: (id, va) => data(client.patch(`/visits/${id}/va`, va)),
  complete: (id) => data(client.post(`/visits/${id}/complete`)),
  dilation: (id) => data(client.get(`/visits/${id}/dilation`)),
  startDilation: (id) => data(client.post(`/visits/${id}/dilation/start`)),
  dilationStepGiven: (id, n) => data(client.post(`/visits/${id}/dilation/steps/${n}/given`)),
  dilationStepDone: (id, n) => data(client.post(`/visits/${id}/dilation/steps/${n}/done`)),
  clearDilation: (id) => data(client.delete(`/visits/${id}/dilation`)),
  // Billing (B8): GET 404s until a bill exists; PUT upserts {items:[{label,amount}], paymentMode?}
  bill: (id) => data(client.get(`/visits/${id}/bill`)),
  saveBill: (id, bill) => data(client.put(`/visits/${id}/bill`, bill)),
  payBill: (id, paymentMode) => data(client.post(`/visits/${id}/bill/pay`, { paymentMode })),
};

// GET /config → { stages, protocolSteps, referralSources, lensTiers, conditions, medicineForms:[{key,label}] }
export const config = {
  get: () => data(client.get('/config')),
};

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
};

export const prescriptions = {
  // GET /medicines?q= → [{id, name, brand, composition, form, formLabel, strength, packSize, manufacturer, displayName}]
  // matches name, brand or composition (brand/prefix hits first); active rows only
  medicines: ({ q = '' } = {}) => data(client.get('/medicines', { params: { q } })),
  get: (visitId) => data(client.get(`/visits/${visitId}/prescription`)),
  // lines: [{name, medicineId?, dosage, qtyGiven}] → {…, lines:[{…, matched, form, formLabel}], lowStock:[names]}
  save: (visitId, lines, printLanguage) =>
    data(client.post(`/visits/${visitId}/prescription`, { lines, printLanguage })),
  // → {hospital, patient, language, lines:[{name, dosage, dosageLocal, qtyGiven, brand, composition, form, formLabel, packSize}]}
  printPayload: (visitId, lang) =>
    data(client.get(`/visits/${visitId}/prescription/print`, { params: { lang } })),
};

export const inventory = {
  list: () => data(client.get('/inventory')),
  low: () => data(client.get('/inventory/low')),
  // {name?, medicineId?, unit, stock, reorderLevel} — name optional when medicineId is given
  create: (body) => data(client.post('/inventory', body)),
  adjust: (id, delta, reason, note) => data(client.post(`/inventory/${id}/adjust`, { delta, reason, note })),
  update: (id, patch) => data(client.patch(`/inventory/${id}`, patch)),
  movements: (id) => data(client.get(`/inventory/${id}/movements`)),
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
