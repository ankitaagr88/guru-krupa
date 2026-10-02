/* Demo-mode doctor's panel (lane C owns this file): diagnoses on the visit and the follow-up
   date that books an appointment. Same method names and shapes as `doctor` in src/api/real.js.
   In demo mode a "patient" row is today's visit, and its prescription's diagnoses are the same
   `diagnosisIds` field (first = `diagnosisId`) — so visit and prescription stay in sync by
   construction. Older rows may carry only `diagnosisId`. */
import { store, latency } from './store';
import { dateStr } from './data';

const S = store.state;
const c = store.clone;

function httpError(status, message) {
  const err = new Error(message);
  err.response = { status, data: { detail: message } };
  return err;
}

function visitRow(id) {
  const p = S.patients.find((x) => x.id === Number(id));
  if (!p) throw httpError(404, 'Visit not found');
  return p;
}

const DEFAULT_MAX_DIAGNOSES = 3;

/** The clinic's limit of diagnoses per visit (Admin). */
export const maxDiagnoses = () => S.diagnosisSettings?.maxPerVisit ?? DEFAULT_MAX_DIAGNOSES;

/** A visit's / prescription's diagnoses in order (older rows: only `diagnosisId`). */
export function dxIdsOf(o) {
  if (Array.isArray(o?.diagnosisIds) && o.diagnosisIds.length) return o.diagnosisIds;
  return o?.diagnosisId != null ? [o.diagnosisId] : [];
}

/** {diagnosisId, diagnosisName, diagnoses} as VisitOut / PrescriptionOut return them. */
export function dxFields(o) {
  const diagnoses = dxIdsOf(o).map((id) => ({ id, name: S.diagnoses.find((d) => d.id === id)?.name ?? '' }));
  return { diagnosisId: diagnoses[0]?.id ?? null, diagnosisName: diagnoses[0]?.name ?? null, diagnoses };
}

/** The ids in order, repeats dropped; each must exist, and no more than the limit (422). */
export function cleanDiagnosisIds(ids) {
  const out = [];
  (ids || []).forEach((i) => {
    const n = Number(i);
    if (!out.includes(n)) out.push(n);
  });
  if (out.some((i) => !S.diagnoses.some((d) => d.id === i))) throw httpError(422, 'Unknown diagnosis');
  const limit = maxDiagnoses();
  if (out.length > limit) throw httpError(422, `At most ${limit} diagnoses per visit`);
  return out;
}

/** Store the (cleaned) ids on a visit row — its prescription follows, being the same row. */
export function setDiagnosisIds(p, ids) {
  p.diagnosisIds = [...ids];
  p.diagnosisId = ids[0] ?? null;
}

/** The appointment a visit's follow-up booked (latest; `openOnly` skips checked-in ones). */
export function followUpAppointment(visitId, { openOnly = false } = {}) {
  const rows = S.appointments.filter(
    (a) => a.sourceVisitId === Number(visitId) && (!openOnly || !a.checkedIn)
  );
  return rows[rows.length - 1] || null;
}

/** The visit as VisitOut would return it (diagnosis name + follow-up fields filled in). */
export function doctorVisitOut(p) {
  const appt = p.followUpDate ? followUpAppointment(p.id) : null;
  return {
    ...c(p),
    ...dxFields(p),
    maxDiagnoses: maxDiagnoses(),
    followUpDate: p.followUpDate ?? null,
    followUpNote: appt?.note || '',
    followUpAppointmentId: appt?.id ?? null,
  };
}

export const doctor = {
  async setDiagnosis(visitId, diagnosisId) {
    return doctor.setDiagnoses(visitId, diagnosisId == null ? [] : [diagnosisId]);
  },
  // several, in order (first = main); [] clears; more than the limit → 422
  async setDiagnoses(visitId, diagnosisIds) {
    await latency(30);
    const p = visitRow(visitId);
    setDiagnosisIds(p, cleanDiagnosisIds(diagnosisIds));
    store.notify();
    return doctorVisitOut(p);
  },
  async setFollowUp(visitId, date, note = '') {
    await latency(40);
    const p = visitRow(visitId);
    if (!date || date <= dateStr(0)) throw httpError(422, 'The follow-up date must be after this visit');
    p.followUpDate = date;
    let appt = followUpAppointment(p.id, { openOnly: true });
    if (!appt) {
      appt = { id: store.nextId('appointment'), channel: 'walkin', checkedIn: false, sourceVisitId: p.id };
      S.appointments.push(appt);
    }
    Object.assign(appt, {
      date,
      note: (note || '').trim(),
      name: p.name,
      phone: p.phone || null,
      patientId: p.patientId ?? p.id,
    });
    store.notify();
    return doctorVisitOut(p);
  },
  async clearFollowUp(visitId) {
    await latency(30);
    const p = visitRow(visitId);
    p.followUpDate = null;
    for (let i = S.appointments.length - 1; i >= 0; i -= 1) {
      const a = S.appointments[i];
      if (a.sourceVisitId === p.id && !a.checkedIn) S.appointments.splice(i, 1);
    }
    store.notify();
    return doctorVisitOut(p);
  },
};
