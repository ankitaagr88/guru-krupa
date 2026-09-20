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
  const waitMs = now - (p.stageEnteredAt || now);
  const waitMin = waitMs / 60000;
  const waitCls = waitMin >= WAIT_CORAL_MIN ? 'coral' : waitMin >= WAIT_AMBER_MIN ? 'amber' : '';
  return { status, note, tags, wait: { text: fmtElapsed(waitMs), cls: waitCls } };
}
