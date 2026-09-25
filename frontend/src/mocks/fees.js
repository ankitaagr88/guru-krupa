/* Demo-mode visit kinds and fee rules (lane E2 owns this file). Same method names and shapes as
   `fees` in src/api/real.js. In demo mode a "patient" row is today's visit, so the kind lives on
   it (`visitKindKey`, `emergency`); rows seeded without one get the suggestion from their last
   visit date the first time they are read. Mirrors app/services/fees.py. */
import { store } from './store';
import { doctorVisitOut } from './doctor';

const S = store.state;
const c = store.clone;
const DAY_MS = 24 * 60 * 60 * 1000;

function httpError(status, message) {
  const err = new Error(message);
  err.response = { status, data: { detail: message } };
  return err;
}

const kindByKey = (key) => S.visitKinds.find((k) => k.key === key) || null;
const chargeById = (id) => (id == null ? null : S.standardCharges.find((s) => s.id === Number(id)) || null);
const days = (n) => `${n} day${n === 1 ? '' : 's'}`;

function daysSince(dateStr) {
  if (!dateStr) return null;
  const then = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today - then) / DAY_MS));
}

/** Night window (may cross midnight) or Sunday, in the browser's time (the demo's clinic time). */
export function isEmergency(rules, at = new Date()) {
  const d = new Date(at);
  if (rules.emergencyOnSunday && d.getDay() === 0) return true;
  const mins = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + m;
  };
  const start = mins(rules.emergencyFrom);
  const end = mins(rules.emergencyTo);
  const t = d.getHours() * 60 + d.getMinutes();
  if (start === end) return false;
  return start < end ? t >= start && t < end : t >= start || t < end;
}

export function suggestKind(rules, ago) {
  if (ago == null) return rules.newPatientKind;
  if (ago <= rules.freeFollowUpDays) return rules.freeFollowUpKind;
  if (ago <= rules.newCaseAfterDays) return rules.followUpKind;
  return rules.newCaseKind;
}

/** Registration: store the suggested kind + emergency flag on the row (`at` = registration time;
    null = keep the row's own flag). */
export function applySuggestion(p, at = new Date()) {
  const rules = S.feeRules;
  const key = suggestKind(rules, daysSince(p.lastVisitDate));
  p.visitKindKey = kindByKey(key)?.active ? key : null;
  p.emergency = at ? rules.emergencyChargeId != null && isEmergency(rules, at) : !!p.emergency;
}

function ensureKind(p) {
  if (p.visitKindKey === undefined) applySuggestion(p, null); // seeded rows: suggested on first read
}

/** The VisitOut fee fields for a demo row. */
export function feeFields(p) {
  ensureKind(p);
  const kind = kindByKey(p.visitKindKey);
  const ago = daysSince(p.lastVisitDate);
  return {
    visitKindKey: p.visitKindKey,
    visitKindLabel: kind?.label ?? null,
    visitKindCharge: chargeById(kind?.standardChargeId)?.amount ?? null,
    emergency: !!p.emergency,
    daysSinceLastVisit: ago,
    feeReason:
      ago == null
        ? 'No earlier visit on record'
        : ago === 0
          ? 'Last visit earlier today'
          : `Last visit ${days(ago)} ago`,
  };
}

/** The visit as VisitOut returns it in demo mode: the doctor's fields + these fee fields. */
export const feeVisitOut = (p) => ({ ...doctorVisitOut(p), ...feeFields(p) });

/* ---------------- suggested bill lines (used by ./billing) ---------------- */
// The visit fee line reads like the visit type everywhere ("New patient", "Follow-up");
// the emergency line keeps its charge's name.
function line(ch, label = ch.label) {
  return {
    id: store.nextId('billItem'),
    label,
    amount: ch.amount,
    kind: 'charge',
    qty: 1,
    standardChargeId: ch.id,
  };
}

export function feeChargeIds() {
  const emergency = S.feeRules.emergencyChargeId ?? null;
  const kindIds = new Set(
    S.visitKinds.map((k) => k.standardChargeId).filter((id) => id != null && id !== emergency)
  );
  return { kindIds, emergency };
}

export function suggestedItems(p) {
  ensureKind(p);
  const kind = kindByKey(p.visitKindKey);
  const kindCharge = chargeById(kind?.standardChargeId);
  const em = p.emergency ? chargeById(S.feeRules.emergencyChargeId) : null;
  return [kindCharge ? line(kindCharge, kind.label) : null, em ? line(em) : null].filter(Boolean);
}

export function feeNote(p) {
  const kind = kindByKey(p.visitKindKey);
  if (!kind || kind.standardChargeId != null) return '';
  const r = S.feeRules;
  if (kind.key === r.freeFollowUpKind) return `Follow-up within ${days(r.freeFollowUpDays)} — no charge`;
  if (kind.key === r.postOpKind) return `After surgery (within ${days(r.postOpDays)}) — no charge`;
  return `${kind.label} — no charge`;
}

/** Kind / emergency changed: swap the suggested lines on an unpaid bill (one fee line, never two). */
function syncBill(p) {
  const b = p.bill;
  // no bill yet: start() suggests; money taken against it: the fee stays (like the server)
  if (!b || !(b.started || b.items?.length) || b.paidAt || (b.payments || []).length) return;
  const { kindIds, emergency } = feeChargeIds();
  const items = b.items || [];
  const feeLines = items.filter((it) => it.kind === 'charge' && kindIds.has(it.standardChargeId));
  const kind = kindByKey(p.visitKindKey);
  const ch = chargeById(kind?.standardChargeId);
  let next = items;
  if (ch) {
    const keep = feeLines.shift();
    if (keep)
      Object.assign(keep, {
        label: kind.label,
        amount: ch.amount,
        standardChargeId: ch.id,
        qty: 1,
        eyes: null,
      });
    else next = [...next, line(ch, kind.label)];
  }
  next = next.filter((it) => !feeLines.includes(it));
  if (emergency != null) {
    const has = next.some((it) => it.kind === 'charge' && it.standardChargeId === emergency);
    const em = p.emergency ? chargeById(emergency) : null;
    if (em && !has) next = [...next, line(em)];
    if (!em) next = next.filter((it) => !(it.kind === 'charge' && it.standardChargeId === emergency));
  }
  b.items = next;
}

/* ---------------- API ---------------- */
function visitRow(id) {
  const p = S.patients.find((x) => x.id === Number(id));
  if (!p) throw httpError(404, 'Visit not found');
  return p;
}

const kindOut = (k) => {
  const ch = chargeById(k.standardChargeId);
  const inUse = S.patients.filter((p) => p.visitKindKey === k.key).length;
  return { ...c(k), chargeLabel: ch?.label ?? null, chargeAmount: ch?.amount ?? null, inUse };
};
const orderedKinds = () => [...S.visitKinds].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
const KIND_FIELDS = ['newPatientKind', 'freeFollowUpKind', 'followUpKind', 'newCaseKind', 'postOpKind'];
const ruleUses = (key) => KIND_FIELDS.filter((f) => S.feeRules[f] === key);

function cleanLabel(label, exceptId) {
  const l = (label || '').split(/\s+/).filter(Boolean).join(' ');
  if (!l) throw httpError(422, 'Name is required');
  if (S.visitKinds.some((k) => k.id !== exceptId && k.label.toLowerCase() === l.toLowerCase()))
    throw httpError(409, `Visit kind '${l}' already exists`);
  return l;
}

function checkCharge(id) {
  if (id != null && !chargeById(id)) throw httpError(422, `Unknown standardChargeId ${id}`);
  return id ?? null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const fees = {
  async kinds() {
    return orderedKinds()
      .filter((k) => k.active)
      .map(kindOut);
  },
  async rules() {
    return c(S.feeRules);
  },
  async visitFee(visitId) {
    const p = visitRow(visitId);
    const f = feeFields(p);
    return {
      visitId: p.id,
      visitKindKey: f.visitKindKey,
      visitKindLabel: f.visitKindLabel,
      suggestedKindKey: suggestKind(S.feeRules, f.daysSinceLastVisit),
      emergency: f.emergency,
      suggestedEmergency: f.emergency,
      daysSinceLastVisit: f.daysSinceLastVisit,
      reason: f.feeReason,
      lines: suggestedItems(p).map(({ label, amount, standardChargeId }) => ({
        label,
        amount,
        standardChargeId,
      })),
      note: feeNote(p),
    };
  },
  async setKind(visitId, patch) {
    const p = visitRow(visitId);
    ensureKind(p);
    if (patch.visitKindKey != null) {
      const k = kindByKey(patch.visitKindKey);
      if (!k || !k.active) throw httpError(422, `Unknown visit kind '${patch.visitKindKey}'`);
      p.visitKindKey = k.key;
    }
    if (patch.emergency != null) p.emergency = !!patch.emergency;
    syncBill(p);
    store.notify();
    return feeVisitOut(p);
  },
  admin: {
    kinds: {
      async list() {
        return orderedKinds().map(kindOut);
      },
      async create({ label, standardChargeId = null }) {
        const l = cleanLabel(label);
        let key =
          l
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 24) || 'kind';
        const base = key;
        for (let n = 2; kindByKey(key); n++) key = `${base}_${n}`;
        const row = {
          id: store.nextId('visitKind'),
          key,
          label: l,
          standardChargeId: checkCharge(standardChargeId),
          sortOrder: Math.max(0, ...S.visitKinds.map((k) => k.sortOrder)) + 1,
          active: true,
        };
        S.visitKinds.push(row);
        store.notify();
        return kindOut(row);
      },
      async update(id, patch) {
        const row = S.visitKinds.find((k) => k.id === Number(id));
        if (!row) throw httpError(404, 'Visit kind not found');
        if (patch.label != null) row.label = cleanLabel(patch.label, row.id);
        if (patch.standardChargeId !== undefined) row.standardChargeId = checkCharge(patch.standardChargeId);
        if (patch.active != null) {
          if (!patch.active && ruleUses(row.key).length)
            throw httpError(
              409,
              `'${row.label}' is used by a fee rule below — pick another kind there first`
            );
          row.active = !!patch.active;
        }
        store.notify();
        return kindOut(row);
      },
      async remove(id) {
        const row = S.visitKinds.find((k) => k.id === Number(id));
        if (!row) throw httpError(404, 'Visit kind not found');
        if (ruleUses(row.key).length)
          throw httpError(409, `'${row.label}' is used by a fee rule — pick another kind there first`);
        const n = S.patients.filter((p) => p.visitKindKey === row.key).length;
        if (n)
          throw httpError(
            409,
            `'${row.label}' is on ${n} visit${n === 1 ? '' : 's'} — switch it off instead`
          );
        S.visitKinds = S.visitKinds.filter((k) => k.id !== row.id);
        store.notify();
        return null;
      },
      async reorder(ids) {
        if (ids.length !== S.visitKinds.length)
          throw httpError(422, 'order must list every existing visit kind exactly once');
        ids.forEach((id, i) => {
          const row = S.visitKinds.find((k) => k.id === Number(id));
          if (row) row.sortOrder = i;
        });
        store.notify();
        return orderedKinds().map(kindOut);
      },
    },
    async rules() {
      return c(S.feeRules);
    },
    async saveRules(patch) {
      const next = { ...S.feeRules };
      Object.entries(patch || {}).forEach(([k, v]) => {
        if (v !== undefined && (v !== null || k === 'emergencyChargeId')) next[k] = v;
      });
      ['emergencyFrom', 'emergencyTo'].forEach((k) => {
        let v = String(next[k] || '').trim();
        if (v.length === 4 && v[1] === ':') v = '0' + v;
        if (!HHMM.test(v)) throw httpError(422, 'time must be HH:MM (24-hour), e.g. 20:00');
        next[k] = v;
      });
      ['freeFollowUpDays', 'newCaseAfterDays', 'postOpDays'].forEach((k) => {
        const n = Number(next[k]);
        if (!Number.isInteger(n) || n < 0) throw httpError(422, 'Days must be a whole number, 0 or more');
        next[k] = n;
      });
      if (next.newCaseAfterDays <= next.freeFollowUpDays)
        throw httpError(422, "'New case after' must be more days than the free follow-up");
      KIND_FIELDS.forEach((f) => {
        if (!kindByKey(next[f])) throw httpError(422, `Unknown visit kind '${next[f]}'`);
      });
      checkCharge(next.emergencyChargeId);
      S.feeRules = next;
      store.notify();
      return c(next);
    },
  },
};
