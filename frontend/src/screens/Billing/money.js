/* Small money helpers shared by the bill, the receipt, the day book and "money still owed" (lane M). */
import { PAYMENT_MODES } from '../Queue/queueModel';
import { fmtRupees } from '../../lib/format';

export const rupees = fmtRupees;

export const modeLabel = (k) => PAYMENT_MODES.find((m) => m.key === k)?.label || k || '—';

/** "Cash + UPI" — the modes of a bill's payments, in the order they came (each once). */
export const modesText = (payments, fallbackMode = null) =>
  [...new Set((payments || []).map((p) => modeLabel(p.mode)))].join(' + ') ||
  (fallbackMode ? modeLabel(fallbackMode) : '');

/** "24 Sep" (or "24 Sep 2025" when not this year) for a YYYY-MM-DD or ISO date. */
export function shortDate(d) {
  if (!d) return '';
  const dt = new Date(String(d).length === 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return String(d);
  const opts = { day: 'numeric', month: 'short' };
  if (dt.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return dt.toLocaleDateString('en-IN', opts);
}

export const timeOf = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—';
