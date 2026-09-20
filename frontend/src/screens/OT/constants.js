/* OT / surgery constants (mockup `otModalOverlay` selects + status maps). */
export const OT_PROCEDURES = [
  'Cataract — Phaco with IOL (OD)',
  'Cataract — Phaco with IOL (OS)',
  'Cataract — Phaco with IOL (OU, staged)',
  'LASIK',
  'Other',
];

export const TECHNIQUES = ['Phacoemulsification', 'ECCE', 'SICS', 'LASIK'];
export const ANESTHESIA = ['Topical', 'Peribulbar', 'General'];
export const DEFAULT_SURGEON = 'Dr. Anu Juneja Pathak';
export const PAYMENT_MODES = [
  { key: 'cash', label: 'Cash' },
  { key: 'card', label: 'Card' },
  { key: 'upi', label: 'UPI' },
  { key: 'mediclaim', label: 'Mediclaim' },
];

export const OT_STATUS = {
  scheduled: { label: 'Scheduled', cls: 'teal' },
  in_progress: { label: 'In progress', cls: 'amber' },
  completed: { label: 'Completed', cls: 'sage' },
  cancelled: { label: 'Cancelled', cls: 'coral' },
};

export const BIOMETRY_ROWS = [
  { key: 'AL', label: 'AL (axial length)', ph: 'e.g. 22.90mm' },
  { key: 'ACD', label: 'ACD', ph: 'e.g. 2.70mm' },
  { key: 'K1', label: 'K1', ph: 'e.g. 43.27D' },
  { key: 'K2', label: 'K2', ph: 'e.g. 43.48D' },
  { key: 'targetRefraction', label: 'Target refraction', ph: 'e.g. -0.25D' },
];

/** "9:45 AM" → minutes since midnight, for sorting slots. */
export function slotMinutes(s) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(s || '').trim());
  if (!m) return 24 * 60;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return h * 60 + Number(m[2]);
}

export const caseSlot = (k) => k?.timeSlot ?? k?.time ?? '';

export const emptyBiometry = () => ({
  AL: { R: '', L: '' },
  ACD: { R: '', L: '' },
  K1: { R: '', L: '' },
  K2: { R: '', L: '' },
  targetRefraction: { R: '', L: '' },
});
