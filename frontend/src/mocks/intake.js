/* Demo-mode new-patient form (lane D owns this file). Same method names and shapes as `intake`
   in src/api/real.js: the lists the form needs, and a submit that creates the patient in today's
   queue and answers with the token only (plus the ids when a staff member is signed in). */
import { store, latency } from './store';
import { CONDITIONS, REFERRAL_NEEDS_DETAIL } from './data';
import { patients } from './adapters';
import { session } from '../api/client';
import { dobProblem, phoneKey } from '../lib/format';

const S = store.state;

export const SELF_FILLED_NOTE = 'Filled the new-patient form themselves: please check the details with them.';
export const SAME_PHONE_NOTE = 'Same phone as an existing patient: check for a duplicate.';

function httpError(status, message) {
  const err = new Error(message);
  err.response = { status, data: { detail: message } };
  return err;
}

export const intake = {
  // Real: GET /intake/lists (public) — only the admin lists, nothing about patients.
  async lists() {
    await latency(30);
    return {
      referralSources: S.referralSources.map((r) => ({
        key: r.key,
        label: r.label,
        needsDetail: REFERRAL_NEEDS_DETAIL.includes(r.key),
      })),
      conditions: [...CONDITIONS],
    };
  },
  // Real: POST /intake (public). Honeypot, 10-digit phone for the public page, known lists only.
  async submit(body) {
    await latency(60);
    const staff = !!session.getToken();
    if (!staff && body.website) throw httpError(400, 'Could not submit the form');
    const name = String(body.name || '').trim();
    if (!name) throw httpError(422, 'Name is needed');
    const key = phoneKey(body.phone);
    if (!staff && key.length < 10) throw httpError(422, 'A 10-digit mobile number is needed');
    if (body.dob && dobProblem(body.dob)) throw httpError(422, dobProblem(body.dob));
    if (body.referralSource && !S.referralSources.some((r) => r.key === body.referralSource))
      throw httpError(422, `Unknown referral source '${body.referralSource}'`);
    const notes = [];
    if (!staff) {
      notes.push(SELF_FILLED_NOTE);
      if (key.length >= 10 && S.patients.some((p) => phoneKey(p.phone) === key)) notes.push(SAME_PHONE_NOTE);
    }
    const { website: _honeypot, familyOwnerId, relationKey, ...fields } = body;
    // Staff only: "Add as a family member". The public page never links anyone.
    if (staff && familyOwnerId != null) Object.assign(fields, { familyOwnerId, relationKey: relationKey ?? null });
    const p = await patients.create({ ...fields, name, note: notes.join(' '), visitRegistered: true });
    return staff ? { token: p.token, patientId: p.id, visitId: p.id } : { token: p.token };
  },
};
