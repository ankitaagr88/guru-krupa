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
  move: (id, stage) => data(client.post(`/visits/${id}/move`, { stage })),
  setVA: (id, va) => data(client.patch(`/visits/${id}/va`, va)),
  complete: (id) => data(client.post(`/visits/${id}/complete`)),
  dilation: (id) => data(client.get(`/visits/${id}/dilation`)),
  startDilation: (id) => data(client.post(`/visits/${id}/dilation/start`)),
  dilationStepGiven: (id, n) => data(client.post(`/visits/${id}/dilation/steps/${n}/given`)),
  dilationStepDone: (id, n) => data(client.post(`/visits/${id}/dilation/steps/${n}/done`)),
  saveBill: (id, bill) => data(client.post(`/visits/${id}/bill`, bill)),
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
  testTypes: () => data(client.get('/readings/test-types')),
  listForVisit: (visitId) => data(client.get(`/visits/${visitId}/readings`)),
  capture: ({ patientId, visitId, machine, machineKey, file, clientUuid, capturedAt }) => {
    const fd = new FormData();
    fd.append('visit_id', visitId ?? patientId);
    fd.append('machine_key', machineKey ?? machine);
    if (file) fd.append('image', file);
    if (clientUuid) fd.append('client_uuid', clientUuid);
    if (capturedAt) fd.append('client_captured_at', String(capturedAt));
    return data(client.post('/readings', fd, { headers: { 'Content-Type': 'multipart/form-data' } }));
  },
  get: (id) => data(client.get(`/readings/${id}`)),
  setValues: (id, vals) => data(client.patch(`/readings/${id}/values`, { values: vals })),
  apply: (id) => data(client.post(`/readings/${id}/apply`)),
  addExamPhoto: (visitId, meta) => {
    const fd = new FormData();
    if (meta?.file) fd.append('image', meta.file);
    return data(
      client.post(`/visits/${visitId}/exam-photos`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    );
  },
  removeExamPhoto: (visitId, photoId) => data(client.delete(`/visits/${visitId}/exam-photos/${photoId}`)),
};

export const ot = {
  slots: (date) => data(client.get('/ot/slots', { params: { date } })),
  procedures: () => data(client.get('/ot/procedures')),
  lensTiers: () => data(client.get('/lens-tiers')),
  cases: ({ date } = {}) => data(client.get('/ot/cases', { params: { date } })),
  counts: ({ from, to } = {}) => data(client.get('/ot/cases/counts', { params: { from, to } })),
  get: (id) => data(client.get(`/ot/cases/${id}`)),
  create: (body) => data(client.post('/ot/cases', body)),
  update: (id, patch) => data(client.patch(`/ot/cases/${id}`, patch)),
  setStatus: (id, status) => data(client.post(`/ot/cases/${id}/status`, { status })),
  addConsentPhoto: (id, meta) => {
    const fd = new FormData();
    if (meta?.file) fd.append('image', meta.file);
    return data(
      client.post(`/ot/cases/${id}/consent-photos`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    );
  },
  removeConsentPhoto: (id, photoId) => data(client.delete(`/ot/cases/${id}/consent-photos/${photoId}`)),
};

export const prescriptions = {
  medicines: ({ q = '' } = {}) => data(client.get('/medicines', { params: { q } })),
  get: (visitId) => data(client.get(`/visits/${visitId}/prescription`)),
  save: (visitId, lines) => data(client.post(`/visits/${visitId}/prescription`, { lines })),
  printPayload: (visitId, lang) =>
    data(client.get(`/visits/${visitId}/prescription/print`, { params: { lang } })),
};

export const inventory = {
  list: () => data(client.get('/inventory')),
  low: () => data(client.get('/inventory/low')),
  create: (body) => data(client.post('/inventory', body)),
  adjust: (id, delta, reason) => data(client.patch(`/inventory/${id}/adjust`, { delta, reason })),
  update: (id, patch) => data(client.patch(`/inventory/${id}`, patch)),
  movements: (id) => data(client.get(`/inventory/${id}/movements`)),
};

function crud(base) {
  return {
    list: () => data(client.get(base)),
    create: (body) => data(client.post(base, body)),
    update: (id, patch) => data(client.patch(`${base}/${id}`, patch)),
    remove: (id) => data(client.delete(`${base}/${id}`)),
    move: (id, dir) => data(client.post(`${base}/${id}/move`, { direction: dir })),
  };
}

export const admin = {
  stages: crud('/admin/stages'),
  protocolSteps: crud('/admin/protocol-steps'),
  referralSources: crud('/admin/referral-sources'),
  lensTiers: crud('/admin/lens-tiers'),
  staff: {
    ...crud('/admin/staff'),
    resetPassword: (id, password) => data(client.post(`/admin/staff/${id}/reset-password`, { password })),
  },
};

export const mr = {
  list: ({ rep } = {}) => data(client.get('/mr-visits', { params: rep ? { rep } : {} })),
  reps: () => data(client.get('/mr-visits/reps')),
  create: (body) => data(client.post('/mr-visits', body)),
  update: (id, patch) => data(client.patch(`/mr-visits/${id}`, patch)),
  remove: (id) => data(client.delete(`/mr-visits/${id}`)),
};
