/* Small helpers for the Machines screen. */

/** Normalise a queue row: mock mode returns the mockup's patient-per-visit
 *  objects, the real API returns VisitOut with a nested `patient`. */
export function visitRow(v) {
  const p = v.patient || {};
  return {
    id: v.id,
    patientId: v.patientId ?? p.id ?? v.id,
    name: p.name ?? v.name ?? '—',
    token: v.token ?? '',
    stage: v.stage,
    age: p.age ?? v.age ?? null,
    sex: p.sex ?? v.sex ?? null,
    readingsCount: v.readingsCount ?? (v.readings ? v.readings.length : 0),
  };
}

export function filterVisits(rows, query) {
  const q = (query || '').trim().toLowerCase();
  return rows.filter(
    (p) => p.stage !== 'done' && (!q || p.name.toLowerCase().includes(q) || (p.token || '').toLowerCase().includes(q))
  );
}

export const STATUS_META = {
  pending: { label: 'Pending', cls: 'amber' },
  processing: { label: 'Processing', cls: 'amber' },
  // Values read, not yet checked by a person ("Approved" once they are).
  done: { label: 'Needs approval', cls: 'amber' },
  failed: { label: 'Failed', cls: 'coral' },
};

export function isBusy(r) {
  return r?.status === 'pending' || r?.status === 'processing';
}

export function readingValues(r) {
  return r?.values ?? r?.vals ?? [];
}

export function readingLabel(r, machines = []) {
  return r?.machine ?? r?.machineLabel ?? machines.find((m) => m.key === r?.machineKey)?.label ?? r?.machineKey ?? '';
}

export const LOW_CONFIDENCE = 0.6;

/** Coral highlight rule: the field failed its sanity range, or the whole
 *  reading came back with low OCR confidence. */
export function isLowValue(v, r) {
  if (v?.ok === false) return true;
  return r?.confidence != null && r.confidence < LOW_CONFIDENCE;
}

export function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export function sourceLine(r) {
  const src = r?.source === 'manual' ? 'typed' : 'scanned';
  const when = fmtWhen(r?.capturedAt);
  return [src, when].filter(Boolean).join(', ') + (r?.corrected ? ' · corrected' : '');
}
