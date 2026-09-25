/* Small money helpers shared by the bill, the receipt, the day book and "money still owed" (lane M). */
import { PAYMENT_MODES } from '../Queue/queueModel';

export const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export const modeLabel = (k) => PAYMENT_MODES.find((m) => m.key === k)?.label || k || '—';

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
