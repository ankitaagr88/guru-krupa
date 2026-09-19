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
  // B3 (mock): the patient row *is* today's visit — registering just (re)queues it at the first stage.
  async create({ patientId, note, elsewhere, elsewhereNote } = {}) {
    await latency(40);
    const p = S.patients.find((x) => x.id === Number(patientId));
    if (!p) throw httpError(404, 'Patient not found');
    if (p.visitRegistered && p.stage !== 'done')
      throw httpError(409, 'Patient already has an active visit today');
    p.visitRegistered = true;
    p.stage = S.stages[0]?.key || 'reg';
    p.stageEnteredAt = Date.now();
    p.patientId = p.id;
    if (note != null) p.note = note;
    if (elsewhere != null) p.elsewhere = !!elsewhere;
    if (elsewhereNote != null) p.elsewhereNote = elsewhereNote;
    store.notify();
    return c(p);
  },
  async get(id) {
    const p = S.patients.find((x) => x.id === Number(id));
    if (!p) throw httpError(404, 'Visit not found');
    return c(p);
  },
  // PATCH /visits/{id} {note?, doctorNotes?, elsewhere?, elsewhereNote?}
  async update(id, patch) {
    await latency(30);
    const p = S.patients.find((x) => x.id === Number(id));
    if (!p) throw httpError(404, 'Visit not found');
    ['note', 'doctorNotes', 'elsewhere', 'elsewhereNote'].forEach((k) => {
      if (patch[k] !== undefined) p[k] = patch[k];
    });
    store.notify();
    return c(p);
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
  async clearDilation(id) {
    const p = S.patients.find((x) => x.id === Number(id));
    if (!p) throw httpError(404, 'Visit not found');
    p.dilation = null;
    store.notify();
    return { ok: true };
  },
  // Billing (B8 contract): GET / PUT {items, paymentMode?} / POST pay {paymentMode}
  async bill(id) {
    const p = S.patients.find((x) => x.id === Number(id));
    if (!p) throw httpError(404, 'Visit not found');
    return billOut(p);
  },
  async saveBill(id, bill) {
    const p = S.patients.find((x) => x.id === Number(id));
    if (!p) throw httpError(404, 'Visit not found');
    p.bill = { ...p.bill, items: c(bill.items || []) };
    if (bill.paymentMode !== undefined) p.bill.paymentMode = bill.paymentMode;
    store.notify();
    return billOut(p);
  },
  async payBill(id, paymentMode) {
    const p = S.patients.find((x) => x.id === Number(id));
    if (!p) throw httpError(404, 'Visit not found');
    p.bill.paymentMode = paymentMode;
    p.bill.paidAt = Date.now();
    store.notify();
    return billOut(p);
  },
};

function billOut(p) {
  const b = p.bill || { items: [], paymentMode: null };
  return {
    visitId: p.id,
    items: c(b.items || []),
    total: (b.items || []).reduce((s, it) => s + Number(it.amount || 0), 0),
    paymentMode: b.paymentMode ?? null,
    paidAt: b.paidAt ?? null,
    paid: !!b.paidAt,
  };
}

// GET /config — the reference lists every screen needs (mirrors backend ConfigOut).
export const config = {
  async get() {
    await latency(20);
    return {
      stages: c(S.stages),
      protocolSteps: S.protocolSteps.map((s, i) => ({ ...s, minutes: s.min, sortOrder: i })),
      referralSources: S.referralSources.map((r, i) => ({
        ...r,
        needsDetail: REFERRAL_NEEDS_DETAIL.includes(r.key),
        sortOrder: i,
      })),
      lensTiers: c(S.lensTiers),
      conditions: [...CONDITIONS],
    };
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
    // B4 contract: { 'YYYY-MM-DD': { total, checkedIn } }
    const counts = {};
    S.appointments.forEach((a) => {
      if (from && a.date < from) return;
      if (to && a.date > to) return;
      if (!counts[a.date]) counts[a.date] = { total: 0, checkedIn: 0 };
      counts[a.date].total += 1;
      if (a.checkedIn) counts[a.date].checkedIn += 1;
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
    if (a.checkedIn) throw httpError(409, 'Appointment already checked in');
    a.checkedIn = true;
    const via = a.channel === 'whatsapp' ? 'WhatsApp' : a.channel === 'call' ? 'phone call' : 'walk-in';
    const p = await patients.create({
      name: a.name,
      phone: a.phone,
      note: 'Appointment booked via ' + via,
    });
    p.visitRegistered = true;
    const stored = S.patients.find((x) => x.id === p.id);
    if (stored) stored.visitRegistered = true;
    a.patientId = p.id;
    a.visitId = p.id;
    store.notify();
    return { appointment: c(a), visit: { ...p, patientId: p.id } };
  },
};

/* ---------------- readings (machines / OCR) ---------------- */
/* Shapes follow the B6 contract (ReadingOut): {id, visitId, machineKey, machine,
   source, status, values:[{l,v,ok?}], confidence, error, capturedAt, imagePath,
   imageUrl, clientUuid}. In mock mode a "visit" id is the patient id. */
export const MACHINES = [
  { key: 'hnt1p_tono', label: 'HNT-1P — Tono-Pachy (IOP & CCT)', manualOnly: false },
  { key: 'hrk8000a_ref', label: 'HRK-8000A — Refraction (REF)', manualOnly: false },
  { key: 'hrk8000a_ker', label: 'HRK-8000A — Keratometry (KER)', manualOnly: false },
  { key: 'clm1_lensmeter', label: 'CLM-1 — Current Glasses (Lensmeter)', manualOnly: false },
  { key: 'ypc100k_ref', label: 'YPC-100K — Refraction (REF)', manualOnly: false },
  { key: 'ypc100k_ker', label: 'YPC-100K — Keratometry (KER)', manualOnly: false },
  { key: 'tbut_schirmer', label: 'TBUT / Schimer I', manualOnly: true },
].map((m) => ({ ...m, fields: (TEST_TYPES.find((t) => t.machine === m.label)?.vals || []).map((v) => v.l) }));

const machineByKey = (key) => MACHINES.find((m) => m.key === key);
const machineByLabel = (label) => MACHINES.find((m) => m.label === label);

function objectUrl(file) {
  try {
    return file && typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : null;
  } catch {
    return null;
  }
}

// Mirrors the mockup's applyExtractedReading: a finished reading is copied onto
// the patient's `readings` (what the Queue drawer's renderReadings shows).
function applyReadingToPatient(r) {
  const p = S.patients.find((x) => x.id === Number(r.visitId));
  if (!p) return;
  const src =
    (r.source || 'scanned') + ', ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const entry = { machine: r.machine, src, vals: c(r.values) };
  const i = p.readings.findIndex((x) => x.machine === r.machine);
  if (i >= 0) p.readings[i] = entry;
  else p.readings.push(entry);
}

export const readings = {
  machines: () => Promise.resolve(c(MACHINES)),
  testTypes: () => Promise.resolve(c(MACHINES)),
  async listForVisit(visitId) {
    await latency(30);
    return c(S.readings.filter((r) => r.visitId === Number(visitId)));
  },
  // Simulates upload → pending → processing → done using the TEST_TYPES sample values.
  // Idempotent on clientUuid (offline retry) like the real endpoint.
  async capture({ patientId, visitId, machine, machineKey, file, clientUuid, capturedAt }) {
    await latency();
    const existing = clientUuid && S.readings.find((r) => r.clientUuid === clientUuid);
    if (existing) return c(existing);
    const m = machineByKey(machineKey) || machineByLabel(machine);
    if (!m) throw httpError(422, `Unknown machineKey '${machineKey ?? machine}'`);
    if (m.manualOnly) throw httpError(422, `'${m.key}' has no printout to scan; use POST /readings/manual`);
    const vid = Number(visitId ?? patientId);
    if (!S.patients.some((p) => p.id === vid)) throw httpError(404, 'Visit not found');
    const r = {
      id: store.nextId('reading'),
      visitId: vid,
      machineKey: m.key,
      machine: m.label,
      source: 'scanned',
      status: 'pending',
      values: [],
      confidence: null,
      error: null,
      corrected: false,
      clientUuid: clientUuid || null,
      capturedAt: capturedAt ? new Date(capturedAt).toISOString() : new Date().toISOString(),
      imagePath: file ? `mock/${Date.now()}.jpg` : null,
      imageUrl: objectUrl(file),
    };
    S.readings.push(r);
    store.notify();
    setTimeout(() => {
      r.status = 'processing';
      store.notify();
    }, 400);
    setTimeout(() => {
      const t = TEST_TYPES.find((x) => x.machine === m.label);
      r.values = t ? c(t.vals) : [];
      // Demo a low-confidence field so the review panel's coral highlight is visible.
      if (r.values.length > 2) r.values[2] = { ...r.values[2], ok: false };
      r.status = 'done';
      r.confidence = 0.92;
      applyReadingToPatient(r);
      store.notify();
    }, 1600);
    return c(r);
  },
  async manual({ visitId, machineKey, values, capturedAt }) {
    await latency(60);
    const m = machineByKey(machineKey);
    if (!m) throw httpError(422, `Unknown machineKey '${machineKey}'`);
    const vid = Number(visitId);
    if (!S.patients.some((p) => p.id === vid)) throw httpError(404, 'Visit not found');
    const r = {
      id: store.nextId('reading'),
      visitId: vid,
      machineKey: m.key,
      machine: m.label,
      source: 'manual',
      status: 'done',
      values: c(values),
      confidence: null,
      error: null,
      corrected: false,
      clientUuid: null,
      capturedAt: capturedAt ? new Date(capturedAt).toISOString() : new Date().toISOString(),
      imagePath: null,
      imageUrl: null,
    };
    S.readings.push(r);
    applyReadingToPatient(r);
    store.notify();
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
    if (r.status === 'processing') throw httpError(409, 'Reading is still being processed');
    r.values = c(vals).map(({ l, v }) => ({ l, v, ok: true }));
    r.status = 'done';
    r.corrected = true;
    r.error = null;
    applyReadingToPatient(r);
    store.notify();
    return c(r);
  },
  async remove(id) {
    const i = S.readings.findIndex((x) => x.id === Number(id));
    if (i >= 0) S.readings.splice(i, 1);
    store.notify();
    return null;
  },
  // Apply a reading onto the patient record (mockup's applyExtractedReading)
  async apply(id) {
    const r = S.readings.find((x) => x.id === Number(id));
    const p = S.patients.find((x) => x.id === r?.visitId);
    if (!r || !p) throw httpError(404, 'Not found');
    applyReadingToPatient(r);
    store.notify();
    return c(p);
  },
  async examPhotos(visitId) {
    const p = S.patients.find((x) => x.id === Number(visitId));
    if (!p) throw httpError(404, 'Visit not found');
    return c(p.examPhotos);
  },
  async addExamPhoto(visitId, meta = {}) {
    await latency(60);
    const p = S.patients.find((x) => x.id === Number(visitId));
    if (!p) throw httpError(404, 'Visit not found');
    const { file, ...rest } = meta;
    const photo = {
      id: Date.now(),
      visitId: p.id,
      imagePath: file ? `mock/exam-${Date.now()}.jpg` : null,
      url: objectUrl(file),
      capturedAt: new Date().toISOString(),
      ...rest,
    };
    p.examPhotos.push(photo);
    store.notify();
    return c(photo);
  },
  async removeExamPhoto(visitId, photoId) {
    const p = S.patients.find((x) => x.id === Number(visitId));
    if (p) p.examPhotos = p.examPhotos.filter((x) => x.id !== Number(photoId));
    store.notify();
    return null;
  },
  imageUrl: (r) => r?.imageUrl ?? r?.url ?? null,
};

/* ---------------- OT ---------------- */
/* Shapes follow the B7 contract (OtCaseOut): `timeSlot` (11 slots 9:00 AM–4:30 PM
   every 45 min), billing carries computed `lensPrice`/`total`, consent photos
   have ids. Nested sections deep-merge on PATCH like the real endpoint. */
const ACTIVE_OT = (k) => k.status !== 'cancelled';

function otCaseOut(k) {
  const out = c(k);
  const tier = S.lensTiers.find((t) => t.key === out.billing?.lensTier);
  out.billing = { ...out.billing, lensPrice: tier ? tier.price : 0, total: tier ? tier.price : 0 };
  out.consentPhotos = (out.consentPhotos || []).map((ph, i) => ({ id: ph.id ?? i + 1, imagePath: null, ...ph }));
  return out;
}

export const ot = {
  async slots(date) {
    await latency(20);
    const taken = S.otCases.filter((k) => k.date === date && ACTIVE_OT(k));
    return OT_TIME_SLOTS.map((timeSlot) => {
      const k = taken.find((x) => x.timeSlot === timeSlot);
      return { timeSlot, caseId: k ? k.id : null, patientName: k ? k.patientName : null };
    });
  },
  procedures: () => Promise.resolve([...OT_PROCEDURES]),
  lensTiers: () => Promise.resolve(c(S.lensTiers)),
  async cases({ date } = {}) {
    await latency(50);
    const rows = date ? S.otCases.filter((x) => x.date === date) : S.otCases;
    return rows.map(otCaseOut);
  },
  async counts({ from, to } = {}) {
    const counts = {};
    S.otCases.forEach((x) => {
      if (!ACTIVE_OT(x)) return;
      if (from && x.date < from) return;
      if (to && x.date > to) return;
      counts[x.date] = (counts[x.date] || 0) + 1;
    });
    return counts;
  },
  async get(id) {
    const x = S.otCases.find((k) => k.id === Number(id));
    if (!x) throw httpError(404, 'OT case not found');
    return otCaseOut(x);
  },
  async create(data) {
    await latency();
    const timeSlot = data.timeSlot ?? data.time;
    if (!OT_TIME_SLOTS.includes(timeSlot)) throw httpError(422, 'Unknown time slot');
    const conflict = S.otCases.find((k) => k.date === data.date && k.timeSlot === timeSlot && ACTIVE_OT(k));
    if (conflict) throw httpError(409, `Time slot '${timeSlot}' is already booked on that date`);
    let patient = null;
    if (data.patientId != null) {
      patient = S.patients.find((p) => p.id === Number(data.patientId));
      if (!patient) throw httpError(404, 'Patient not found');
    }
    if (!patient && !(data.patientName || '').trim()) throw httpError(422, 'patientId or patientName is required');
    const k = {
      id: store.nextId('ot'),
      patientId: patient ? patient.id : null,
      patientName: patient ? patient.name : data.patientName.trim(),
      age: patient ? patient.age : (data.age ?? null),
      sex: patient ? patient.sex : (data.sex ?? null),
      date: data.date,
      timeSlot,
      procedure: data.procedure,
      status: 'scheduled',
      preOpBiometry: {
        AL: { R: '', L: '' },
        ACD: { R: '', L: '' },
        K1: { R: '', L: '' },
        K2: { R: '', L: '' },
        targetRefraction: { R: '', L: '' },
        ...(data.preOpBiometry || {}),
      },
      operative: emptyOtOperative(),
      consentPhotos: [],
      postOp: emptyOtPostOp(),
      billing: emptyOtBilling(),
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    S.otCases.push(k);
    store.notify();
    return otCaseOut(k);
  },
  async update(id, patch) {
    const x = S.otCases.find((k) => k.id === Number(id));
    if (!x) throw httpError(404, 'OT case not found');
    const slot = patch.timeSlot ?? patch.time;
    const date = patch.date ?? x.date;
    if (slot || patch.date) {
      const s = slot ?? x.timeSlot;
      const conflict = S.otCases.find((k) => k.id !== x.id && k.date === date && k.timeSlot === s && ACTIVE_OT(k));
      if (conflict) throw httpError(409, `Time slot '${s}' is already booked on that date`);
    }
    if (patch.billing?.lensTier && !S.lensTiers.some((t) => t.key === patch.billing.lensTier))
      throw httpError(400, `Unknown lens tier '${patch.billing.lensTier}'`);
    const { time, ...rest } = patch;
    if (time) rest.timeSlot = time;
    deepMerge(x, rest);
    x.updatedAt = new Date().toISOString();
    store.notify();
    return otCaseOut(x);
  },
  async setStatus(id, status) {
    if (!['scheduled', 'in_progress', 'completed', 'cancelled'].includes(status))
      throw httpError(400, `Unknown status '${status}'`);
    return ot.update(id, { status });
  },
  async remove(id) {
    return ot.update(id, { status: 'cancelled' });
  },
  async addConsentPhoto(id, meta = {}) {
    await latency(60);
    const x = S.otCases.find((k) => k.id === Number(id));
    if (!x) throw httpError(404, 'OT case not found');
    const photo = {
      id: Date.now(),
      imagePath: meta.file ? `mock/consent-${Date.now()}.jpg` : null,
      url: objectUrl(meta.file),
      capturedAt: new Date().toISOString(),
    };
    x.consentPhotos.push(photo);
    store.notify();
    return otCaseOut(x);
  },
  async removeConsentPhoto(caseId, photoId) {
    const x = S.otCases.find((k) => k.id === Number(caseId));
    if (x) x.consentPhotos = x.consentPhotos.filter((p) => p.id !== Number(photoId));
    store.notify();
    return null;
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
  // Real: GET /medicines?q= → [{id, name}]
  async medicines({ q = '' } = {}) {
    const query = q.toLowerCase();
    return S.medicines
      .map((name, i) => ({ id: i + 1, name }))
      .filter((m) => !query || m.name.toLowerCase().includes(query));
  },
  // Real: GET /visits/{id}/prescription → PrescriptionOut {id, visitId, printLanguage, lines}
  async get(patientId) {
    const p = S.patients.find((x) => x.id === Number(patientId));
    if (!p) throw httpError(404, 'Patient not found');
    return {
      id: p.id,
      visitId: p.id,
      printLanguage: p.printLanguage || 'english',
      lines: c(p.medicines || []),
    };
  },
  // lines: [{name, matched, dosage, qtyGiven}] — decrements stock only by qtyGiven
  async save(patientId, lines, printLanguage) {
    await latency();
    const p = S.patients.find((x) => x.id === Number(patientId));
    if (!p) throw httpError(404, 'Patient not found');
    // 409 on insufficient stock (real backend behaviour) before touching anything
    for (const line of lines) {
      const prev = p.medicines.find((m) => m.name === line.name);
      const delta = (line.qtyGiven || 0) - (prev?.qtyGiven || 0);
      const item = S.inventory.find((i) => i.name === line.name);
      if (delta > 0 && item && item.stock < delta)
        throw httpError(409, `Not enough stock of ${item.name} (only ${item.stock} ${item.unit} left)`);
    }
    const lowStock = [];
    lines.forEach((line) => {
      const prev = p.medicines.find((m) => m.name === line.name);
      const delta = (line.qtyGiven || 0) - (prev?.qtyGiven || 0);
      if (delta > 0) {
        const item = decrementStock(line.name, delta, 'dispensed');
        if (item && item.stock <= item.reorder) lowStock.push(c(item));
      }
    });
    p.medicines = c(lines).map((l) => {
      const idx = S.medicines.indexOf(l.name);
      return { matched: idx >= 0, medicineId: idx >= 0 ? idx + 1 : null, qtyGiven: 0, ...l };
    });
    if (printLanguage) p.printLanguage = printLanguage;
    store.notify();
    // lowStock: mock keeps full items (name/stock/unit/reorder); real returns names only
    return {
      id: p.id,
      visitId: p.id,
      printLanguage: p.printLanguage || 'english',
      lines: c(p.medicines),
      medicines: c(p.medicines),
      lowStock,
    };
  },
  // Real: GET /visits/{id}/prescription/print?lang= → {hospital, patient, language, lines[{dosageLocal}]}
  async printPayload(patientId, lang = 'english') {
    const p = S.patients.find((x) => x.id === Number(patientId));
    if (!p) throw httpError(404, 'Patient not found');
    return {
      hospital: {
        name: 'Guru Krupa Eye Hospital & Laser Center',
        address: '201/320, The Grand Plaza, Opp. Fire Station, VIP Road, Vesu, Surat',
        phone: '9328621216, 7574998502',
        doctor: 'Dr. Anu Juneja Pathak, M.S. Ophthalmology',
      },
      patient: { name: p.name, age: p.age, sex: p.sex, token: p.token, date: dateStr(0) },
      language: lang,
      lines: (p.medicines || []).map((m) => ({
        name: m.name,
        dosage: m.dosage || '',
        dosageLocal: localizeDosage(m.dosage || '', lang),
        qtyGiven: m.qtyGiven || 0,
      })),
    };
  },
};

// Mock-only dosage transliteration (the real backend does this server-side).
const DOSAGE_WORDS = {
  hinglish: [
    [/both eyes/gi, 'dono aankhon mein'],
    [/right eye/gi, 'daayi aankh mein'],
    [/left eye/gi, 'baayi aankh mein'],
    [/drops/gi, 'boond'],
    [/drop/gi, 'boond'],
    [/tablets?/gi, 'goli'],
    [/(\d+)\s*x\s*daily/gi, 'din mein $1 baar'],
    [/(\d+)\s*times?\s*(a|per)?\s*day/gi, 'din mein $1 baar'],
    [/daily/gi, 'roz'],
    [/morning/gi, 'subah'],
    [/night/gi, 'raat'],
    [/after food/gi, 'khane ke baad'],
    [/for (\d+) days/gi, '$1 din tak'],
    [/weeks?/gi, 'hafte'],
  ],
  gujlish: [
    [/both eyes/gi, 'banne aankh ma'],
    [/right eye/gi, 'jamni aankh ma'],
    [/left eye/gi, 'dabi aankh ma'],
    [/drops/gi, 'tipa'],
    [/drop/gi, 'tipu'],
    [/tablets?/gi, 'goli'],
    [/(\d+)\s*x\s*daily/gi, 'divas ma $1 var'],
    [/(\d+)\s*times?\s*(a|per)?\s*day/gi, 'divas ma $1 var'],
    [/daily/gi, 'roj'],
    [/morning/gi, 'savare'],
    [/night/gi, 'raatre'],
    [/after food/gi, 'jamya pachi'],
    [/for (\d+) days/gi, '$1 divas sudhi'],
    [/weeks?/gi, 'athvadiya'],
  ],
};
function localizeDosage(dosage, lang) {
  const rules = DOSAGE_WORDS[lang];
  if (!rules || !dosage) return dosage;
  return rules.reduce((txt, [re, to]) => txt.replace(re, to), dosage);
}

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
  // Rows carry both the mockup's `reorder` and the real API's `reorderLevel` / `low`.
  async list() {
    await latency(40);
    return c(S.inventory).map(invOut);
  },
  async low() {
    return c(S.inventory.filter((i) => i.stock <= i.reorder)).map(invOut);
  },
  async create(data) {
    await latency();
    const { reorderLevel, ...rest } = data;
    const item = { id: store.nextId('inventory'), unit: 'bottles', stock: 0, reorder: 0, ...rest };
    if (reorderLevel != null) item.reorder = Number(reorderLevel);
    item.stock = Number(item.stock) || 0;
    S.inventory.push(item);
    store.notify();
    return invOut(c(item));
  },
  async adjust(id, delta, reason = 'adjusted', note = '') {
    await latency(40);
    const item = S.inventory.find((i) => i.id === Number(id));
    if (!item) throw httpError(404, 'Item not found');
    item.stock = Math.max(0, item.stock + Number(delta));
    S.stockMovements.push({
      id: S.stockMovements.length + 1,
      itemId: item.id,
      delta: Number(delta),
      reason,
      note,
      at: Date.now(),
    });
    store.notify();
    return invOut(c(item));
  },
  async update(id, patch) {
    const item = S.inventory.find((i) => i.id === Number(id));
    if (!item) throw httpError(404, 'Item not found');
    const { reorderLevel, ...rest } = patch;
    Object.assign(item, rest);
    if (reorderLevel != null) item.reorder = Number(reorderLevel);
    store.notify();
    return invOut(c(item));
  },
  async movements(id) {
    return c(S.stockMovements.filter((m) => m.itemId === Number(id)))
      .map((m) => ({ ...m, createdAt: new Date(m.at).toISOString() }))
      .reverse();
  },
};
function invOut(item) {
  const mi = S.medicines.indexOf(item.name);
  return { ...item, reorderLevel: item.reorder, low: item.stock <= item.reorder, medicineId: mi >= 0 ? mi + 1 : null };
}

/* ---------------- admin ---------------- */
/* Rows are addressed like the real API — by `id` (protocol steps, staff) or
   `key` (stages, referral sources, lens tiers). A plain index still works. */
function resolveIndex(rows, ref) {
  const i = rows.findIndex((r) => (r.id != null && r.id === ref) || (r.key != null && r.key === ref));
  if (i >= 0) return i;
  return typeof ref === 'number' && rows[ref] ? ref : -1;
}
function listOps(key, seqKey) {
  return {
    list: async () => c(S[key]),
    create: async (data) => {
      const row = { ...data };
      if (!row.key && row.label)
        row.key = row.label.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + store.nextId(seqKey);
      if (!row.key && !row.id) row.id = store.nextId(seqKey);
      S[key].push(row);
      store.notify();
      return c(row);
    },
    update: async (ref, patch) => {
      const row = S[key][resolveIndex(S[key], ref)];
      if (!row) throw httpError(404, 'Not found');
      Object.assign(row, patch);
      store.notify();
      return c(row);
    },
    remove: async (ref) => {
      const idx = resolveIndex(S[key], ref);
      if (idx < 0) throw httpError(404, 'Not found');
      S[key].splice(idx, 1);
      store.notify();
      return { ok: true };
    },
    move: async (ref, dir) => {
      const idx = resolveIndex(S[key], ref);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= S[key].length) return c(S[key]);
      [S[key][idx], S[key][j]] = [S[key][j], S[key][idx]];
      store.notify();
      return c(S[key]);
    },
    // Real: PUT {base}/order {keys|ids} — full ordered list of refs
    reorder: async (refs) => {
      const rows = S[key];
      const ordered = refs.map((r) => rows[resolveIndex(rows, r)]).filter(Boolean);
      const rest = rows.filter((r) => !ordered.includes(r));
      S[key] = [...ordered, ...rest];
      store.notify();
      return c(S[key]);
    },
  };
}

const stagesOps = listOps('stages', 'stage');
export const admin = {
  stages: {
    ...stagesOps,
    remove: async (ref) => {
      const st = S.stages[resolveIndex(S.stages, ref)];
      if (st && S.patients.some((p) => p.stage === st.key))
        throw httpError(409, `"${st.label}" still has patients in it — move them first.`);
      return stagesOps.remove(ref);
    },
  },
  protocolSteps: listOps('protocolSteps', 'protocol'),
  referralSources: listOps('referralSources', 'referral'),
  lensTiers: listOps('lensTiers', 'lens'),
  staff: {
    list: async () => c(S.staff),
    create: async (data) => {
      if (S.staff.some((s) => s.username === data.username))
        throw httpError(409, 'That username is already taken');
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
  async list({ rep, company } = {}) {
    await latency(40);
    let rows = S.mrVisits;
    if (rep) rows = rows.filter((v) => v.repName === rep);
    if (company) rows = rows.filter((v) => v.company === company);
    return c(rows);
  },
  // Real: GET /mr-visits/reps → [{repName, company, phone, visits(count), lastVisitDate, nextVisitDate}]
  async reps() {
    const map = {};
    S.mrVisits.forEach((v) => {
      if (!map[v.repName]) {
        map[v.repName] = {
          repName: v.repName,
          company: v.company,
          phone: v.phone,
          visits: 0,
          lastVisitDate: v.visitDate,
          nextVisitDate: v.nextVisitDate || null,
        };
      }
      map[v.repName].visits += 1;
    });
    return Object.values(map);
  },
  async create(data) {
    await latency();
    const v = { id: store.nextId('mr'), visitDate: dateStr(0), nextVisitDate: '', notes: '', ...data };
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
