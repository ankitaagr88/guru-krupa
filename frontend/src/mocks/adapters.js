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
  emptyOtOperative,
  emptyOtPostOp,
  emptyOtBilling,
} from './data';
import { billOut, dropMedicineLine, standardChargesAdmin, syncMedicineLine } from './billing';
import { patientRead } from './reception';
import { followOwnerPhone, linkInStore } from './family';
import { ageFromDob, dobProblem, parseDobCell } from '../lib/format';

// Each lane keeps its own demo adapters in its own file (session 3).
export { billing, reports } from './billing';
export { reception } from './reception';
export { doctor } from './doctor';
export { family } from './family';
export { fees } from './fees';
export { intake } from './intake';
export { daybook } from './daybook';
export { rxPrint } from './rxPrint';
import { doctor as doctorMock } from './doctor';
import { applySuggestion, feeVisitOut } from './fees';
import { printExtras as rxPrintExtras } from './rxPrint';

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

function currentUserName() {
  try {
    const u = JSON.parse(localStorage.getItem('gk_user') || 'null');
    return u?.name || 'Staff';
  } catch {
    return 'Staff';
  }
}

/* ---------------- patients & visits (queue) ---------------- */
// Same DOB rules as the server: a real past day within 120 years; the DOB wins over a typed age;
// correcting the age alone drops a DOB that was wrong.
function applyDob(p, patch, { isNew = false } = {}) {
  if ('dob' in patch) {
    const problem = dobProblem(patch.dob || '');
    if (problem) throw httpError(422, problem.replace(/\.$/, ''));
    p.dob = patch.dob || null;
  } else if (!isNew && 'age' in patch && p.dob && Number(patch.age) !== ageFromDob(p.dob)) {
    p.dob = null;
  }
  if (p.dob) p.age = ageFromDob(p.dob);
}

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
    return rows.map(patientRead);
  },
  async get(id) {
    await latency(40);
    const p = S.patients.find((x) => x.id === Number(id));
    if (!p) throw httpError(404, 'Patient not found');
    return patientRead(p);
  },
  // Real: GET /patients/{id}/history. In demo mode a "patient" row is today's visit, so the
  // history is that visit plus any earlier dates (PATIENT_HISTORY) and imported prescriptions.
  async fullHistory(id) {
    await latency(60);
    const p = S.patients.find((x) => x.id === Number(id));
    if (!p) throw httpError(404, 'Patient not found');
    const visits = [];
    if (p.stage) {
      const rx = (p.medicines || []).length
        ? { id: p.id, visitId: p.id, printLanguage: p.printLanguage || 'english', diagnosisId: p.diagnosisId ?? null,
            diagnosisName: S.diagnoses.find((d) => d.id === p.diagnosisId)?.name ?? null, lines: p.medicines.map(rxLineOut) }
        : null;
      visits.push({
        id: p.id, date: dateStr(0), token: p.token, stage: p.stage, status: p.stage === 'done' ? 'completed' : 'active',
        va: p.va || { R: '', L: '' }, note: p.note || '', doctorNotes: p.doctorNotes || '', elsewhere: !!p.elsewhere,
        elsewhereNote: p.elsewhereNote || '', completedAt: p.stage === 'done' ? new Date().toISOString() : null,
        imported: false,
        readings: S.readings.filter((r) => r.visitId === p.id).map((r) => c(r)),
        prescription: rx, bill: p.bill && p.bill.items?.length ? billOut(p) : null,
        examPhotos: c(p.examPhotos || []),
        ...(({ exam, glasses }) => ({ exam, glasses }))(rxPrintExtras(p)),
      });
    }
    (p.history || []).forEach((h, i) => {
      visits.push({
        id: -(i + 1), date: h.date, token: '', stage: 'done', status: 'completed', va: { R: '', L: '' }, note: 'Imported from the previous system',
        doctorNotes: '', elsewhere: false, elsewhereNote: '', completedAt: h.date, imported: true, readings: [],
        prescription: { id: -(i + 1), visitId: -(i + 1), printLanguage: 'english', diagnosisId: h.diagnosisId ?? null,
          diagnosisName: S.diagnoses.find((d) => d.id === h.diagnosisId)?.name ?? null, lines: c(h.medicines || []) },
        bill: null, examPhotos: [],
      });
    });
    (S.patientHistory[p.phone] || []).forEach((d, i) => {
      visits.push({ id: -(100 + i), date: d, token: '', stage: 'done', status: 'completed', va: { R: '', L: '' }, note: '',
        doctorNotes: '', elsewhere: false, elsewhereNote: '', completedAt: d, imported: false, readings: [], prescription: null,
        bill: null, examPhotos: [] });
    });
    visits.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const otCases = S.otCases.filter((k) => k.patientId === p.id || k.patientName === p.name).map(otCaseOut).reverse();
    const appointments = S.appointments.filter((a) => a.patientId === p.id || (a.phone && a.phone === p.phone)).map((a) => c(a));
    return {
      patient: patientRead(p),
      visits,
      otCases,
      appointments,
      totals: {
        visits: visits.length,
        prescriptions: visits.filter((v) => v.prescription).length,
        surgeries: otCases.length,
        readings: visits.reduce((n, v) => n + v.readings.length, 0),
      },
    };
  },
  // familyOwnerId (+ relationKey): "Add as a family member" — joins that family, like the server.
  async create(data) {
    await latency();
    const { dob, familyOwnerId, relationKey, ...rest } = data;
    const draft = {};
    applyDob(draft, dob !== undefined ? { dob } : {}, { isNew: true });
    const p = normalizePatient({
      ...rest,
      ...draft,
      id: store.nextId('patient'),
      token: store.nextToken(),
      stage: S.stages[0]?.key || 'reg',
      stageEnteredAt: Date.now(),
      lastVisitDate: lookupLastVisit(data.phone),
    });
    if (familyOwnerId != null) linkInStore(p, familyOwnerId, relationKey ?? null);
    S.patients.push(p);
    store.notify();
    return patientRead(p);
  },
  async update(id, patch) {
    await latency(30);
    const p = S.patients.find((x) => x.id === Number(id));
    if (!p) throw httpError(404, 'Patient not found');
    const { dob, ...rest } = patch;
    if (dob !== undefined) {
      const problem = dobProblem(dob || '');
      if (problem) throw httpError(422, problem.replace(/\.$/, ''));
    }
    const oldPhone = p.phone;
    Object.assign(p, rest);
    applyDob(p, patch);
    // The owner's number is the family's number: members follow a change.
    const familyPhoneUpdated = p.phone !== oldPhone ? followOwnerPhone(p) : 0;
    store.notify();
    return { ...patientRead(p), familyPhoneUpdated };
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
    return rows.map(feeVisitOut); // + visit kind & fee (lane E2)
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
    applySuggestion(p); // visit kind + emergency from the fee rules (lane E2)
    if (note != null) p.note = note;
    if (elsewhere != null) p.elsewhere = !!elsewhere;
    if (elsewhereNote != null) p.elsewhereNote = elsewhereNote;
    store.notify();
    return c(p);
  },
  async get(id) {
    const p = S.patients.find((x) => x.id === Number(id));
    if (!p) throw httpError(404, 'Visit not found');
    return feeVisitOut(p);
  },
  // PATCH /visits/{id} {note?, doctorNotes?, elsewhere?, elsewhereNote?, diagnosisId?}
  async update(id, patch) {
    await latency(30);
    const p = S.patients.find((x) => x.id === Number(id));
    if (!p) throw httpError(404, 'Visit not found');
    if (patch.diagnosisId !== undefined) await doctorMock.setDiagnosis(id, patch.diagnosisId);
    ['note', 'doctorNotes', 'elsewhere', 'elsewhereNote'].forEach((k) => {
      if (patch[k] !== undefined) p[k] = patch[k];
    });
    store.notify();
    return feeVisitOut(p);
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
};

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
      // active medicine types for the picker / admin add form
      medicineForms: S.medicineForms
        .filter((f) => f.active !== false)
        .map((f) => ({ key: f.key, label: f.label })),
      otProcedures: S.otProcedures.filter((p) => p.active !== false).map((p) => p.name),
      otSlots: activeSlotLabels(),
    };
  },
};

/* ---- OT slots (B12): "9:00 AM" style labels, time-ordered ---- */
const slotKey = (label) => {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((label || '').trim());
  if (!m) return 9999;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return h * 60 + Number(m[2]);
};
const normSlot = (label) => {
  const t = (label || '').trim().toUpperCase().replace(/\s+/g, ' ');
  let m = /^(\d{1,2}):(\d{2})\s?(AM|PM)$/.exec(t);
  let h;
  let min;
  if (m) {
    h = Number(m[1]) % 12;
    if (m[3] === 'PM') h += 12;
    min = Number(m[2]);
  } else {
    m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) throw httpError(422, `'${label}' is not a time — use e.g. 9:00 AM or 14:15`);
    h = Number(m[1]);
    min = Number(m[2]);
  }
  if (h > 23 || min > 59) throw httpError(422, `'${label}' is not a time`);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
};
const activeSlotLabels = () =>
  S.otSlots
    .filter((s) => s.active !== false)
    .map((s) => s.label)
    .sort((a, b) => slotKey(a) - slotKey(b));
const slotInUse = (label) => S.otCases.filter((k) => k.timeSlot === label && k.date >= dateStr(0) && ACTIVE_OT(k)).length;
const sortedSlots = () => [...S.otSlots].sort((a, b) => slotKey(a.label) - slotKey(b.label) || a.id - b.id);

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
      note: '',
      sourceVisitId: null,
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
    // A follow-up moved on the appointment book moves the visit's "come back on" too.
    const source = a.sourceVisitId ? S.patients.find((p) => p.id === a.sourceVisitId) : null;
    if (source && patch.date && !a.checkedIn) source.followUpDate = patch.date;
    store.notify();
    return c(a);
  },
  async remove(id) {
    const i = S.appointments.findIndex((x) => x.id === Number(id));
    if (i >= 0) {
      const a = S.appointments[i];
      const source = a.sourceVisitId ? S.patients.find((p) => p.id === a.sourceVisitId) : null;
      if (source && source.followUpDate === a.date) source.followUpDate = null;
      S.appointments.splice(i, 1);
    }
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
      note: a.sourceVisitId
        ? 'Follow-up visit' + (a.note ? ' — ' + a.note : '')
        : 'Appointment booked via ' + via,
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
    (r.source || 'scanned') +
    ', ' +
    new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
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
  // Real: POST /readings/{id}/approve — stamps approvedAt/approvedBy, deletes the photo.
  async approve(id, vals) {
    await latency(60);
    const r = S.readings.find((x) => x.id === Number(id));
    if (!r) throw httpError(404, 'Reading not found');
    if (r.status === 'pending' || r.status === 'processing')
      throw httpError(409, `Reading is still ${r.status} - wait for OCR to finish`);
    if (vals) {
      r.values = c(vals).map(({ l, v }) => ({ l, v, ok: true }));
      r.corrected = true;
    } else {
      r.values = (r.values || []).map((v) => ({ ...v, ok: true }));
    }
    r.status = 'done';
    r.error = null;
    r.approved = true;
    r.approvedAt = new Date().toISOString();
    r.approvedBy = currentUserName();
    r.imagePath = null;
    r.imageUrl = null;
    applyReadingToPatient(r);
    store.notify();
    return c(r);
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
  out.consentPhotos = (out.consentPhotos || []).map((ph, i) => ({
    id: ph.id ?? i + 1,
    imagePath: null,
    ...ph,
  }));
  return out;
}

export const ot = {
  async slots(date) {
    await latency(20);
    const taken = S.otCases.filter((k) => k.date === date && ACTIVE_OT(k));
    const labels = [...new Set([...activeSlotLabels(), ...taken.map((k) => k.timeSlot)])].sort(
      (a, b) => slotKey(a) - slotKey(b)
    );
    return labels.map((timeSlot) => {
      const k = taken.find((x) => x.timeSlot === timeSlot);
      return { timeSlot, caseId: k ? k.id : null, patientName: k ? k.patientName : null };
    });
  },
  procedures: () => Promise.resolve(S.otProcedures.filter((p) => p.active !== false).map((p) => p.name)),
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
    if (!activeSlotLabels().includes(timeSlot)) throw httpError(422, 'Unknown time slot');
    const conflict = S.otCases.find((k) => k.date === data.date && k.timeSlot === timeSlot && ACTIVE_OT(k));
    if (conflict) throw httpError(409, `Time slot '${timeSlot}' is already booked on that date`);
    let patient = null;
    if (data.patientId != null) {
      patient = S.patients.find((p) => p.id === Number(data.patientId));
      if (!patient) throw httpError(404, 'Patient not found');
    }
    if (!patient && !(data.patientName || '').trim())
      throw httpError(422, 'patientId or patientName is required');
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
      const conflict = S.otCases.find(
        (k) => k.id !== x.id && k.date === date && k.timeSlot === s && ACTIVE_OT(k)
      );
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
  // Real: POST /ot/cases/{id}/biometry/scan — the HBM-1 sample values, merged into preOpBiometry.
  async scanBiometry(id, file) {
    await latency(900);
    const x = S.otCases.find((k) => k.id === Number(id));
    if (!x) throw httpError(404, 'OT case not found');
    if (!file) throw httpError(400, 'Empty file');
    const values = [
      { l: 'AL (R)', v: '22.90', ok: true },
      { l: 'AL (L)', v: '23.05', ok: true },
      { l: 'ACD (R)', v: '2.70', ok: true },
      { l: 'ACD (L)', v: '2.74', ok: true },
      { l: 'K1 (R)', v: '43.27', ok: true },
      { l: 'K1 (L)', v: '43.50', ok: true },
      { l: 'K2 (R)', v: '44.10', ok: true },
      { l: 'K2 (L)', v: '81.00', ok: false },
    ];
    const units = { AL: 'mm', ACD: 'mm', K1: 'D', K2: 'D' };
    const patch = {};
    values.forEach(({ l, v, ok }) => {
      if (!ok) return;
      const [key, eye] = l.replace(')', '').split(' (');
      (patch[key] ||= {})[eye] = `${v}${units[key] || ''}`;
    });
    deepMerge(x, { preOpBiometry: patch });
    x.updatedAt = new Date().toISOString();
    store.notify();
    return { case: otCaseOut(x), values, confidence: 0.88 };
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

/* ---------------- medicines (master list) ---------------- */
const norm = (v) => (v || '').trim().toLowerCase();
const formLabelOf = (key) => S.medicineForms.find((f) => f.key === key)?.label || key;

/** MedicineOut: {id, name, brand, composition, form, formLabel, strength, packSize, manufacturer, displayName, price} */
function medOut(m) {
  const brand = m.brand || null;
  const displayName =
    brand && m.composition && norm(m.composition) !== norm(brand) ? `${brand} (${m.composition})` : m.name;
  return {
    id: m.id,
    name: m.name,
    brand,
    composition: m.composition ?? '',
    form: m.form || 'drops',
    formLabel: formLabelOf(m.form || 'drops'),
    strength: m.strength ?? null,
    packSize: m.packSize ?? null,
    manufacturer: m.manufacturer ?? null,
    displayName,
    active: m.active !== false,
    price: m.price ?? null, // whole rupees per pack; null = not priced (Bought here bills ₹0 and flags it)
  };
}
const activeMeds = () => S.medicines.filter((m) => m.active !== false);
/** Medicine price from a form/patch value: whole rupees, or null when blank. */
function priceOf(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (Number.isNaN(n) || n < 0) throw httpError(422, 'Price must be 0 or more');
  return Math.round(n);
}
const medById = (id) => (id == null ? null : S.medicines.find((m) => m.id === Number(id)));
/** A typed name matches when it equals a medicine's name, brand or composition (case-insensitive). */
function medByText(text) {
  const t = norm(text);
  if (!t) return null;
  return (
    activeMeds().find((m) => norm(m.name) === t || norm(m.brand) === t || norm(m.composition) === t) || null
  );
}

/* ---------------- prescriptions ---------------- */
export const prescriptions = {
  // Real: GET /medicines?q= → [MedicineOut]; matches name, brand or composition, brand/prefix hits first
  async medicines({ q = '' } = {}) {
    const query = norm(q);
    const rows = activeMeds().filter(
      (m) =>
        !query ||
        norm(m.name).includes(query) ||
        norm(m.brand).includes(query) ||
        norm(m.composition).includes(query)
    );
    const rank = (m) => {
      if (!query) return 0;
      if (norm(m.brand).startsWith(query) || norm(m.name).startsWith(query)) return 0;
      if (norm(m.brand).includes(query) || norm(m.name).includes(query)) return 1;
      if (norm(m.composition).startsWith(query)) return 2;
      return 3;
    };
    return rows
      .map((m, i) => ({ m, i, r: rank(m) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map(({ m }) => medOut(m));
  },
  // Real: GET /visits/{id}/prescription → PrescriptionOut {id, visitId, printLanguage, lines}
  async get(patientId) {
    const p = S.patients.find((x) => x.id === Number(patientId));
    if (!p) throw httpError(404, 'Patient not found');
    return {
      id: p.id,
      visitId: p.id,
      printLanguage: p.printLanguage || 'english',
      diagnosisId: p.diagnosisId ?? null,
      diagnosisName: S.diagnoses.find((d) => d.id === p.diagnosisId)?.name ?? null,
      lines: (p.medicines || []).map(rxLineOut),
    };
  },
  // lines: [{name, medicineId?, dosage, qtyGiven}] — decrements stock only by qtyGiven.
  // `matched` when the typed name equals a medicine's name, brand or composition; stored name is canonical.
  async save(patientId, lines, printLanguage, diagnosisId = null) {
    await latency();
    const p = S.patients.find((x) => x.id === Number(patientId));
    if (!p) throw httpError(404, 'Patient not found');
    if (diagnosisId != null && !S.diagnoses.some((d) => d.id === Number(diagnosisId)))
      throw httpError(422, 'Unknown diagnosis');
    const resolved = lines.map((line) => {
      const med = medById(line.medicineId) || medByText(line.name);
      return {
        name: med ? med.name : line.name,
        medicineId: med ? med.id : null,
        matched: !!med,
        dosage: line.dosage || '',
        qtyGiven: Number(line.qtyGiven) || 0,
      };
    });
    // Saving never moves stock (the front desk confirms each medicine at billing). Confirmed
    // lines that stay keep their confirmation; confirmed lines the doctor removed give stock back.
    const lowStock = [];
    const prevLines = p.medicines || [];
    prevLines.forEach((old) => {
      if (old.dispensedQty > 0 && !resolved.some((l) => l.name.toLowerCase() === old.name.toLowerCase())) {
        const item = stockItemFor(old);
        if (item) {
          item.stock += old.dispensedQty;
          S.stockMovements.push({ id: S.stockMovements.length + 1, itemId: item.id, delta: old.dispensedQty, reason: 'adjusted', note: 'line removed', at: Date.now() });
        }
      }
    });
    p.medicines = resolved.map((l, i) => {
      const old = prevLines.find((m) => m.name.toLowerCase() === l.name.toLowerCase());
      return { id: i + 1, ...l, dispensedQty: old?.dispensedQty || 0, dispensedAt: old?.dispensedAt || null, dispensedBy: old?.dispensedBy || null };
    });
    p.diagnosisId = diagnosisId == null ? null : Number(diagnosisId);
    if (printLanguage) p.printLanguage = printLanguage;
    store.notify();
    // lowStock: mock keeps full items (name/stock/unit/reorder); real returns names only
    const out = p.medicines.map(rxLineOut);
    return {
      id: p.id,
      visitId: p.id,
      printLanguage: p.printLanguage || 'english',
      createdAt: new Date().toISOString(),
      diagnosisId: p.diagnosisId ?? null,
      diagnosisName: S.diagnoses.find((d) => d.id === p.diagnosisId)?.name ?? null,
      lines: out,
      medicines: out,
      lowStock,
    };
  },
  // Real: POST /visits/{id}/prescription/lines/{lineId}/dispense {qty} — front desk confirms "bought here"
  async dispense(patientId, lineId, qty) {
    await latency(40);
    const p = S.patients.find((x) => x.id === Number(patientId));
    if (!p) throw httpError(404, 'Patient not found');
    const line = (p.medicines || []).find((m) => m.id === Number(lineId));
    if (!line) throw httpError(404, 'Prescription line not found');
    if (line.dispensedQty > 0) throw httpError(422, `'${line.name}' is already marked as bought here — undo it first`);
    const item = stockItemFor(line);
    if (!item) throw httpError(422, `'${line.name}' is not a stock item — nothing to deduct`);
    const n = Number(qty) || 0;
    if (n < 1) throw httpError(422, 'qty must be at least 1');
    if (item.stock < n) throw httpError(409, `Only ${item.stock} of '${item.name}' in stock, ${n} asked for`);
    decrementStock(item.name, n, 'dispensed');
    line.dispensedQty = n;
    line.dispensedAt = new Date().toISOString();
    line.dispensedBy = currentUserName();
    syncMedicineLine(p, line, (medById(line.medicineId) || medByText(line.name))?.price ?? null); // onto the bill
    store.notify();
    const out = p.medicines.map(rxLineOut);
    const lowStock = item.stock <= item.reorder ? [c(item)] : [];
    return { id: p.id, visitId: p.id, printLanguage: p.printLanguage || 'english', diagnosisId: p.diagnosisId ?? null,
      diagnosisName: S.diagnoses.find((d) => d.id === p.diagnosisId)?.name ?? null, lines: out, medicines: out, lowStock };
  },
  async undispense(patientId, lineId) {
    await latency(40);
    const p = S.patients.find((x) => x.id === Number(patientId));
    if (!p) throw httpError(404, 'Patient not found');
    const line = (p.medicines || []).find((m) => m.id === Number(lineId));
    if (!line) throw httpError(404, 'Prescription line not found');
    if (line.dispensedQty > 0) {
      const item = stockItemFor(line);
      if (item) {
        item.stock += line.dispensedQty;
        S.stockMovements.push({ id: S.stockMovements.length + 1, itemId: item.id, delta: line.dispensedQty, reason: 'adjusted', note: 'bought-here undone', at: Date.now() });
      }
      line.dispensedQty = 0;
      line.dispensedAt = null;
      line.dispensedBy = null;
      dropMedicineLine(p, line.id); // and off the bill
      store.notify();
    }
    const out = p.medicines.map(rxLineOut);
    return { id: p.id, visitId: p.id, printLanguage: p.printLanguage || 'english', diagnosisId: p.diagnosisId ?? null,
      diagnosisName: S.diagnoses.find((d) => d.id === p.diagnosisId)?.name ?? null, lines: out, medicines: out, lowStock: [] };
  },
  // Real: GET /visits/{id}/prescription/print?lang= → {hospital, patient, language,
  //   lines[{name, dosage, dosageLocal, qtyGiven, brand, composition, form, formLabel, packSize}],
  //   exam, glasses, doctor, footerNote}  (the extra blocks: lane R, src/mocks/rxPrint.js)
  async printPayload(patientId, lang = 'english') {
    const p = S.patients.find((x) => x.id === Number(patientId));
    if (!p) throw httpError(404, 'Patient not found');
    const extras = rxPrintExtras(p, lang);
    return {
      ...extras,
      hospital: {
        name: 'Guru Krupa Eye Hospital & Laser Center',
        address: '201/320, The Grand Plaza, Opp. Fire Station, VIP Road, Vesu, Surat',
        phone: '9328621216, 7574998502',
        doctor: extras.doctor.name,
      },
      patient: {
        name: p.name,
        age: p.age,
        sex: p.sex,
        token: p.token,
        date: dateStr(0),
        patientId: p.externalId || String(p.patientId ?? p.id),
        area: (p.address || '').trim(),
      },
      language: lang,
      lines: (p.medicines || []).map((m) => {
        const med = medById(m.medicineId) || medByText(m.name);
        return {
          name: m.name,
          dosage: m.dosage || '',
          dosageLocal: localizeDosage(m.dosage || '', lang),
          qtyGiven: m.qtyGiven || 0,
          brand: med?.brand || null,
          composition: med?.composition || null,
          form: med?.form || null,
          formLabel: med ? formLabelOf(med.form) : null,
          packSize: med?.packSize || null,
        };
      }),
    };
  },
};

/** PrescriptionLineOut: {id, medicineId, name, matched, dosage, qtyGiven, form, formLabel} */
function rxLineOut(l, i) {
  const med = medById(l.medicineId) || medByText(l.name);
  return {
    id: l.id ?? i + 1,
    medicineId: med ? med.id : (l.medicineId ?? null),
    name: l.name,
    matched: l.matched ?? !!med,
    dosage: l.dosage || '',
    qtyGiven: Number(l.qtyGiven) || 0,
    dispensedQty: Number(l.dispensedQty) || 0,
    dispensedAt: l.dispensedAt || null,
    dispensedBy: l.dispensedBy || null,
    inStock: stockItemFor(l)?.stock ?? null,
    price: med?.price ?? null,
    form: med ? med.form : null,
    formLabel: med ? formLabelOf(med.form) : null,
  };
}
function stockItemFor(line) {
  return (
    (line.medicineId != null && S.inventory.find((i) => i.medicineId === line.medicineId)) ||
    S.inventory.find((i) => i.name === line.name) ||
    null
  );
}

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
  // POST /inventory {name?, medicineId?, unit, stock, reorderLevel} — name defaults to the medicine's name
  async create(data) {
    await latency();
    const { reorderLevel, ...rest } = data;
    const med = medById(rest.medicineId);
    if (rest.medicineId != null && !med) throw httpError(404, 'Medicine not found');
    const name = (rest.name || med?.name || '').trim();
    if (!name) throw httpError(422, 'name is required when medicineId is not given');
    if (S.inventory.some((i) => i.name.toLowerCase() === name.toLowerCase()))
      throw httpError(409, `'${name}' is already a stock item`);
    const item = { id: store.nextId('inventory'), unit: 'bottles', stock: 0, reorder: 0, ...rest, name };
    item.medicineId = med ? med.id : null;
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
    if (reason === 'received' && Number(delta) > 0 && item.orderedAt) {
      const remaining = (item.orderedQty || 0) - Number(delta);
      if (remaining > 0) item.orderedQty = remaining;
      else {
        item.orderedAt = null;
        item.orderedQty = null;
      }
    }
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
  async markOrdered(id, qty) {
    const item = S.inventory.find((i) => i.id === Number(id));
    if (!item) throw httpError(404, 'Item not found');
    item.orderedAt = new Date().toISOString();
    item.orderedQty = Number(qty) || null;
    store.notify();
    return invOut(c(item));
  },
  async clearOrdered(id) {
    const item = S.inventory.find((i) => i.id === Number(id));
    if (!item) throw httpError(404, 'Item not found');
    item.orderedAt = null;
    item.orderedQty = null;
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
  const med = medById(item.medicineId) || S.medicines.find((m) => m.name === item.name);
  return {
    ...item,
    reorderLevel: item.reorder,
    low: item.stock <= item.reorder,
    medicineId: med ? med.id : null,
    orderedAt: item.orderedAt ?? null,
    orderedQty: item.orderedQty ?? null,
    onOrder: !!item.orderedAt,
    lastReceivedAt: (() => {
      const m = S.stockMovements.filter((x) => x.itemId === item.id && x.reason === 'received' && x.delta > 0);
      return m.length ? new Date(Math.max(...m.map((x) => x.at))).toISOString() : null;
    })(),
    autoDeducted: S.protocolSteps.some((st) => st.name.toLowerCase() === item.name.toLowerCase()),
  };
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

function assertForm(form) {
  const keys = S.medicineForms.filter((f) => f.active !== false).map((f) => f.key);
  if (!keys.includes(form)) throw httpError(422, `form must be one of: ${keys.join(', ')}`);
}
const stagesOps = listOps('stages', 'stage');
function staffPhone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('91') && d.length === 12) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length !== 10) throw httpError(422, 'Mobile number must be 10 digits');
  return d;
}

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
  // /admin/standard-charges — one-tap bill charges (lane B, src/mocks/billing.js)
  standardCharges: standardChargesAdmin,
  // GET/POST/PATCH/DELETE /admin/medicines — soft delete, 409 dup name, 422 bad form
  medicines: {
    list: async ({ includeInactive = false } = {}) =>
      (includeInactive ? S.medicines : activeMeds()).map(medOut),
    get: async (id) => {
      const m = medById(id);
      if (!m) throw httpError(404, 'Medicine not found');
      return medOut(m);
    },
    create: async (data) => {
      const composition = (data.composition || '').trim();
      if (!composition) throw httpError(422, 'composition is required');
      const brand = (data.brand || '').trim() || null;
      const name = (data.name || '').trim() || brand || composition;
      const form = (data.form || 'drops').trim();
      assertForm(form);
      if (S.medicines.some((m) => norm(m.name) === norm(name)))
        throw httpError(409, `A medicine named '${name}' already exists`);
      const row = {
        id: store.nextId('medicine'),
        name,
        brand,
        composition,
        form,
        strength: (data.strength || '').trim() || null,
        packSize: (data.packSize || '').trim() || null,
        manufacturer: (data.manufacturer || '').trim() || null,
        price: priceOf(data.price),
        active: true,
      };
      S.medicines.push(row);
      store.notify();
      return medOut(row);
    },
    update: async (id, patch) => {
      const m = medById(id);
      if (!m) throw httpError(404, 'Medicine not found');
      if (patch.form !== undefined) assertForm(patch.form);
      if (patch.name !== undefined) {
        const name = (patch.name || '').trim();
        if (!name) throw httpError(422, 'name cannot be empty');
        if (S.medicines.some((x) => x.id !== m.id && norm(x.name) === norm(name)))
          throw httpError(409, `A medicine named '${name}' already exists`);
        m.name = name;
      }
      if (patch.composition !== undefined) {
        const comp = (patch.composition || '').trim();
        if (!comp) throw httpError(422, 'composition cannot be empty');
        m.composition = comp;
      }
      ['brand', 'strength', 'packSize', 'manufacturer'].forEach((k) => {
        if (patch[k] !== undefined) m[k] = (patch[k] || '').trim() || null; // "" clears
      });
      if (patch.form !== undefined) m.form = patch.form;
      if (patch.price !== undefined) m.price = priceOf(patch.price); // null / "" clears it
      if (patch.active !== undefined) m.active = !!patch.active;
      store.notify();
      return medOut(m);
    },
    remove: async (id) => {
      const m = medById(id);
      if (!m) throw httpError(404, 'Medicine not found');
      m.active = false;
      store.notify();
      return null;
    },
  },
  // /admin/medicine-forms — key ^[a-z0-9_-]+$, 409 dup / in use, PUT /order {keys}
  otSlots: {
    list: async () => c(sortedSlots()),
    create: async (label) => {
      const l = normSlot(label);
      if (S.otSlots.some((s) => s.label === l)) throw httpError(409, `Slot ${l} already exists`);
      const row = { id: store.nextId('otSlot'), label: l, active: true, sortOrder: S.otSlots.length };
      S.otSlots.push(row);
      store.notify();
      return c(row);
    },
    update: async (id, patch) => {
      const row = S.otSlots.find((s) => s.id === Number(id));
      if (!row) throw httpError(404, 'OT slot not found');
      if (patch.label !== undefined) {
        const l = normSlot(patch.label);
        if (l !== row.label) {
          if (S.otSlots.some((s) => s.label === l)) throw httpError(409, `Slot ${l} already exists`);
          if (slotInUse(row.label))
            throw httpError(409, `Upcoming surgeries are booked at ${row.label} — add a new slot instead of renaming`);
          row.label = l;
        }
      }
      if (patch.active !== undefined) row.active = !!patch.active;
      store.notify();
      return c(row);
    },
    remove: async (id) => {
      const idx = S.otSlots.findIndex((s) => s.id === Number(id));
      if (idx < 0) throw httpError(404, 'OT slot not found');
      const n = slotInUse(S.otSlots[idx].label);
      if (n) throw httpError(409, `${n} upcoming surger${n === 1 ? 'y is' : 'ies are'} booked at ${S.otSlots[idx].label} — switch it off instead`);
      S.otSlots.splice(idx, 1);
      store.notify();
      return null;
    },
    generate: async (start, end, everyMin) => {
      const parse = (t) => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
        if (!m) throw httpError(422, 'start and end must be HH:MM (24-hour)');
        return Number(m[1]) * 60 + Number(m[2]);
      };
      const a = parse(start);
      const b = parse(end);
      if (b < a) throw httpError(422, 'end must be after start');
      const labels = [];
      for (let t = a; t <= b; t += everyMin) {
        const h = Math.floor(t / 60);
        labels.push(normSlot(`${h}:${String(t % 60).padStart(2, '0')}`));
      }
      S.otSlots = S.otSlots.filter((s) => slotInUse(s.label));
      labels.forEach((label, i) => {
        if (!S.otSlots.some((s) => s.label === label))
          S.otSlots.push({ id: store.nextId('otSlot'), label, active: true, sortOrder: i });
      });
      store.notify();
      return c(sortedSlots());
    },
  },
  otProcedures: {
    list: async () => c([...S.otProcedures].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)),
    create: async (name) => {
      const n = (name || '').trim().replace(/\s+/g, ' ');
      if (!n) throw httpError(422, 'Procedure name is required');
      if (S.otProcedures.some((p) => p.name.toLowerCase() === n.toLowerCase()))
        throw httpError(409, `Procedure '${n}' already exists`);
      const row = { id: store.nextId('otProcedure'), name: n, active: true, sortOrder: S.otProcedures.length };
      S.otProcedures.push(row);
      store.notify();
      return c(row);
    },
    update: async (id, patch) => {
      const row = S.otProcedures.find((p) => p.id === Number(id));
      if (!row) throw httpError(404, 'Procedure not found');
      if (patch.name !== undefined) {
        const n = (patch.name || '').trim().replace(/\s+/g, ' ');
        if (!n) throw httpError(422, 'Procedure name is required');
        if (S.otProcedures.some((p) => p.id !== row.id && p.name.toLowerCase() === n.toLowerCase()))
          throw httpError(409, `Procedure '${n}' already exists`);
        row.name = n;
      }
      if (patch.active !== undefined) row.active = !!patch.active;
      store.notify();
      return c(row);
    },
    remove: async (id) => {
      const idx = S.otProcedures.findIndex((p) => p.id === Number(id));
      if (idx < 0) throw httpError(404, 'Procedure not found');
      const n = S.otCases.filter((k) => k.procedure === S.otProcedures[idx].name).length;
      if (n) throw httpError(409, `${n} surger${n === 1 ? 'y uses' : 'ies use'} '${S.otProcedures[idx].name}' — switch it off instead`);
      S.otProcedures.splice(idx, 1);
      store.notify();
      return null;
    },
    reorder: async (ids) => {
      ids.forEach((id, i) => {
        const row = S.otProcedures.find((p) => p.id === id);
        if (row) row.sortOrder = i;
      });
      store.notify();
      return c([...S.otProcedures].sort((a, b) => a.sortOrder - b.sortOrder));
    },
  },
  medicineForms: {
    list: async () => c(S.medicineForms),
    create: async ({ key, label }) => {
      const k = (key || '').trim();
      if (!/^[a-z0-9_-]+$/.test(k)) throw httpError(422, 'key must match ^[a-z0-9_-]+$');
      if (!(label || '').trim()) throw httpError(422, 'label is required');
      if (S.medicineForms.some((f) => f.key === k))
        throw httpError(409, `Medicine type '${k}' already exists`);
      const row = {
        id: store.nextId('medicineForm'),
        key: k,
        label: label.trim(),
        sortOrder: S.medicineForms.reduce((mx, f) => Math.max(mx, f.sortOrder ?? 0), -1) + 1,
        active: true,
      };
      S.medicineForms.push(row);
      store.notify();
      return c(row);
    },
    update: async (key, patch) => {
      const f = S.medicineForms.find((x) => x.key === key);
      if (!f) throw httpError(404, 'Medicine type not found');
      if (patch.label !== undefined) {
        if (!(patch.label || '').trim()) throw httpError(422, 'label cannot be empty');
        f.label = patch.label.trim();
      }
      if (patch.active !== undefined) f.active = !!patch.active;
      store.notify();
      return c(f);
    },
    remove: async (key) => {
      const idx = S.medicineForms.findIndex((x) => x.key === key);
      if (idx < 0) throw httpError(404, 'Medicine type not found');
      const n = S.medicines.filter((m) => m.form === key).length;
      if (n > 0) throw httpError(409, `${n} medicine(s) use form '${key}'`);
      S.medicineForms.splice(idx, 1);
      store.notify();
      return null;
    },
    reorder: async (keys) => {
      const rows = S.medicineForms;
      const ordered = keys.map((k) => rows.find((f) => f.key === k)).filter(Boolean);
      const rest = rows.filter((f) => !ordered.includes(f));
      S.medicineForms = [...ordered, ...rest].map((f, i) => ({ ...f, sortOrder: i }));
      store.notify();
      return c(S.medicineForms);
    },
  },
  staff: {
    list: async () => c(S.staff),
    create: async (data) => {
      if (S.staff.some((s) => s.username === data.username))
        throw httpError(409, 'That username is already taken');
      const phone = staffPhone(data.phone);
      if (S.staff.some((s) => s.phone === phone))
        throw httpError(409, `Mobile number ${phone} already belongs to another staff login`);
      const row = { id: store.nextId('staff'), active: true, role: 'reception', ...data, phone };
      delete row.password;
      S.staff.push(row);
      store.notify();
      return c(row);
    },
    update: async (id, patch) => {
      const row = S.staff.find((s) => s.id === Number(id));
      if (!row) throw httpError(404, 'Not found');
      if (patch.phone !== undefined) {
        const phone = staffPhone(patch.phone);
        if (S.staff.some((s) => s.id !== row.id && s.phone === phone))
          throw httpError(409, `Mobile number ${phone} already belongs to another staff login`);
        patch = { ...patch, phone };
      }
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

/* ---------------- diagnoses + treatment standards (B15/F17) ---------------- */
const HISTORY_MIN_SHARE = 0.5;
const lineKey = (n) => (n || '').toLowerCase().split(/\s+/).join(' ').trim();

function historyStandard(diagnosisId) {
  const rxs = [
    ...S.patients.filter((p) => p.diagnosisId === diagnosisId && (p.medicines || []).length),
    ...importedRx.filter((r) => r.diagnosisId === diagnosisId),
  ];
  const total = rxs.length;
  if (!total) return { lines: [], count: 0 };
  const perRx = {};
  rxs.forEach((p, i) =>
    (p.medicines || []).forEach((l) => {
      const k = lineKey(l.name);
      if (!k) return;
      const e = (perRx[k] ||= { name: l.name, rx: new Set(), dosages: {}, qtys: {}, medIds: {}, matched: false });
      e.rx.add(i);
      if (l.matched || l.medicineId != null || medByText(l.name)) e.matched = true;
      e.dosages[l.dosage || ''] = (e.dosages[l.dosage || ''] || 0) + 1;
      e.qtys[l.qtyGiven || 0] = (e.qtys[l.qtyGiven || 0] || 0) + 1;
      e.medIds[l.medicineId ?? 'null'] = (e.medIds[l.medicineId ?? 'null'] || 0) + 1;
    })
  );
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0][0];
  const lines = Object.values(perRx)
    .map((e) => ({ e, share: e.rx.size / total }))
    .filter(({ share }) => share >= HISTORY_MIN_SHARE)
    .map(({ e, share }) => {
      const mid = top(e.medIds);
      return {
        name: e.name,
        medicineId: mid === 'null' ? null : Number(mid),
        matched: mid !== 'null' || e.matched,
        dosage: top(e.dosages),
        qtyGiven: Number(top(e.qtys)),
        frequency: Math.round(share * 100) / 100,
      };
    })
    .sort((a, b) => b.frequency - a.frequency || a.name.localeCompare(b.name));
  return { lines, count: total };
}

function diagnosisOut(d) {
  return {
    ...c(d),
    prescriptionCount: S.patients.filter((p) => p.diagnosisId === d.id).length + importedRx.filter((r) => r.diagnosisId === d.id).length,
    hasStandard: !!S.treatmentStandards[d.id],
  };
}

function standardOut(d) {
  const hist = historyStandard(d.id);
  const std = S.treatmentStandards[d.id];
  if (std)
    return {
      diagnosisId: d.id,
      diagnosisName: d.name,
      source: 'admin',
      lines: c(std.lines),
      historyCount: hist.count,
      updatedAt: std.updatedAt,
      updatedBy: std.updatedBy,
      historyLines: hist.lines,
    };
  return {
    diagnosisId: d.id,
    diagnosisName: d.name,
    source: hist.lines.length ? 'history' : 'none',
    lines: hist.lines,
    historyCount: hist.count,
    historyLines: hist.lines,
  };
}

const diagById = (id) => {
  const d = S.diagnoses.find((x) => x.id === Number(id));
  if (!d) throw httpError(404, 'Diagnosis not found');
  return d;
};

export const treatments = {
  async diagnoses({ includeInactive = false } = {}) {
    return S.diagnoses
      .filter((d) => includeInactive || d.active !== false)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .map(diagnosisOut);
  },
  async standard(id) {
    await latency(40);
    return standardOut(diagById(id));
  },
  admin: {
    async create(name) {
      const n = (name || '').trim().replace(/\s+/g, ' ');
      if (!n) throw httpError(422, 'Diagnosis name is required');
      if (S.diagnoses.some((d) => d.name.toLowerCase() === n.toLowerCase()))
        throw httpError(409, `Diagnosis '${n}' already exists`);
      const row = {
        id: store.nextId('diagnosis'),
        name: n,
        active: true,
        sortOrder: S.diagnoses.reduce((m, d) => Math.max(m, d.sortOrder), -1) + 1,
      };
      S.diagnoses.push(row);
      store.notify();
      return diagnosisOut(row);
    },
    async update(id, patch) {
      const d = diagById(id);
      if (patch.name !== undefined) {
        const n = (patch.name || '').trim().replace(/\s+/g, ' ');
        if (!n) throw httpError(422, 'Diagnosis name is required');
        if (S.diagnoses.some((x) => x.id !== d.id && x.name.toLowerCase() === n.toLowerCase()))
          throw httpError(409, `Diagnosis '${n}' already exists`);
        d.name = n;
      }
      if (patch.active !== undefined) d.active = !!patch.active;
      store.notify();
      return diagnosisOut(d);
    },
    async remove(id) {
      const d = diagById(id);
      const used = S.patients.filter((p) => p.diagnosisId === d.id).length;
      if (used) throw httpError(409, `${used} prescription(s) use '${d.name}' — switch it off instead`);
      delete S.treatmentStandards[d.id];
      S.diagnoses.splice(S.diagnoses.indexOf(d), 1);
      store.notify();
      return null;
    },
    async reorder(ids) {
      if (ids.length !== S.diagnoses.length || !ids.every((i) => S.diagnoses.some((d) => d.id === i)))
        throw httpError(422, 'order must list every existing diagnosis exactly once');
      ids.forEach((i, n) => (S.diagnoses.find((d) => d.id === i).sortOrder = n));
      store.notify();
      return treatments.diagnoses({ includeInactive: true });
    },
    async saveStandard(id, lines) {
      await latency(60);
      const d = diagById(id);
      const resolved = (lines || [])
        .filter((l) => (l.name || '').trim())
        .map((l) => {
          const med = medById(l.medicineId) || medByText(l.name);
          return {
            name: med ? med.name : l.name.trim(),
            medicineId: med ? med.id : null,
            matched: !!med,
            dosage: (l.dosage || '').trim(),
            qtyGiven: Number(l.qtyGiven) || 0,
          };
        });
      S.treatmentStandards[d.id] = { lines: resolved, updatedAt: new Date().toISOString(), updatedBy: currentUserName() };
      store.notify();
      return standardOut(d);
    },
    async clearStandard(id) {
      const d = diagById(id);
      delete S.treatmentStandards[d.id];
      store.notify();
      return standardOut(d);
    },
  },
};

/* ---------------- spreadsheet import (B13/F15) — demo-mode version ----------------
   Parses CSV in the browser and applies the same rules as the server (patients by
   KiviHealth id or name+phone, medicines by name, stock levels, prescription rows
   grouped per patient + day). Excel needs the real server. */
const IMPORT_FIELDS = {
  patients: {
    label: 'Patients',
    fields: [
      { key: 'external_id', label: 'KiviHealth id', hint: 'Local Id, e.g. GK2341 — keeps re-imports from duplicating', syn: ['local id', 'localid', 'patient id', 'id', 'uhid'] },
      { key: 'name', label: 'Name', required: true, syn: ['name', 'patient name', 'patient'] },
      { key: 'phone', label: 'Phone', syn: ['contact', 'mobile', 'phone', 'mobile no', 'phone number'] },
      { key: 'sex', label: 'Gender', syn: ['gender', 'sex'] },
      { key: 'age', label: 'Age', syn: ['age', 'age(y)', 'age (y)'] },
      { key: 'dob', label: 'Date of birth', hint: 'kept as the date of birth; Age is used when it is empty', syn: ['dob', 'd o b', 'date of birth', 'birth date', 'birthdate'] },
      { key: 'address', label: 'Address', syn: ['address'] },
      { key: 'area', label: 'Area', hint: 'joined into the address', syn: ['area', 'locality'] },
      { key: 'city', label: 'City', hint: 'joined into the address', syn: ['city', 'town'] },
      { key: 'note', label: 'Note', syn: ['note', 'notes', 'remarks'] },
    ],
  },
  medicines: {
    label: 'Medicines',
    fields: [
      { key: 'name', label: 'Medicine name', required: true, syn: ['medicine name', 'medicine', 'name', 'drug'] },
      { key: 'manufacturer', label: 'Company', syn: ['company', 'manufacturer'] },
    ],
  },
  stock: {
    label: 'Stock levels',
    fields: [
      { key: 'name', label: 'Item name', required: true, syn: ['item', 'item name', 'medicine', 'medicine name', 'name', 'product'] },
      { key: 'stock', label: 'Quantity in stock', required: true, syn: ['stock', 'quantity', 'qty', 'in stock', 'balance'] },
      { key: 'unit', label: 'Unit', hint: 'bottles / tubes / strips', syn: ['unit', 'units', 'uom'] },
      { key: 'reorder_level', label: 'Reorder at', syn: ['reorder', 'reorder level', 'min stock'] },
    ],
  },
  prescriptions: {
    label: 'Prescriptions',
    fields: [
      { key: 'patient_external_id', label: 'Patient KiviHealth id', hint: 'matches patients imported with their Local Id', syn: ['local id', 'localid', 'patient id', 'uhid'] },
      { key: 'patient_name', label: 'Patient name', hint: 'used when there is no id column', syn: ['patient name', 'patient', 'name'] },
      { key: 'patient_phone', label: 'Patient phone', hint: 'helps match same-name patients', syn: ['contact', 'mobile', 'phone'] },
      { key: 'date', label: 'Date', required: true, syn: ['date', 'prescription date', 'visit date', 'appointment'] },
      { key: 'diagnosis', label: 'Diagnosis', hint: 'feeds the treatment standards', syn: ['diagnosis', 'complaint', 'condition', 'treatment'] },
      { key: 'medicine', label: 'Medicine', required: true, syn: ['medicine', 'medicine name', 'drug'] },
      { key: 'dosage', label: 'Dosage / instructions', syn: ['dosage', 'dose', 'instructions', 'frequency'] },
      { key: 'qty', label: 'Quantity given', syn: ['qty', 'quantity', 'total tablets'] },
    ],
  },
};
const IMPORT_FILES = {};
const normHeader = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9()]+/g, ' ').trim();
const BLANKS = new Set(['-', '--', 'na', 'n/a', 'null', 'none', 'nil', '.']);
const cleanCell = (v) => {
  const t = String(v ?? '').split(/\s+/).join(' ').trim();
  return BLANKS.has(t.toLowerCase()) ? '' : t;
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delim = (src.split('\n')[0].match(/\t/g) || []).length > 0 ? '\t' : (src.split('\n')[0].match(/;/g) || []).length > (src.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim()));
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim()));
  return rows;
}

const suggestMapping = (headers, target) => {
  const norm = Object.fromEntries(headers.map((h) => [normHeader(h), h]));
  const used = new Set();
  const out = {};
  IMPORT_FIELDS[target].fields.forEach((f) => {
    for (const syn of [f.label, ...f.syn]) {
      const h = norm[normHeader(syn)];
      if (h && !used.has(h)) {
        out[f.key] = h;
        used.add(h);
        break;
      }
    }
  });
  return out;
};
const normSex = (v) => {
  const t = (v || '').trim().toLowerCase();
  if (!t) return null;
  if (['m', 'male', 'man', 'boy'].includes(t)) return 'M';
  if (['f', 'female', 'woman', 'girl'].includes(t)) return 'F';
  return 'O';
};
const normPhone = (v) => {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('91') && d.length === 12) d = d.slice(2);
  return d.length >= 10 ? d.slice(-10) : d || null;
};
const normInt = (v) => {
  const t = String(v || '').replace(/[^\d-]/g, '');
  return t === '' || t === '-' ? null : Number(t);
};
const normDate = (v) => {
  const t = (v || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(t);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
};

function importRecords(info, mapping, target) {
  const missing = IMPORT_FIELDS[target].fields.filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
  if (missing.length) throw httpError(422, 'Match a column for: ' + missing.join(', '));
  const idx = Object.fromEntries(info.headers.map((h, i) => [h, i]));
  return info.rows.map((r) => {
    const rec = {};
    Object.entries(mapping).forEach(([k, h]) => {
      if (h && idx[h] != null) rec[k] = cleanCell(r[idx[h]]);
    });
    return rec;
  });
}

function importApply(target, recs, write) {
  const res = { target, total: recs.length, new: 0, update: 0, skip: 0, rows: [], written: false, warnings: [] };
  const add = (row, action, label, reason = '') => {
    res.rows.push({ row, action, label, reason });
    res[action] += 1;
  };
  if (target === 'patients') {
    const seen = new Set();
    recs.forEach((r, i) => {
      const n = i + 1;
      const name = r.name || '';
      const ext = r.external_id || null;
      if (!name) return add(n, 'skip', ext || '(blank)', 'no name');
      if (ext && seen.has(ext)) return add(n, 'skip', name, `${ext} appears twice in the file`);
      if (ext) seen.add(ext);
      const phone = normPhone(r.phone);
      const sex = normSex(r.sex);
      // A readable DOB is kept (the age follows from it); without one, Age(Y) as before.
      const dob = parseDobCell(r.dob);
      const age = dob ? ageFromDob(dob) : normInt(r.age);
      const address = [r.address, r.area, r.city].filter(Boolean).join(', ') || null;
      let existing = ext ? S.patients.find((p) => p.externalId === ext) : null;
      if (!existing)
        existing = S.patients.find((p) => p.name.toLowerCase() === name.toLowerCase() && (phone ? normPhone(p.phone) === phone : !p.phone));
      if (!existing) {
        add(n, 'new', name, ext || '');
        if (write) {
          const p = normalizePatient({ id: store.nextId('patient'), name, phone, sex, dob, age, address, externalId: ext, stage: null });
          p.stage = null;
          p.medicines = [];
          S.patients.push(p);
        }
        return;
      }
      const changes = [];
      if (ext && !existing.externalId) changes.push('id');
      if (phone && normPhone(existing.phone) !== phone) changes.push('phone');
      if (sex && existing.sex !== sex) changes.push('sex');
      if (dob && existing.dob !== dob) changes.push('dob');
      else if (!dob && !existing.dob && age != null && existing.age !== age) changes.push('age');
      if (address && existing.address !== address) changes.push('address');
      if (!changes.length) return add(n, 'skip', name, 'already here, nothing new');
      add(n, 'update', name, 'fills in ' + changes.join(', '));
      if (write)
        Object.assign(existing, {
          externalId: existing.externalId || ext,
          phone: phone && normPhone(existing.phone) !== phone ? phone : existing.phone,
          sex: sex || existing.sex,
          dob: dob || existing.dob || null,
          age: dob ? age : existing.dob ? existing.age : (age ?? existing.age),
          address: address || existing.address,
        });
    });
  } else if (target === 'medicines') {
    const seen = new Set();
    recs.forEach((r, i) => {
      const n = i + 1;
      const name = r.name || '';
      if (!name) return add(n, 'skip', '(blank)', 'no name');
      const key = name.toLowerCase();
      if (seen.has(key)) return add(n, 'skip', name, 'appears twice in the file');
      seen.add(key);
      const existing = S.medicines.find((m) => m.name.toLowerCase() === key);
      if (existing) return add(n, 'skip', name, 'already in the list');
      add(n, 'new', name, r.manufacturer || '');
      if (write) S.medicines.push({ id: store.nextId('medicine'), name, brand: null, composition: name, form: 'drops', manufacturer: r.manufacturer || null, active: true });
    });
  } else if (target === 'stock') {
    const seen = new Set();
    recs.forEach((r, i) => {
      const n = i + 1;
      const name = r.name || '';
      if (!name) return add(n, 'skip', '(blank)', 'no name');
      const qty = normInt(r.stock);
      if (qty == null || qty < 0) return add(n, 'skip', name, `quantity '${r.stock}' is not a number`);
      const key = name.toLowerCase();
      if (seen.has(key)) return add(n, 'skip', name, 'appears twice in the file');
      seen.add(key);
      const unit = ['bottles', 'tubes', 'strips'].includes((r.unit || '').toLowerCase()) ? r.unit.toLowerCase() : 'bottles';
      const item = S.inventory.find((it) => it.name.toLowerCase() === key);
      const med = medByText(name);
      if (!item) {
        add(n, 'new', name, `${qty} ${unit}` + (med ? ' · linked to medicine list' : ''));
        if (write) S.inventory.push({ id: store.nextId('inventory'), name: med ? med.name : name, unit, stock: qty, reorder: normInt(r.reorder_level) ?? 0, medicineId: med ? med.id : null });
        return;
      }
      if (item.stock === qty) return add(n, 'skip', name, 'stock already matches');
      add(n, 'update', name, `${item.stock} → ${qty} ${item.unit}`);
      if (write) item.stock = qty;
    });
  } else if (target === 'prescriptions') {
    const groups = new Map();
    recs.forEach((r, i) => {
      const n = i + 1;
      const ext = r.patient_external_id || '';
      const pname = r.patient_name || '';
      const on = normDate(r.date);
      const med = r.medicine || '';
      if (!ext && !pname) return add(n, 'skip', med || '(blank)', 'no patient id or name');
      if (!on) return add(n, 'skip', pname || ext, `date '${r.date}' not understood`);
      if (!med) return add(n, 'skip', pname || ext, 'no medicine');
      const key = `${ext || 'name:' + pname.toLowerCase()}|${on}|${(r.diagnosis || '').toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([n, r]);
    });
    groups.forEach((items) => {
      const [, first] = items[0];
      const patient =
        (first.patient_external_id && S.patients.find((p) => p.externalId === first.patient_external_id)) ||
        S.patients.find((p) => p.name.toLowerCase() === (first.patient_name || '').toLowerCase());
      const on = normDate(first.date);
      if (!patient) {
        items.forEach(([n]) => add(n, 'skip', first.patient_name || first.patient_external_id, 'patient not found — import patients first'));
        return;
      }
      patient.history ||= [];
      const meds = items.map(([, r]) => r.medicine.toLowerCase()).sort().join('|');
      if (patient.history.some((h) => h.date === on && (h.medicines || []).map((m) => m.name.toLowerCase()).sort().join('|') === meds)) {
        items.forEach(([n]) => add(n, 'skip', `${patient.name} · ${on}`, 'already imported'));
        return;
      }
      const label = `${patient.name} · ${on}` + (first.diagnosis ? ` · ${first.diagnosis}` : '');
      items.forEach(([n, r]) => add(n, 'new', label, r.medicine));
      if (!write) return;
      let dx = first.diagnosis ? S.diagnoses.find((d) => d.name.toLowerCase() === first.diagnosis.toLowerCase()) : null;
      if (!dx && first.diagnosis) {
        dx = { id: store.nextId('diagnosis'), name: first.diagnosis, active: true, sortOrder: S.diagnoses.length };
        S.diagnoses.push(dx);
      }
      const lines = items.map(([, r]) => {
        const m = medByText(r.medicine);
        return { name: m ? m.name : r.medicine, medicineId: m ? m.id : null, matched: !!m, dosage: r.dosage || '', qtyGiven: normInt(r.qty) || 0 };
      });
      patient.history.push({ date: on, diagnosisId: dx ? dx.id : null, medicines: lines, imported: true });
      // history-derived standards count imported prescriptions too
      importedRx.push({ diagnosisId: dx ? dx.id : null, medicines: lines });
    });
  }
  if (write) {
    res.written = true;
    store.notify();
  }
  return res;
}
const importedRx = [];

export const imports = {
  async targets() {
    return Object.entries(IMPORT_FIELDS).map(([key, t]) => ({ key, label: t.label, fields: t.fields.map(({ key: k, label, required = false, hint = '' }) => ({ key: k, label, required, hint })) }));
  },
  async upload(file) {
    const name = file.name || 'import.csv';
    if (/\.xlsx?$/i.test(name) && !USE_XLSX_IN_MOCK) throw httpError(422, 'Excel files need the real server — in demo mode use a CSV export');
    const text =
      typeof file.text === 'function'
        ? await file.text()
        : await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result || ''));
            fr.onerror = () => reject(new Error('Could not read the file'));
            fr.readAsText(file);
          });
    const rows = parseCsv(text);
    if (!rows.length) throw httpError(422, 'The file is empty');
    const headers = rows[0];
    const body = rows.slice(1);
    const token = Math.random().toString(16).slice(2).padEnd(32, '0').slice(0, 32);
    IMPORT_FILES[token] = { headers, rows: body };
    return {
      token,
      filename: name,
      headers,
      rowCount: body.length,
      sample: body.slice(0, 5),
      suggested: Object.fromEntries(Object.keys(IMPORT_FIELDS).map((t) => [t, suggestMapping(headers, t)])),
    };
  },
  async preview(token, target, mapping) {
    const info = IMPORT_FILES[token];
    if (!info) throw httpError(422, 'Upload not found — upload the file again');
    if (!IMPORT_FIELDS[target]) throw httpError(422, 'Unknown import type');
    return importApply(target, importRecords(info, mapping, target), false);
  },
  async run(token, target, mapping) {
    await latency(80);
    const info = IMPORT_FILES[token];
    if (!info) throw httpError(422, 'Upload not found — upload the file again');
    if (!IMPORT_FIELDS[target]) throw httpError(422, 'Unknown import type');
    return importApply(target, importRecords(info, mapping, target), true);
  },
};
const USE_XLSX_IN_MOCK = false;
