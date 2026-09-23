/* Demo-mode billing (lane B owns this file): per-visit bill, standard charges, receipts,
   and the "Today" summary. Same method names and shapes as `billing` / `reports` /
   `admin.standardCharges` in src/api/real.js. In demo mode a "patient" row is today's visit,
   so the bill lives on it. */
import { store } from './store';
import { dateStr } from './data';

const S = store.state;
const c = store.clone;
const MIN = 60 * 1000;

function httpError(status, message) {
  const err = new Error(message);
  err.response = { status, data: { detail: message } };
  return err;
}

function visitRow(id) {
  const p = S.patients.find((x) => x.id === Number(id));
  if (!p) throw httpError(404, 'Visit not found');
  return p;
}

const sumItems = (items) => (items || []).reduce((s, it) => s + Number(it.amount || 0), 0);

/* The demo prescription renumbers its lines when the doctor saves again, so medicine lines
   are matched back by medicine name: still bought here -> follow the new line id; taken off
   the prescription (or undone) -> leave the bill. Mirrors the server's re-save behaviour. */
function reconcile(p) {
  if (!p.bill?.items) return;
  const bought = (p.medicines || []).filter((m) => Number(m.dispensedQty) > 0);
  p.bill.items = p.bill.items.filter((it) => {
    if (it.kind !== 'medicine' || !it.medicineName) return true;
    const line = bought.find((m) => m.name.toLowerCase() === it.medicineName.toLowerCase());
    if (!line) return false;
    it.prescriptionLineId = line.id;
    return true;
  });
}

function itemOut(it) {
  const kind = it.kind || 'other';
  return {
    id: it.id ?? null,
    label: it.label,
    amount: Number(it.amount || 0),
    kind,
    qty: Number(it.qty) || 1,
    standardChargeId: it.standardChargeId ?? null,
    prescriptionLineId: it.prescriptionLineId ?? null,
    priceMissing: kind === 'medicine' && Number(it.amount || 0) === 0,
  };
}

export function billOut(p) {
  reconcile(p);
  const b = p.bill || { items: [], paymentMode: null };
  return {
    id: p.id,
    visitId: p.id,
    items: (b.items || []).map(itemOut),
    total: sumItems(b.items),
    paymentMode: b.paymentMode ?? null,
    paidAt: b.paidAt ?? null,
    paid: !!b.paidAt,
    receiptNo: b.receiptNo ?? null,
    patientName: p.name,
    token: p.token,
    visitDate: dateStr(0),
  };
}

function withIds(items) {
  return c(items || []).map((it) => ({ ...it, id: it.id ?? store.nextId('billItem') }));
}

function nextReceiptNo() {
  const year = new Date().getFullYear();
  const n = EARLIER_TODAY.receipts.length + store.nextId('receipt');
  return `GK-${year}-${String(n).padStart(5, '0')}`;
}

// GET / PUT {items, paymentMode?} / POST pay {paymentMode} / GET charges
export const billing = {
  async get(visitId) {
    return billOut(visitRow(visitId));
  },
  async save(visitId, bill) {
    const p = visitRow(visitId);
    (bill.items || []).forEach((it) => {
      if (it.standardChargeId != null && !S.standardCharges.some((s) => s.id === Number(it.standardChargeId)))
        throw httpError(422, `Unknown standardChargeId ${it.standardChargeId}`);
    });
    const prev = p.bill?.items || [];
    const items = withIds(bill.items).map((it) => {
      // keep the medicine name the demo uses to follow a re-saved prescription
      const old = prev.find(
        (o) => o.id === it.id || (it.prescriptionLineId && o.prescriptionLineId === it.prescriptionLineId)
      );
      return old?.medicineName ? { ...it, medicineName: old.medicineName } : it;
    });
    p.bill = { ...p.bill, items };
    if (bill.paymentMode !== undefined) p.bill.paymentMode = bill.paymentMode;
    store.notify();
    return billOut(p);
  },
  async pay(visitId, paymentMode) {
    const p = visitRow(visitId);
    if (!p.bill) throw httpError(404, 'No bill for this visit');
    p.bill.paymentMode = paymentMode;
    p.bill.paidAt = Date.now();
    if (!p.bill.receiptNo) p.bill.receiptNo = nextReceiptNo();
    store.notify();
    return billOut(p);
  },
  async charges() {
    return c(S.standardCharges.filter((s) => s.active !== false).sort((a, b) => a.sortOrder - b.sortOrder));
  },
};

/* ---------------- "Bought here" -> bill line (called by the prescriptions mock) ---------------- */
export function syncMedicineLine(p, line, price) {
  p.bill = p.bill || { items: [], paymentMode: null };
  p.bill.items = p.bill.items || [];
  const qty = Number(line.dispensedQty) || 1;
  const amount = price != null ? qty * Number(price) : 0;
  let item = p.bill.items.find((it) => it.kind === 'medicine' && it.prescriptionLineId === line.id);
  if (!item) {
    item = { id: store.nextId('billItem'), kind: 'medicine', prescriptionLineId: line.id };
    p.bill.items.push(item);
  }
  Object.assign(item, { label: `${line.name} × ${qty}`, qty, amount, medicineName: line.name });
}

export function dropMedicineLine(p, lineId) {
  if (!p.bill?.items) return;
  p.bill.items = p.bill.items.filter(
    (it) => !(it.kind === 'medicine' && it.prescriptionLineId === Number(lineId))
  );
}

/* ---------------- Admin › Standard charges ---------------- */
const chargeById = (id) => {
  const row = S.standardCharges.find((s) => s.id === Number(id));
  if (!row) throw httpError(404, 'Charge not found');
  return row;
};
const cleanLabel = (label, exceptId) => {
  const l = (label || '').split(/\s+/).filter(Boolean).join(' ');
  if (!l) throw httpError(422, 'Charge name is required');
  if (S.standardCharges.some((s) => s.id !== exceptId && s.label.toLowerCase() === l.toLowerCase()))
    throw httpError(409, `Charge '${l}' already exists`);
  return l;
};
const ordered = () => c([...S.standardCharges].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id));

export const standardChargesAdmin = {
  async list() {
    return ordered();
  },
  async create({ label, amount = 0 }) {
    const row = {
      id: store.nextId('standardCharge'),
      label: cleanLabel(label),
      amount: Math.max(0, Math.round(Number(amount) || 0)),
      active: true,
      sortOrder: Math.max(0, ...S.standardCharges.map((s) => s.sortOrder)) + 1,
    };
    S.standardCharges.push(row);
    store.notify();
    return c(row);
  },
  async update(id, patch) {
    const row = chargeById(id);
    if (patch.label != null) row.label = cleanLabel(patch.label, row.id);
    if (patch.amount != null) {
      const n = Number(patch.amount);
      if (Number.isNaN(n) || n < 0) throw httpError(422, 'Amount must be 0 or more');
      row.amount = Math.round(n);
    }
    if (patch.active != null) row.active = !!patch.active;
    store.notify();
    return c(row);
  },
  async remove(id) {
    const row = chargeById(id);
    const used = S.patients.filter((p) =>
      (p.bill?.items || []).some((it) => it.standardChargeId === row.id)
    ).length;
    if (used)
      throw httpError(
        409,
        `'${row.label}' is on ${used} bill${used === 1 ? '' : 's'} — switch it off instead`
      );
    S.standardCharges = S.standardCharges.filter((s) => s.id !== row.id);
    store.notify();
    return null;
  },
  async reorder(ids) {
    if (ids.length !== S.standardCharges.length)
      throw httpError(422, 'order must list every existing charge exactly once');
    ids.forEach((id, i) => {
      chargeById(id).sortOrder = i;
    });
    store.notify();
    return ordered();
  },
};

/* ---------------- "Today" summary ---------------- */
const MODES = ['cash', 'upi', 'card', 'mediclaim'];

/* Demo only: the patients who came and went earlier today (before the queue you can see),
   so the summary has believable numbers the moment the demo opens. */
const EARLIER_TODAY = {
  patients: 6,
  avgVisitMinutes: 54,
  // minutes spent in each stage by those six (sum, visits)
  stages: { reg: [42, 6], pretest: [78, 6], doctor: [66, 6], dilate: [96, 3], billing: [30, 6] },
  receipts: [
    { name: 'Hetal Joshi', token: '#002', total: 750, mode: 'cash', minsAgo: 190 },
    { name: 'Rajesh Parmar', token: '#004', total: 1085, mode: 'upi', minsAgo: 165 },
    { name: 'Neha Kapadia', token: '#006', total: 500, mode: 'upi', minsAgo: 140 },
    { name: 'Dinesh Solanki', token: '#008', total: 2400, mode: 'mediclaim', minsAgo: 115 },
    { name: 'Meena Rathod', token: '#010', total: 860, mode: 'card', minsAgo: 80 },
    { name: 'Arjun Nair', token: '#013', total: 300, mode: 'cash', minsAgo: 50 },
  ],
  medicines: [
    ['Moxifloxacin 0.5% eye drops', 3, 255],
    ['Carboxymethylcellulose 0.5% (tear drops)', 2, 280],
    ['Timolol 0.5% eye drops', 1, 45],
  ],
};

function emptyReport(date, stages) {
  return {
    date,
    patients: { registered: 0, seen: 0, inProgress: 0 },
    avgVisitMinutes: null,
    stages: stages.map((s) => ({ key: s.key, label: s.label, avgMinutes: null, visits: 0, waitingNow: 0 })),
    collections: {
      byMode: MODES.map((mode) => ({ mode, bills: 0, amount: 0 })),
      total: 0,
      billsPaid: 0,
      unpaid: [],
      unpaidTotal: 0,
    },
    medicines: [],
    medicinesQty: 0,
    medicinesAmount: 0,
    receipts: [],
  };
}

function finish(rep) {
  rep.collections.total = rep.collections.byMode.reduce((s, m) => s + m.amount, 0);
  rep.collections.billsPaid = rep.collections.byMode.reduce((s, m) => s + m.bills, 0);
  rep.collections.unpaidTotal = rep.collections.unpaid.reduce((s, u) => s + u.total, 0);
  rep.medicinesQty = rep.medicines.reduce((s, m) => s + m.qty, 0);
  rep.medicinesAmount = rep.medicines.reduce((s, m) => s + m.amount, 0);
  return rep;
}

function addReceipt(rep, r) {
  const slot = rep.collections.byMode.find((m) => m.mode === r.paymentMode) || rep.collections.byMode[0];
  slot.bills += 1;
  slot.amount += r.total;
  rep.receipts.push(r);
}

function addMedicine(rep, name, qty, amount) {
  const row = rep.medicines.find((m) => m.name === name);
  if (row) {
    row.qty += qty;
    row.amount += amount;
  } else rep.medicines.push({ name, qty, amount });
}

function todayReport(date, stages) {
  const rep = emptyReport(date, stages);
  const year = new Date().getFullYear();
  const now = Date.now();
  const live = S.patients;
  const seenLive = live.filter((p) => p.stage === 'done').length;
  rep.patients = {
    registered: EARLIER_TODAY.patients + live.length,
    seen: EARLIER_TODAY.patients + seenLive,
    inProgress: live.length - seenLive,
  };
  rep.avgVisitMinutes = EARLIER_TODAY.avgVisitMinutes;
  rep.stages.forEach((s) => {
    const [sum, n] = EARLIER_TODAY.stages[s.key] || [0, 0];
    s.avgMinutes = n ? Math.round((sum / n) * 10) / 10 : null;
    s.visits = n;
    s.waitingNow = live.filter((p) => p.stage === s.key).length;
  });
  EARLIER_TODAY.receipts.forEach((r, i) =>
    addReceipt(rep, {
      receiptNo: `GK-${year}-${String(i + 1).padStart(5, '0')}`,
      visitId: null,
      name: r.name,
      token: r.token,
      total: r.total,
      paymentMode: r.mode,
      paidAt: new Date(now - r.minsAgo * MIN).toISOString(),
    })
  );
  EARLIER_TODAY.medicines.forEach(([name, qty, amount]) => addMedicine(rep, name, qty, amount));
  live.forEach((p) => {
    const b = billOut(p);
    if (b.paid)
      addReceipt(rep, {
        receiptNo: b.receiptNo,
        visitId: p.id,
        name: p.name,
        token: p.token,
        total: b.total,
        paymentMode: b.paymentMode,
        paidAt: new Date(b.paidAt).toISOString(),
      });
    else if (b.items.length)
      rep.collections.unpaid.push({ visitId: p.id, name: p.name, token: p.token, total: b.total });
    (p.medicines || [])
      .filter((m) => Number(m.dispensedQty) > 0)
      .forEach((m) => {
        const billed = b.items.find((it) => it.kind === 'medicine' && it.prescriptionLineId === m.id);
        addMedicine(rep, m.name, Number(m.dispensedQty), billed ? billed.amount : 0);
      });
  });
  return finish(rep);
}

/* An earlier day in the demo: steady made-up numbers from the date itself (same date, same
   numbers). Sundays the clinic is closed. */
function pastReport(date, stages) {
  const rep = emptyReport(date, stages);
  if (new Date(date + 'T00:00:00').getDay() === 0) return rep;
  let seed = [...date].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rnd = (lo, hi) => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return lo + (seed % (hi - lo + 1));
  };
  const seen = rnd(16, 28);
  rep.patients = { registered: seen, seen, inProgress: 0 };
  const typical = { reg: [4, 9], pretest: [10, 18], doctor: [8, 15], dilate: [28, 40], billing: [3, 8] };
  let visitMins = 0;
  rep.stages.forEach((s) => {
    const [lo, hi] = typical[s.key] || [3, 10];
    s.avgMinutes = rnd(lo, hi);
    s.visits = s.key === 'dilate' ? Math.round(seen / 3) : seen;
    visitMins += s.key === 'dilate' ? s.avgMinutes / 3 : s.avgMinutes;
  });
  rep.avgVisitMinutes = Math.round(visitMins + rnd(5, 12));
  const names = ['Patel', 'Shah', 'Desai', 'Mehta', 'Joshi', 'Trivedi', 'Parmar', 'Rana', 'Oza', 'Vaghela'];
  const year = date.slice(0, 4);
  const start = new Date(date + 'T09:30:00').getTime();
  for (let i = 0; i < seen; i++) {
    addReceipt(rep, {
      receiptNo: `GK-${year}-${String(rnd(100, 900) * 10 + i).padStart(5, '0')}`,
      visitId: null,
      name: `Patient ${names[rnd(0, names.length - 1)]}`,
      token: '#' + String(i + 1).padStart(3, '0'),
      total: [300, 500, 750, 860, 1085, 2400][rnd(0, 5)],
      paymentMode: ['cash', 'upi', 'upi', 'card', 'cash', 'mediclaim'][rnd(0, 5)],
      paidAt: new Date(start + i * rnd(15, 25) * MIN).toISOString(),
    });
  }
  [
    ['Moxifloxacin 0.5% eye drops', 85],
    ['Carboxymethylcellulose 0.5% (tear drops)', 140],
    ['Prednisolone acetate 1% eye drops', 60],
  ].forEach(([name, price]) => {
    const qty = rnd(1, 6);
    addMedicine(rep, name, qty, qty * price);
  });
  return finish(rep);
}

export const reports = {
  async today(date) {
    const day = date || dateStr(0);
    const stages = S.stages.filter((s) => s.key !== 'done');
    if (day === dateStr(0)) return todayReport(day, stages);
    if (day > dateStr(0)) return emptyReport(day, stages);
    return pastReport(day, stages);
  },
};
