/* Mock implementations of every API module. Same method names and return
   shapes as src/api/real.js so screens can't tell the difference.
   All methods return Promises and resolve with *copies* of store data. */
import { store, latency } from './store';
import {
  normalizePatient,
  dateStr,
  REFERRAL_NEEDS_DETAIL,
  TEST_TYPES,
  CONDITIONS,
  OT_TIME_SLOTS,
  OT_PROCEDURES,
  emptyOtOperative,
  emptyOtPostOp,
  emptyOtBilling,
} from './data';

const S = store.state;
const c = store.clone;

function httpError(status, message) {
  const err = new Error(message);
  err.response = { status, data: { detail: message } };
  return err;
}

/* ---------------- auth ---------------- */
const MOCK_USERS = {
  admin: { password: 'admin', role: 'admin' },
  doctor: { password: 'doctor', role: 'doctor' },
  optom: { password: 'optom', role: 'optometrist' },
  reception: { password: 'reception', role: 'reception' },
  ot: { password: 'ot', role: 'ot_staff' },
};

export const auth = {
  async login({ username, password }) {
    await latency();
    const u = MOCK_USERS[username];
    if (!u || u.password !== password) throw httpError(401, 'Incorrect username or password');
    const staff = S.staff.find((s) => s.username === username);
    return { access_token: 'mock-token-' + username, token_type: 'bearer', user: c(staff) };
  },
  async me() {
    await latency(40);
    const token = localStorage.getItem('gk_token') || '';
    const username = token.replace('mock-token-', '');
    const staff = S.staff.find((s) => s.username === username) || S.staff[0];
    return c(staff);
  },
  async health() {
    return { status: 'ok', mode: 'mock' };
  },
};

/* ---------------- patients & visits (queue) ---------------- */
export const patients = {
  async list({ q = '' } = {}) {
    await latency(60);
    const query = q.trim().toLowerCase();
    let rows = S.patients;
    if (query) {
      rows = rows.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          (p.token || '').toLowerCase().includes(query) ||
          (p.phone || '').toLowerCase().includes(query)
      );
    }
    return c(rows);
  },
  async get(id) {
    await latency(40);
    const p = S.patients.find((x) => x.id === Number(id));
    if (!p) throw httpError(404, 'Patient not found');
    return c(p);
  },
  async create(data) {
    await latency();
    const p = normalizePatient({
      ...data,
      id: store.nextId('patient'),
      token: store.nextToken(),
      stage: S.stages[0]?.key || 'reg',
      stageEnteredAt: Date.now(),
      lastVisitDate: lookupLastVisit(data.phone),
    });
    S.patients.push(p);
    store.notify();
    return c(p);
  },
  async update(id, patch) {
    await latency(30);
    const p = S.patients.find((x) => x.id === Number(id));
    if (!p) throw httpError(404, 'Patient not found');
    Object.assign(p, patch);
    store.notify();
    return c(p);
  },
  async remove(id) {
    await latency();
    const i = S.patients.findIndex((x) => x.id === Number(id));
    if (i >= 0) S.patients.splice(i, 1);
    store.notify();
    return { ok: true };
  },
  async history(phone) {
    await latency(30);
    return c(S.patientHistory[phone] || []);
  },
  conditions: () => Promise.resolve([...CONDITIONS]),
  referralSources: () => Promise.resolve(c(S.referralSources)),
  referralNeedsDetail: () => Promise.resolve([...REFERRAL_NEEDS_DETAIL]),
};

function lookupLastVisit(phone) {
  if (!phone) return null;
  const dates = S.patientHistory[phone];
  if (!dates || dates.length === 0) return null;
  return dates[dates.length - 1];
}

export const visits = {
  async today({ stage } = {}) {
    await latency(60);
    const rows = stage ? S.patients.filter((p) => p.stage === stage) : S.patients;
    return c(rows);
  },
  async counts() {
    await latency(20);
    const counts = {};
    S.stages.forEach((st) => {
      counts[st.key] = S.patients.filter((p) => p.stage === st.key).length;
    });
    return counts;
  },
  async move(id, stage) {
    await latency(60);
    const p = S.patients.find((x) => x.id === Number(id));
    if (!p) throw httpError(404, 'Visit not found');
    if (!S.stages.some((s) => s.key === stage)) throw httpError(400, 'Unknown stage');
    p.stage = stage;
    p.stageEnteredAt = Date.now();
    if (stage === 'done') recordVisitCompletion(p.phone);
    store.notify();
    return c(p);
  },
  async setVA(id, va) {
    const p = S.patients.find((x) => x.id === Number(id));
    if (!p) throw httpError(404, 'Visit not found');
    p.va = { ...p.va, ...va };
    store.notify();
    return c(p);
  },
  async complete(id) {
    return visits.move(id, 'done');
  },
  // Dilation (B5)
  async dilation(id) {
    const p = S.patients.find((x) => x.id === Number(id));
    return p?.dilation ? c(p.dilation) : null;
  },
  async startDilation(id) {
    await latency(60);
    const p = S.patients.find((x) => x.id === Number(id));
    if (!p) throw httpError(404, 'Visit not found');
    if (S.protocolSteps.length === 0)
      throw httpError(400, 'Add at least one step to the dilation protocol in Admin first.');
    p.stage = 'dilate';
    p.stageEnteredAt = Date.now();
    p.dilation = {
      currentIndex: 0,
      steps: S.protocolSteps.map((s) => ({
        name: s.name,
        min: s.min,
        given: false,
        startedAt: null,
        done: false,
      })),
    };
    store.notify();
    return c(p);
  },
  async dilationStepGiven(id, index) {
    const p = S.patients.find((x) => x.id === Number(id));
    const step = p?.dilation?.steps[index];
    if (!step) throw httpError(404, 'Step not found');
    step.given = true;
    step.startedAt = Date.now();
    decrementStock(step.name, 1, 'dispensed');
    store.notify();
    return c(p.dilation);
  },
  async dilationStepDone(id, index) {
    const p = S.patients.find((x) => x.id === Number(id));
    const step = p?.dilation?.steps[index];
    if (!step) throw httpError(404, 'Step not found');
    step.done = true;
    p.dilation.currentIndex = index + 1;
    store.notify();
    return c(p.dilation);
  },
  async saveBill(id, bill) {
    const p = S.patients.find((x) => x.id === Number(id));
    if (!p) throw httpError(404, 'Visit not found');
    p.bill = c(bill);
    store.notify();
    return c(p.bill);
  },
};

function recordVisitCompletion(phone) {
  if (!phone) return;
  const today = dateStr(0);
  if (!S.patientHistory[phone]) S.patientHistory[phone] = [];
  const h = S.patientHistory[phone];
  if (h[h.length - 1] !== today) h.push(today);
}

/* ---------------- appointments ---------------- */
export const appointments = {
  async list({ date } = {}) {
    await latency(50);
    const rows = date ? S.appointments.filter((a) => a.date === date) : S.appointments;
    return c(rows);
  },
  async counts({ from, to } = {}) {
    await latency(20);
    const counts = {};
    S.appointments.forEach((a) => {
      if (from && a.date < from) return;
      if (to && a.date > to) return;
      counts[a.date] = (counts[a.date] || 0) + 1;
    });
    return counts;
  },
  async create(data) {
    await latency();
    const a = {
      id: store.nextId('appointment'),
      checkedIn: false,
      channel: 'whatsapp',
      date: dateStr(0),
      ...data,
    };
    S.appointments.push(a);
    store.notify();
    return c(a);
  },
  async update(id, patch) {
    const a = S.appointments.find((x) => x.id === Number(id));
    if (!a) throw httpError(404, 'Appointment not found');
    Object.assign(a, patch);
    store.notify();
    return c(a);
  },
  async remove(id) {
    const i = S.appointments.findIndex((x) => x.id === Number(id));
    if (i >= 0) S.appointments.splice(i, 1);
    store.notify();
    return { ok: true };
  },
  async checkin(id) {
    await latency();
    const a = S.appointments.find((x) => x.id === Number(id));
    if (!a) throw httpError(404, 'Appointment not found');
    if (a.checkedIn) throw httpError(400, 'Already checked in');
    a.checkedIn = true;
    const p = await patients.create({
      name: a.name,
      phone: a.phone,
      note: 'Appointment (' + a.channel + ')',
    });
    a.patientId = p.id;
    store.notify();
    return { appointment: c(a), visit: p };
  },
};

/* ---------------- readings (machines / OCR) ---------------- */
export const readings = {
  testTypes: () => Promise.resolve(c(TEST_TYPES)),
  async listForVisit(patientId) {
    await latency(30);
    return c(S.readings.filter((r) => r.patientId === Number(patientId)));
  },
  // Simulates upload → pending → processing → done using the TEST_TYPES sample values.
  async capture({ patientId, machine, clientUuid }) {
    await latency();
    const existing = clientUuid && S.readings.find((r) => r.clientUuid === clientUuid);
    if (existing) return c(existing);
    const r = {
      id: store.nextId('reading'),
      patientId: Number(patientId),
      machine,
      status: 'pending',
      vals: [],
      src: 'scanned',
      clientUuid,
      capturedAt: Date.now(),
      confidence: null,
    };
    S.readings.push(r);
    store.notify();
    setTimeout(() => {
      r.status = 'processing';
      store.notify();
    }, 400);
    setTimeout(() => {
      const t = TEST_TYPES.find((x) => x.machine === machine);
      r.vals = t ? c(t.vals) : [];
      r.status = 'done';
      r.confidence = 0.92;
      store.notify();
    }, 1600);
    return c(r);
  },
  async get(id) {
    const r = S.readings.find((x) => x.id === Number(id));
    if (!r) throw httpError(404, 'Reading not found');
    return c(r);
  },
  async setValues(id, vals) {
    const r = S.readings.find((x) => x.id === Number(id));
    if (!r) throw httpError(404, 'Reading not found');
    r.vals = c(vals);
    r.status = 'done';
    store.notify();
    return c(r);
  },
  // Apply a reading onto the patient record (mockup's applyExtractedReading)
  async apply(id) {
    const r = S.readings.find((x) => x.id === Number(id));
    const p = S.patients.find((x) => x.id === r?.patientId);
    if (!r || !p) throw httpError(404, 'Not found');
    const src =
      (r.src || 'scanned') +
      ', ' +
      new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const i = p.readings.findIndex((x) => x.machine === r.machine);
    const entry = { machine: r.machine, src, vals: c(r.vals) };
    if (i >= 0) p.readings[i] = entry;
    else p.readings.push(entry);
    store.notify();
    return c(p);
  },
  async addExamPhoto(patientId, meta = {}) {
    const p = S.patients.find((x) => x.id === Number(patientId));
    if (!p) throw httpError(404, 'Patient not found');
    const photo = {
      id: Date.now(),
      capturedAt: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      ...meta,
    };
    p.examPhotos.push(photo);
    store.notify();
    return c(photo);
  },
  async removeExamPhoto(patientId, photoId) {
    const p = S.patients.find((x) => x.id === Number(patientId));
    if (p) p.examPhotos = p.examPhotos.filter((x) => x.id !== photoId);
    store.notify();
    return { ok: true };
  },
};

/* ---------------- OT ---------------- */
export const ot = {
  slots: () => Promise.resolve([...OT_TIME_SLOTS]),
  procedures: () => Promise.resolve([...OT_PROCEDURES]),
  lensTiers: () => Promise.resolve(c(S.lensTiers)),
  async cases({ date } = {}) {
    await latency(50);
    const rows = date ? S.otCases.filter((x) => x.date === date) : S.otCases;
    return c(rows);
  },
  async counts({ from, to } = {}) {
    const counts = {};
    S.otCases.forEach((x) => {
      if (from && x.date < from) return;
      if (to && x.date > to) return;
      counts[x.date] = (counts[x.date] || 0) + 1;
    });
    return counts;
  },
  async get(id) {
    const x = S.otCases.find((k) => k.id === Number(id));
    if (!x) throw httpError(404, 'Case not found');
    return c(x);
  },
  async create(data) {
    await latency();
    const conflict = S.otCases.find(
      (k) => k.date === data.date && k.time === data.time && k.status !== 'cancelled'
    );
    if (conflict) throw httpError(409, 'That OT slot is already booked for ' + conflict.patientName);
    const k = {
      id: store.nextId('ot'),
      status: 'scheduled',
      preOpBiometry: {
        AL: { R: '', L: '' },
        ACD: { R: '', L: '' },
        K1: { R: '', L: '' },
        K2: { R: '', L: '' },
        targetRefraction: { R: '', L: '' },
      },
      operative: emptyOtOperative(),
      consentPhotos: [],
      postOp: emptyOtPostOp(),
      billing: emptyOtBilling(),
      ...data,
    };
    S.otCases.push(k);
    store.notify();
    return c(k);
  },
  async update(id, patch) {
    const x = S.otCases.find((k) => k.id === Number(id));
    if (!x) throw httpError(404, 'Case not found');
    deepMerge(x, patch);
    store.notify();
    return c(x);
  },
  async setStatus(id, status) {
    return ot.update(id, { status });
  },
  async addConsentPhoto(id) {
    const x = S.otCases.find((k) => k.id === Number(id));
    if (!x) throw httpError(404, 'Case not found');
    const photo = {
      id: Date.now(),
      capturedAt: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) + ', today',
    };
    x.consentPhotos.push(photo);
    store.notify();
    return c(photo);
  },
  async removeConsentPhoto(id, photoId) {
    const x = S.otCases.find((k) => k.id === Number(id));
    if (x) x.consentPhotos = x.consentPhotos.filter((p) => p.id !== photoId);
    store.notify();
    return { ok: true };
  },
};

function deepMerge(target, patch) {
  Object.keys(patch).forEach((k) => {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object')
      deepMerge(target[k], v);
    else target[k] = v;
  });
}

/* ---------------- prescriptions ---------------- */
export const prescriptions = {
  async medicines({ q = '' } = {}) {
    const query = q.toLowerCase();
    return S.medicines.filter((m) => !query || m.toLowerCase().includes(query));
  },
  async get(patientId) {
    const p = S.patients.find((x) => x.id === Number(patientId));
    return p ? c(p.medicines) : [];
  },
  // lines: [{name, matched, dosage, qtyGiven}] — decrements stock only by qtyGiven
  async save(patientId, lines) {
    await latency();
    const p = S.patients.find((x) => x.id === Number(patientId));
    if (!p) throw httpError(404, 'Patient not found');
    const lowStock = [];
    lines.forEach((line) => {
      const prev = p.medicines.find((m) => m.name === line.name);
      const delta = (line.qtyGiven || 0) - (prev?.qtyGiven || 0);
      if (delta > 0) {
        const item = decrementStock(line.name, delta, 'dispensed');
        if (item && item.stock <= item.reorder) lowStock.push(c(item));
      }
    });
    p.medicines = c(lines).map((l) => ({ matched: S.medicines.includes(l.name), ...l }));
    store.notify();
    return { medicines: c(p.medicines), lowStock };
  },
  async printPayload(patientId, lang = 'english') {
    const p = S.patients.find((x) => x.id === Number(patientId));
    if (!p) throw httpError(404, 'Patient not found');
    return {
      patient: c(p),
      lang,
      hospital: { name: 'Gurukrupa Eye Hospital & Research Center', doctor: 'Dr. Anu Juneja Pathak' },
    };
  },
};

function decrementStock(name, qty, reason) {
  const item = S.inventory.find((i) => i.name === name);
  if (!item) return null;
  item.stock = Math.max(0, item.stock - qty);
  S.stockMovements.push({
    id: S.stockMovements.length + 1,
    itemId: item.id,
    delta: -qty,
    reason,
    at: Date.now(),
  });
  return item;
}

/* ---------------- inventory ---------------- */
export const inventory = {
  async list() {
    await latency(40);
    return c(S.inventory);
  },
  async low() {
    return c(S.inventory.filter((i) => i.stock <= i.reorder));
  },
  async create(data) {
    await latency();
    const item = { id: store.nextId('inventory'), unit: 'bottles', stock: 0, reorder: 0, ...data };
    S.inventory.push(item);
    store.notify();
    return c(item);
  },
  async adjust(id, delta, reason = 'adjusted') {
    await latency(40);
    const item = S.inventory.find((i) => i.id === Number(id));
    if (!item) throw httpError(404, 'Item not found');
    item.stock = Math.max(0, item.stock + Number(delta));
    S.stockMovements.push({
      id: S.stockMovements.length + 1,
      itemId: item.id,
      delta: Number(delta),
      reason,
      at: Date.now(),
    });
    store.notify();
    return c(item);
  },
  async update(id, patch) {
    const item = S.inventory.find((i) => i.id === Number(id));
    if (!item) throw httpError(404, 'Item not found');
    Object.assign(item, patch);
    store.notify();
    return c(item);
  },
  async movements(id) {
    return c(S.stockMovements.filter((m) => m.itemId === Number(id)));
  },
};

/* ---------------- admin ---------------- */
function listOps(key, seqKey) {
  return {
    list: async () => c(S[key]),
    create: async (data) => {
      const row = { ...data };
      if (!row.key && row.label)
        row.key = row.label.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + store.nextId(seqKey);
      S[key].push(row);
      store.notify();
      return c(row);
    },
    update: async (idx, patch) => {
      const row = S[key][idx];
      if (!row) throw httpError(404, 'Not found');
      Object.assign(row, patch);
      store.notify();
      return c(row);
    },
    remove: async (idx) => {
      S[key].splice(idx, 1);
      store.notify();
      return { ok: true };
    },
    move: async (idx, dir) => {
      const j = idx + dir;
      if (j < 0 || j >= S[key].length) return c(S[key]);
      [S[key][idx], S[key][j]] = [S[key][j], S[key][idx]];
      store.notify();
      return c(S[key]);
    },
  };
}

const stagesOps = listOps('stages', 'stage');
export const admin = {
  stages: {
    ...stagesOps,
    remove: async (idx) => {
      const st = S.stages[idx];
      if (st && S.patients.some((p) => p.stage === st.key)) throw httpError(400, 'Stage has active patients');
      return stagesOps.remove(idx);
    },
  },
  protocolSteps: listOps('protocolSteps', 'protocol'),
  referralSources: listOps('referralSources', 'referral'),
  lensTiers: listOps('lensTiers', 'lens'),
  staff: {
    list: async () => c(S.staff),
    create: async (data) => {
      const row = { id: store.nextId('staff'), active: true, role: 'reception', ...data };
      delete row.password;
      S.staff.push(row);
      store.notify();
      return c(row);
    },
    update: async (id, patch) => {
      const row = S.staff.find((s) => s.id === Number(id));
      if (!row) throw httpError(404, 'Not found');
      Object.assign(row, patch);
      store.notify();
      return c(row);
    },
    resetPassword: async () => ({ ok: true }),
  },
};

/* ---------------- MR visits ---------------- */
export const mr = {
  async list({ rep } = {}) {
    await latency(40);
    const rows = rep ? S.mrVisits.filter((v) => v.repName === rep) : S.mrVisits;
    return c(rows);
  },
  async reps() {
    const map = {};
    S.mrVisits.forEach((v) => {
      if (!map[v.repName])
        map[v.repName] = { repName: v.repName, company: v.company, phone: v.phone, visits: [] };
      map[v.repName].visits.push(c(v));
    });
    return Object.values(map);
  },
  async create(data) {
    await latency();
    const v = { id: store.nextId('mr'), visitDate: 'today', nextVisitDate: '', notes: '', ...data };
    S.mrVisits.unshift(v);
    store.notify();
    return c(v);
  },
  async update(id, patch) {
    const v = S.mrVisits.find((x) => x.id === Number(id));
    if (!v) throw httpError(404, 'Not found');
    Object.assign(v, patch);
    store.notify();
    return c(v);
  },
  async remove(id) {
    const i = S.mrVisits.findIndex((x) => x.id === Number(id));
    if (i >= 0) S.mrVisits.splice(i, 1);
    store.notify();
    return { ok: true };
  },
};

/* Store change subscription (used by api/index.js onDataChange). */
export const subscribeStore = (fn) => store.subscribe(fn);
export { store as mockStore };
