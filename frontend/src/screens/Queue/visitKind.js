/* Visit kinds & fees on the queue (lane E2): the small tag on each queue row and a few formatters
   shared by the drawer's VisitKindPanel and the bill. */

import { fmtRupees } from '../../lib/format';

export const rupees = fmtRupees;

/** What a kind costs, next to its name: "₹350", or "free" — unless the name already says so
    ("Follow-up · free" is not followed by another "free"). */
export function kindFeeText(label, charge) {
  if (charge != null) return fmtRupees(charge);
  return /free/i.test(label || '') ? '' : 'free';
}

/** "20:00" -> "8 pm", "08:30" -> "8:30 am". */
export function fmtClock(hhmm) {
  const [h, m] = String(hhmm || '')
    .split(':')
    .map(Number);
  if (Number.isNaN(h)) return hhmm || '';
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''} ${suffix}`;
}

/** "8 pm – 8 am, and Sundays" from the fee rules. */
export function emergencyWhen(rules) {
  if (!rules) return '';
  const hours =
    rules.emergencyFrom !== rules.emergencyTo
      ? `${fmtClock(rules.emergencyFrom)} – ${fmtClock(rules.emergencyTo)}`
      : '';
  if (hours && rules.emergencyOnSunday) return `${hours} and Sundays`;
  return hours || (rules.emergencyOnSunday ? 'Sundays' : '');
}

/** The kind's name as the queue shows it: "Follow-up · free" for a kind with no charge. */
export function kindTagText(label, charge) {
  if (!label) return '';
  return charge == null && !/free/i.test(label) ? `${label} · free` : label;
}

/** Tags for a queue row (see computeRowStatus's `extraTags`). */
export function visitKindTags(row) {
  const tags = [];
  if (row?.visitKindLabel) {
    tags.push({
      text: kindTagText(row.visitKindLabel, row.visitKindCharge),
      cls: row.visitKindCharge == null ? 'done' : 'info',
    });
  }
  if (row?.emergency) tags.push({ text: 'Emergency', cls: 'alert' });
  return tags;
}
