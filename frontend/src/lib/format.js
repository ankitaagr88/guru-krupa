/* Small formatting helpers ported from the mockup. Thresholds documented once
   here (task list B3: "compute fmtElapsed / computeRowStatus client-side"). */
import { REFERRAL_NEEDS_DETAIL } from '../mocks/data';

export const WAIT_AMBER_MIN = 20; // waiting >= 20 min → amber pill
export const WAIT_CORAL_MIN = 45; // waiting >= 45 min → coral pill

/** mm:ss countdown; negative → "+mm:ss" (overdue). */
export function fmtTime(sec) {
  const m = Math.floor(Math.abs(sec) / 60);
  const s = Math.abs(sec) % 60;
  return (sec < 0 ? '+' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

/** "just now" / "12 min" / "1h 05m" */
export function fmtElapsed(ms) {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return 'just now';
  if (totalMin < 60) return totalMin + ' min';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h + 'h ' + m + 'm';
}

/** "First visit" / "Today" / "3 days ago" / "2 months ago" */
export function fmtLastVisit(dateStrVal, todayStr = new Date().toISOString().slice(0, 10)) {
  if (!dateStrVal) return 'First visit';
  const days = Math.round((new Date(todayStr) - new Date(dateStrVal)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return days + ' days ago';
  const months = Math.round(days / 30);
  return months === 1 ? '1 month ago' : months + ' months ago';
}

/* ---- age & date of birth ----
   A DOB is kept as 'YYYY-MM-DD'; the age is worked out from it (same rule as the server). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MAX_AGE_YEARS = 120;

function dobParts(dob) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dob || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Today's date as 'YYYY-MM-DD' in the clinic's local time. */
export function localIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole years since the DOB, or null when there is no (valid) DOB. */
export function ageFromDob(dob, today = new Date()) {
  const p = dobParts(dob);
  if (!p) return null;
  const [y, m, d] = p;
  const tm = today.getMonth() + 1;
  const td = today.getDate();
  const age = today.getFullYear() - y - (tm < m || (tm === m && td < d) ? 1 : 0);
  return age >= 0 ? age : null;
}

/** "12 Mar 1964" */
export function fmtDob(dob) {
  const p = dobParts(dob);
  return p ? `${p[2]} ${MONTHS[p[1] - 1]} ${p[0]}` : '';
}

/** Plain-language problem with a typed DOB, or '' when it is fine (or empty). */
export function dobProblem(dob, today = new Date()) {
  if (!dob) return '';
  const p = dobParts(dob);
  if (!p) return 'Date of birth is not a real date.';
  const iso = localIso(today);
  if (dob.slice(0, 10) > iso) return 'Date of birth cannot be in the future.';
  const oldest = `${today.getFullYear() - MAX_AGE_YEARS}${iso.slice(4)}`;
  if (dob.slice(0, 10) < oldest) return `Date of birth is more than ${MAX_AGE_YEARS} years ago. Please check it.`;
  return '';
}

/** "62 y · F" (age from the DOB when there is one); "—" when neither is known. */
export function ageSexLabel(p) {
  if (!p) return '—';
  const age = p.dob ? ageFromDob(p.dob) : p.age;
  const parts = [];
  if (age != null && age !== '') parts.push(`${age} y`);
  if (p.sex) parts.push(p.sex[0]);
  return parts.length ? parts.join(' · ') : '—';
}

/** Digits only, last 10 — how two phone numbers are compared ("+91 98250 12345" = "9825012345"). */
export function phoneKey(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

/** A DOB cell from a spreadsheet → 'YYYY-MM-DD' or null. Understands dd/mm/yyyy, dd-mm-yyyy,
 *  d/m/yy (a two-digit year in the future means last century), yyyy-mm-dd and Excel serial numbers. */
export function parseDobCell(v, today = new Date()) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  let y;
  let mo;
  let d;
  let m;
  if (/^\d{1,5}(\.0+)?$/.test(t)) {
    const n = Math.floor(Number(t));
    if (n <= 60 || n >= 80000) return null;
    const dt = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    [y, mo, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  } else if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t))) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t))) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (m[3].length === 2) {
      y += 2000;
      if (y > today.getFullYear()) y -= 100;
    }
  } else return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return dobProblem(iso, today) ? null : iso;
}

export function ageSex(p) {
  return p.age ? p.age + (p.sex ? p.sex[0] : '') : '—';
}

/** Port of mockup computeRowStatus(p, st) → plain data, rendered by PatientCard/QueueRow.
 *  Returns { status: {text, cls}|null, note, tags: [{text, cls}], wait: {text, cls} } */
export function computeRowStatus(p, stageKey, now = Date.now()) {
  let status = null;
  const note = p.note || '';
  if (stageKey === 'dilate' && p.dilation) {
    const step = p.dilation.steps[p.dilation.currentIndex];
    const stepNum = p.dilation.currentIndex + 1;
    const total = p.dilation.steps.length;
    if (!step) {
      status = { text: '✓ All drops given · ready for doctor', cls: 'sage' };
    } else if (!step.given) {
      status = { text: `Step ${stepNum}/${total} · give ${step.name}`, cls: '' };
    } else {
      const elapsed = Math.floor((now - step.startedAt) / 1000);
      const remaining = step.min * 60 - elapsed;
      const overdue = remaining < 0;
      status = {
        text: `${overdue ? 'Overdue' : 'Dilating'} ${fmtTime(remaining)} · Step ${stepNum}/${total} ${step.name}`,
        cls: overdue ? 'coral' : 'amber',
        overdue,
      };
    }
  }
  const tags = [];
  if (p.elsewhere) tags.push({ text: 'Prior records on file', cls: 'teal' });
  if (REFERRAL_NEEDS_DETAIL.includes(p.referralSource) && p.referralDetail)
    tags.push({ text: 'Ref: ' + p.referralDetail, cls: 'sage' });
  if (Array.isArray(p.extraTags)) tags.unshift(...p.extraTags); // e.g. the visit kind (Queue.jsx)
  const waitMs = now - (p.stageEnteredAt || now);
  const waitMin = waitMs / 60000;
  const waitCls = waitMin >= WAIT_CORAL_MIN ? 'coral' : waitMin >= WAIT_AMBER_MIN ? 'amber' : '';
  return { status, note, tags, wait: { text: fmtElapsed(waitMs), cls: waitCls } };
}
