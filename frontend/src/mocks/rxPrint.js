/* Demo-mode printed-prescription extras (lane R owns this file): exam findings + glasses per visit,
   the admin lists (exam findings, lens types) and the print settings. Same method names and shapes
   as `rxPrint` in src/api/real.js. In demo mode a "visit" id is the patient row id.
   State lives in `store.state.rxPrint`, created on first use and re-created after `store.reset()`
   (which swaps the patients array the state is tied to). */
import { store, latency } from './store';
import {
  cleanGlasses,
  glassesFilled,
  normalizeGlasses,
  printGlasses,
  fmtIpd,
  fmtPower,
  fmtAxis,
} from '../screens/Queue/glasses';

const S = store.state;
const c = store.clone;

// Same starting lists as the server seed (backend/app/seed/rx.py); Admin edits them afterwards.
const SEED_EXAM = [
  ['lids', 'Lids & adnexa', 'Normal'],
  ['anterior', 'Anterior segment', 'Normal'],
  ['pupil', 'Pupil', 'Normal'],
  ['lens', 'Lens', 'Clear'],
  ['iop', 'IOP (mmHg)', ''],
  ['fundus', 'Fundus', 'Normal'],
];
const SEED_LENS = [
  ['arc', 'ARC'],
  ['blue_cut', 'Blue cut'],
  ['photochromic', 'Photochromic'],
  ['bifocal', 'Bifocal'],
  ['progressive', 'Progressive'],
];
const SEED_SETTINGS = {
  doctorName: 'Dr. Anu Juneja Pathak',
  degrees: 'M.S. Ophthalmology',
  regNo: '',
  footerNote: {
    english: 'Please bring your medicines when you come for the next visit.',
    gujarati: 'ફરી બતાવવા આવો ત્યારે દવા સાથે લાવવી.',
    hindi: 'अगली बार दिखाने आएँ तब दवाइयाँ साथ लाएँ।',
  },
};
// print language (client names) → footer note language
const FOOTER_LANG = {
  english: 'english',
  hinglish: 'hindi',
  hindi: 'hindi',
  gujlish: 'gujarati',
  gujarati: 'gujarati',
};

function state() {
  if (!S.rxPrint || S.rxPrint.owner !== S.patients) {
    S.rxPrint = {
      owner: S.patients,
      examFindings: SEED_EXAM.map(([key, label, defaultValue], i) => ({
        id: i + 1,
        key,
        label,
        defaultValue,
        sortOrder: i,
        active: true,
      })),
      lensTypes: SEED_LENS.map(([key, label], i) => ({ id: i + 1, key, label, sortOrder: i, active: true })),
      settings: c(SEED_SETTINGS),
      visits: {}, // visitId -> {exam:[{key,r,l}], glasses|null}
    };
  }
  return S.rxPrint;
}

function httpError(status, message) {
  const err = new Error(message);
  err.response = { status, data: { detail: message } };
  return err;
}

const visitRow = (id) => {
  const p = S.patients.find((x) => x.id === Number(id));
  if (!p) throw httpError(404, 'Visit not found');
  return p;
};
const ordered = (rows) => [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
const text = (v) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim();

function examRows(exam) {
  const findings = ordered(state().examFindings);
  const pos = (k) => {
    const i = findings.findIndex((f) => f.key === k);
    return i < 0 ? findings.length : i;
  };
  return (exam || [])
    .filter((r) => r.r || r.l)
    .sort((a, b) => pos(a.key) - pos(b.key))
    .map((r) => ({
      key: r.key,
      label: findings.find((f) => f.key === r.key)?.label || r.key,
      r: r.r,
      l: r.l,
    }));
}

/** The approved refraction reading of a demo visit: an approved reading from the Machines screen,
    else the demo patient's seeded readings (those count as checked). Refraction = SPH/CYL/AX per eye. */
function refractionFill(p) {
  const isRef = (vals) =>
    ['SPH (R)', 'AX (R)', 'SPH (L)', 'AX (L)'].every((l) => (vals || []).some((v) => v.l === l));
  const approved = (S.readings || [])
    .filter((r) => r.visitId === p.id && r.approved && isRef(r.values))
    .sort((a, b) => String(b.approvedAt).localeCompare(String(a.approvedAt)));
  const seeded = (p.readings || []).filter((r) => isRef(r.vals));
  const src = approved[0]
    ? {
        id: approved[0].id,
        machine: approved[0].machine,
        at: approved[0].approvedAt,
        vals: approved[0].values,
      }
    : seeded.length
      ? { id: 0, machine: seeded[seeded.length - 1].machine, at: null, vals: seeded[seeded.length - 1].vals }
      : null;
  if (!src) return null;
  const val = (l) => src.vals.find((v) => v.l === l)?.v ?? '';
  const safe = (fn, ...args) => {
    try {
      return fn(...args);
    } catch {
      return '';
    }
  };
  const eye = (tag) => {
    const cyl = safe(fmtPower, val(`CYL (${tag})`), 'Cyl', 10);
    return {
      sph: safe(fmtPower, val(`SPH (${tag})`)),
      cyl: cyl === 'Plano' ? '' : cyl,
      axis: safe(fmtAxis, val(`AX (${tag})`)),
      va: '',
    };
  };
  return {
    readingId: src.id,
    machine: src.machine,
    capturedAt: src.at,
    r: eye('R'),
    l: eye('L'),
    ipd: safe(fmtIpd, val('PD')),
  };
}

function out(p) {
  const saved = state().visits[p.id] || { exam: [], glasses: null };
  return {
    visitId: p.id,
    exam: examRows(saved.exam),
    glasses: glassesFilled(saved.glasses) ? normalizeGlasses(saved.glasses) : null,
    fromReading: refractionFill(p),
    va: { r: p.va?.R || '', l: p.va?.L || '' },
  };
}

/** The extra blocks of the demo print payload (used by prescriptions.printPayload in adapters.js). */
export function printExtras(p, lang = 'english') {
  const st = state();
  const saved = st.visits[p.id] || { exam: [], glasses: null };
  const notes = st.settings.footerNote || {};
  const footer = (notes[FOOTER_LANG[lang] || 'english'] || '').trim() || (notes.english || '').trim();
  const lensLabel = (k) => st.lensTypes.find((t) => t.key === k)?.label || k;
  return {
    exam: examRows(saved.exam).map(({ label, r, l }) => ({ label, r, l })),
    glasses: printGlasses(saved.glasses, lensLabel),
    doctor: { name: st.settings.doctorName, degrees: st.settings.degrees, regNo: st.settings.regNo },
    footerNote: footer,
  };
}

function listCreate(rows, label, extra, what) {
  const n = text(label);
  if (!n) throw httpError(422, `${what} needs a name`);
  if (rows.some((r) => r.label.toLowerCase() === n.toLowerCase()))
    throw httpError(409, `'${n}' is already on the list`);
  const base =
    n
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30) || 'item';
  let key = base;
  for (let i = 2; rows.some((r) => r.key === key); i += 1) key = `${base.slice(0, 27)}_${i}`;
  const row = {
    id: Math.max(0, ...rows.map((r) => r.id)) + 1,
    key,
    label: n,
    sortOrder: Math.max(0, ...rows.map((r) => r.sortOrder)) + 1,
    active: true,
    ...extra,
  };
  rows.push(row);
  return row;
}

function listUpdate(rows, key, patch, what) {
  const row = rows.find((r) => r.key === key);
  if (!row) throw httpError(404, `${what} not found`);
  if (patch.label != null) {
    const n = text(patch.label);
    if (!n) throw httpError(422, `${what} needs a name`);
    if (rows.some((r) => r !== row && r.label.toLowerCase() === n.toLowerCase()))
      throw httpError(409, `'${n}' is already on the list`);
    row.label = n;
  }
  if (patch.defaultValue != null && 'defaultValue' in row) row.defaultValue = text(patch.defaultValue);
  if (patch.active != null) row.active = !!patch.active;
  return row;
}

function listReorder(rows, keys) {
  if (keys.length !== rows.length || !rows.every((r) => keys.includes(r.key)))
    throw httpError(422, 'order must list every row exactly once');
  keys.forEach((k, i) => {
    rows.find((r) => r.key === k).sortOrder = i;
  });
  return ordered(rows);
}

export const rxPrint = {
  async get(visitId) {
    await latency(30);
    return c(out(visitRow(visitId)));
  },
  async save(visitId, body = {}) {
    await latency(60);
    const p = visitRow(visitId);
    const st = state();
    const exam = [];
    (body.exam || []).forEach((row) => {
      if (!st.examFindings.some((f) => f.key === row.key))
        throw httpError(422, `Unknown exam finding '${row.key}'`);
      const r = text(row.r);
      const l = text(row.l);
      if (r.length > 80 || l.length > 80) throw httpError(422, `${row.key}: keep it under 80 characters`);
      const i = exam.findIndex((x) => x.key === row.key);
      if (i >= 0) exam.splice(i, 1);
      if (r || l) exam.push({ key: row.key, r, l });
    });
    const glasses = cleanGlasses(
      body.glasses,
      st.lensTypes.map((t) => t.key)
    );
    st.visits[p.id] = { exam, glasses };
    store.notify();
    return c(out(p));
  },
  async lists() {
    await latency(20);
    const st = state();
    return c({
      examFindings: ordered(st.examFindings).filter((r) => r.active),
      lensTypes: ordered(st.lensTypes).filter((r) => r.active),
    });
  },
  async settings() {
    await latency(20);
    return c(state().settings);
  },
  admin: {
    async saveSettings(settings) {
      await latency(40);
      const st = state();
      const notes = settings?.footerNote || {};
      st.settings = {
        doctorName: text(settings?.doctorName),
        degrees: text(settings?.degrees),
        regNo: text(settings?.regNo),
        footerNote: {
          english: text(notes.english),
          hindi: text(notes.hindi),
          gujarati: text(notes.gujarati),
        },
      };
      store.notify();
      return c(st.settings);
    },
    async examFindings() {
      await latency(20);
      return c(ordered(state().examFindings));
    },
    async createExamFinding(label, defaultValue = '') {
      await latency(30);
      const row = listCreate(
        state().examFindings,
        label,
        { defaultValue: text(defaultValue) },
        'An exam finding'
      );
      store.notify();
      return c(row);
    },
    async updateExamFinding(key, patch = {}) {
      await latency(30);
      const row = listUpdate(state().examFindings, key, patch, 'Exam finding');
      store.notify();
      return c(row);
    },
    async reorderExamFindings(keys) {
      await latency(30);
      const rows = listReorder(state().examFindings, keys);
      store.notify();
      return c(rows);
    },
    async lensTypes() {
      await latency(20);
      return c(ordered(state().lensTypes));
    },
    async createLensType(label) {
      await latency(30);
      const row = listCreate(state().lensTypes, label, {}, 'A lens type');
      store.notify();
      return c(row);
    },
    async updateLensType(key, patch = {}) {
      await latency(30);
      const row = listUpdate(state().lensTypes, key, patch, 'Lens type');
      store.notify();
      return c(row);
    },
    async reorderLensTypes(keys) {
      await latency(30);
      const rows = listReorder(state().lensTypes, keys);
      store.notify();
      return c(rows);
    },
  },
};

/** The current print settings (doctor's name, degrees, reg. no.) — the demo OT uses them for the
    Surgeon row a new surgery starts with. */
export const printSettings = () => c(state().settings);
