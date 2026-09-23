/* Demo-mode reception additions (lane A owns this file): the duplicate-patient check and
   other front-desk helpers. Same method names and shapes as `reception` in src/api/real.js. */
import { store, latency } from './store';
import { ageFromDob, phoneKey } from '../lib/format';

const S = store.state;

/** A demo patient as the server would send it: age worked out from the DOB when there is one. */
export function patientRead(p) {
  const out = store.clone(p);
  if (out.dob) out.age = ageFromDob(out.dob);
  return out;
}

export const reception = {
  // Real: GET /patients/by-phone?phone= — everyone on this number (families share phones).
  async samePhone(phone) {
    await latency(40);
    const key = phoneKey(phone);
    if (key.length < 10) return [];
    return S.patients
      .filter((p) => phoneKey(p.phone) === key)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => {
        // In demo mode a patient row is also today's visit: only an unfinished one counts as "in the queue".
        const active = p.visitRegistered !== false && p.stage && p.stage !== 'done';
        const lastVisitDate = p.lastVisitDate ?? (S.patientHistory[p.phone] || []).slice(-1)[0] ?? null;
        return {
          ...patientRead(p),
          lastVisitDate,
          visitId: active ? p.id : null,
          token: active ? p.token : null,
          stage: active ? p.stage : null,
        };
      });
  },
};
