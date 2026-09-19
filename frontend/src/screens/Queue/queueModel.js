/* Queue data model helpers (F2/F3).
   The mock API returns the mockup's flat "patient == today's visit" rows; the real
   backend returns VisitOut with a nested `patient` and ISO timestamps. Everything
   the board / drawer renders goes through normalizeVisit() so the screens only ever
   see one shape:
     { id: visitId, patientId, token, stage, stageEnteredAt(ms), name, age, sex, phone,
       …patient fields…, va, note, doctorNotes, elsewhere, elsewhereNote,
       dilation: { currentIndex, steps:[{name,min,given,startedAt(ms),dueAt(ms),done}] }|null,
       readings[], examPhotos[], medicines[], bill } */

export function toMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** Dilation run → ms timestamps + per-step dueAt (server `dueAt` wins, else startedAt + min). */
export function normalizeDilation(d, skewMs = 0) {
  if (!d || !Array.isArray(d.steps)) return null;
  return {
    ...d,
    currentIndex: d.currentIndex ?? 0,
    startedAt: toMs(d.startedAt) != null ? toMs(d.startedAt) - skewMs : null,
    steps: d.steps.map((s) => {
      const min = s.min ?? s.minutes ?? 0;
      const startedAt = toMs(s.startedAt) != null ? toMs(s.startedAt) - skewMs : null;
      const due = toMs(s.dueAt);
      return {
        ...s,
        min,
        startedAt,
        dueAt: due != null ? due - skewMs : startedAt != null ? startedAt + min * 60000 : null,
      };
    }),
  };
}

export function normalizeVisit(v, now = Date.now()) {
  if (!v) return null;
  const patient = v.patient || {};
  const row = { ...patient, ...v };
  row.id = v.id;
  row.patientId = v.patientId ?? patient.id ?? v.id;
  // Prefer the server's waitingSeconds (immune to clock skew); fall back to the timestamp.
  let skew = 0;
  if (typeof v.waitingSeconds === 'number') {
    const local = now - v.waitingSeconds * 1000;
    const serverTs = toMs(v.stageEnteredAt);
    if (serverTs != null) skew = serverTs - local;
    row.stageEnteredAt = local;
  } else {
    row.stageEnteredAt = toMs(v.stageEnteredAt) ?? now;
  }
  row.va = { R: '', L: '', ...(v.va || {}) };
  row.note = row.note ?? '';
  row.doctorNotes = row.doctorNotes ?? '';
  row.elsewhere = !!row.elsewhere;
  row.elsewhereNote = row.elsewhereNote ?? '';
  row.existingConditions = Array.isArray(row.existingConditions) ? row.existingConditions : [];
  row.conditionOther = row.conditionOther ?? '';
  row.referralSource = row.referralSource ?? 'self';
  row.referralDetail = row.referralDetail ?? '';
  row.readings = Array.isArray(row.readings) ? row.readings : [];
  row.examPhotos = Array.isArray(row.examPhotos) ? row.examPhotos : [];
  row.medicines = Array.isArray(row.medicines) ? row.medicines : [];
  row.bill = row.bill && Array.isArray(row.bill.items) ? row.bill : { items: [], paymentMode: null };
  row.dilation = normalizeDilation(v.dilation, skew);
  return row;
}

export function normalizeVisits(list, now = Date.now()) {
  return (list || []).map((v) => normalizeVisit(v, now)).filter(Boolean);
}

/** Readings from GET /visits/{id}/readings (values) or the mock rows (vals). */
export function normalizeReading(r) {
  const vals = r.vals || r.values || [];
  const status = r.status || 'done';
  const processing = r.processing || status === 'pending' || status === 'processing';
  let src = r.src;
  if (!src && r.source) {
    const t = toMs(r.capturedAt);
    src =
      r.source +
      (t ? ', ' + new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '');
  }
  return { ...r, vals, status, processing, src: src || '', machine: r.machine || r.machineKey || '' };
}

export function normalizeExamPhoto(ph) {
  let capturedAt = ph.capturedAt;
  const t = toMs(capturedAt);
  if (t != null && typeof capturedAt !== 'string')
    capturedAt = new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  else if (typeof capturedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(capturedAt))
    capturedAt = new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return { ...ph, capturedAt: capturedAt || '' };
}

/** Bill from GET /visits/{id}/bill or the mock row. */
export function normalizeBill(b) {
  if (!b) return { items: [], paymentMode: null, paid: false };
  return {
    ...b,
    items: (b.items || []).map((it) => ({ ...it, amount: Number(it.amount || 0) })),
    paymentMode: b.paymentMode ?? null,
    paid: !!(b.paid || b.paidAt),
  };
}

export const VISIT_FIELDS = new Set(['note', 'doctorNotes', 'elsewhere', 'elsewhereNote']);

/** Split a drawer patch into what goes to PATCH /patients/{id} vs PATCH /visits/{id}. */
export function splitPatch(patch) {
  const patient = {};
  const visit = {};
  Object.keys(patch).forEach((k) => {
    if (VISIT_FIELDS.has(k)) visit[k] = patch[k];
    else patient[k] = patch[k];
  });
  // Treated-elsewhere lives on both records; keep the patient's copy in sync too.
  if ('elsewhere' in visit) patient.elsewhere = visit.elsewhere;
  if ('elsewhereNote' in visit) patient.elsewhereNote = visit.elsewhereNote;
  return { patient, visit };
}

export function numOrNull(v, { int = false } = {}) {
  if (v === '' || v == null) return null;
  const n = int ? parseInt(v, 10) : parseFloat(v);
  return Number.isFinite(n) ? (int ? n : Math.round(n)) : null;
}

/** Seconds left on the current dilation step (negative = overdue), or null if not waiting. */
export function stepRemaining(dilation, now = Date.now()) {
  if (!dilation) return null;
  const step = dilation.steps[dilation.currentIndex];
  if (!step || !step.given || step.done || step.dueAt == null) return null;
  return Math.floor((step.dueAt - now) / 1000);
}

export function dilationComplete(dilation) {
  return !!dilation && dilation.currentIndex >= dilation.steps.length;
}

export function referralNeedsDetail(sources, key) {
  const src = (sources || []).find((r) => r.key === key);
  if (src && typeof src.needsDetail === 'boolean') return src.needsDetail;
  return key === 'doctor' || key === 'patient';
}

export const CHANNEL_LABEL = { whatsapp: 'WhatsApp', call: 'Call', walkin: 'Walk-in' };
export const PAYMENT_MODES = [
  { key: 'cash', label: 'Cash' },
  { key: 'card', label: 'Card' },
  { key: 'upi', label: 'UPI' },
  { key: 'mediclaim', label: 'Mediclaim' },
];
export const LANGUAGES = [
  { key: 'english', label: 'English' },
  { key: 'hindi', label: 'हिंदी' },
  { key: 'gujarati', label: 'ગુજરાતી' },
];
export const SEXES = ['F', 'M', 'Other'];
