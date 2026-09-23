/* Demo-mode doctor's panel (lane C owns this file): diagnosis on the visit and the follow-up
   date that books an appointment. Same method names and shapes as `doctor` in src/api/real.js.
   In demo mode a "patient" row is today's visit, and its prescription's diagnosis is the same
   `diagnosisId` field — so visit and prescription stay in sync by construction. */
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
    diagnosisId: p.diagnosisId ?? null,
    diagnosisName: S.diagnoses.find((d) => d.id === p.diagnosisId)?.name ?? null,
    followUpDate: p.followUpDate ?? null,
    followUpNote: appt?.note || '',
    followUpAppointmentId: appt?.id ?? null,
  };
}

export const doctor = {
  async setDiagnosis(visitId, diagnosisId) {
    await latency(30);
    const p = visitRow(visitId);
    if (diagnosisId != null && !S.diagnoses.some((d) => d.id === Number(diagnosisId)))
      throw httpError(422, 'Unknown diagnosis');
    p.diagnosisId = diagnosisId == null ? null : Number(diagnosisId);
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
