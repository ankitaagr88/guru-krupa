/* Demo-mode billing (lanes B and M own this file): per-visit bill, standard charges, part payments,
   receipts, money still owed and the "Today" summary. Same method names and shapes as `billing` /
   `reports` / `admin.standardCharges` in src/api/real.js. In demo mode a "patient" row is today's
   visit, so the bill lives on it: p.bill = {items, paymentMode, paidAt, receiptNo, started,
   payments:[{id, amount, mode, at, byName, note}]}.

   Lane M's demo state (day-book columns and settings, earlier visits' bills still owing, the cash
   drawer) lives in `money()` below — created on first use and again after `mockStore.reset()`
   (it is keyed on the store's `seq` object, which a reset replaces). */
import { store } from './store';
import { dateStr } from './data';
import { feeChargeIds, feeFields, feeNote, suggestedItems } from './fees';

const S = store.state;
const c = store.clone;
const MIN = 60 * 1000;
const MODES = ['cash', 'upi', 'card', 'mediclaim'];

function httpError(status, message) {
  const err = new Error(message);
  err.response = { status, data: { detail: message } };
  return err;
}

function staffName() {
  try {
    return JSON.parse(localStorage.getItem('gk_user') || 'null')?.name || 'Reception desk';
  } catch {
    return 'Reception desk';
  }
}

/* ---------------- lane M demo state ---------------- */
// Day-book columns, like the clinic's cash sheet (Admin › Day book columns).
const HEADS = [
  ['opd', 'OPD'],
  ['med', 'MED'],
  ['test', 'TEST'],
  ['glasses', 'GLASSES'],
  ['ot', 'OT'],
  ['other', 'OTHER'],
];
const GROUP_HEADS = { 'visit fees': 'opd', tests: 'test', packages: 'test', glasses: 'glasses' };

let slot = null;
/** Lane M's demo state; fresh after mockStore.reset(). Also gives every standard charge its
    day-book column and adds the "Glasses" charge (₹0 = price typed at billing), like the seed. */
export function money() {
  if (slot && slot.owner === S.seq) return slot;
  const yesterday = dateStr(-1);
  slot = {
    owner: S.seq,
    heads: HEADS.map(([key, label], i) => ({ id: i + 1, key, label, sortOrder: i, active: true })),
    settings: { medicineHead: 'med', otherHead: 'other', otHead: 'ot' },
    // Earlier visits' bills (not in today's queue). Bharat Oza still owes ₹60 from yesterday.
    oldBills: [
      {
        visitId: 9001,
        patientId: 5,
        name: 'Bharat Oza',
        phone: '90999 45678',
        ageSex: '71/M',
        area: 'Ghod Dod Road, Surat',
        token: '#011',
        date: yesterday,
        receiptNo: `GK-${yesterday.slice(0, 4)}-00090`,
        items: [
          { id: 9101, label: 'Follow-up', amount: 350, kind: 'charge', standardChargeId: 2, accountHeadKey: 'opd' },
          { id: 9102, label: 'Timolol 0.5% eye drops × 1', amount: 60, kind: 'medicine', accountHeadKey: 'med' },
        ],
        payments: [
          { id: 9201, amount: 350, mode: 'cash', at: `${yesterday}T06:10:00.000Z`, byName: 'Reception desk', note: '' },
        ],
      },
    ],
    // Cash drawer: yesterday opened with ₹4,040 and the doctor took ₹3,000 home.
    cashDays: { [yesterday]: { openingCash: 4040, setBy: 'Reception desk', setAt: `${yesterday}T03:30:00.000Z`, note: '' } },
    movements: [
      { id: 1, day: yesterday, direction: 'out', amount: 3000, person: 'MAAM', reason: 'Taken home', at: `${yesterday}T13:00:00.000Z`, byName: 'Reception desk' },
    ],
    seq: { payment: 9300, movement: 1, head: HEADS.length },
  };
  S.standardCharges.forEach((ch) => {
    if (ch.accountHeadKey === undefined)
      ch.accountHeadKey = GROUP_HEADS[(ch.groupLabel || '').trim().toLowerCase()] || 'other';
  });
  tidySeededBills();
  if (!S.standardCharges.some((ch) => ch.label.toLowerCase() === 'glasses')) {
    S.standardCharges.push({
      id: store.nextId('standardCharge'),
      label: 'Glasses',
      amount: 0,
      amountBothEyes: null,
      groupLabel: 'Glasses',
      accountHeadKey: 'glasses',
      active: true,
      sortOrder: Math.max(0, ...S.standardCharges.map((s) => s.sortOrder)) + 1,
    });
  }
  return slot;
}

/* The demo seed (mocks/data.js) gives one billing-stage patient a hand-written bill:
   "Consultation fee" + "Pre-test charges", with no kind, charge or day-book column — so the fee
   disagreed with the visit type and landed under OTHER. Tidy it the way the app builds bills: the
   consultation becomes the visit type's fee line (it follows the visit type from then on; the
   seeded amount stays, as if reception had given a discount) and any other seeded line is a typed
   line with its column. */
const SEED_LINE_HEADS = { 'pre-test charges': 'test' };
function tidySeededBills() {
  S.patients.forEach((p) => {
    const items = p.bill?.items || [];
    if (!items.some((it) => !it.kind)) return;
    const isFee = (it) => !it.kind && /consultation/i.test(it.label || '');
    const typed = items
      .filter((it) => !isFee(it))
      .map((it) =>
        it.kind
          ? it
          : {
              ...it,
              id: it.id ?? store.nextId('billItem'),
              kind: 'other',
              qty: 1,
              accountHeadKey: SEED_LINE_HEADS[String(it.label).toLowerCase()] || 'other',
            }
      );
    const fee = items.find(isFee);
    const feeLines = fee
      ? suggestedItems(p).map((it, i) =>
          i === 0 && it.standardChargeId !== S.feeRules.emergencyChargeId
            ? { ...it, amount: Number(fee.amount) || it.amount }
            : it
        )
      : [];
    p.bill.items = [...feeLines, ...typed];
    p.bill.started = true;
  });
}

/** The day-book column a line goes under (mirrors the server's `line_head`). */
export function lineHead(it) {
  const m = money();
  if (it.accountHeadKey) return it.accountHeadKey;
  const ch = it.standardChargeId != null ? S.standardCharges.find((s) => s.id === Number(it.standardChargeId)) : null;
  if (ch?.accountHeadKey) return ch.accountHeadKey;
  return it.kind === 'medicine' ? m.settings.medicineHead : m.settings.otherHead;
}

function visitRow(id) {
  const p = S.patients.find((x) => x.id === Number(id));
  if (!p) throw httpError(404, 'Visit not found');
  return p;
}

const sumItems = (items) => (items || []).reduce((s, it) => s + Number(it.amount || 0), 0);
const sumPaid = (b) => (b?.payments || []).reduce((s, x) => s + Number(x.amount || 0), 0);

/** unpaid | part_paid | paid | no_charge | overpaid (same as the server). */
function statusOf(b) {
  const total = sumItems(b?.items);
  const paid = sumPaid(b);
  if (total === 0 && paid === 0) return b?.paidAt ? 'no_charge' : 'unpaid';
  if (paid > total) return 'overpaid';
  if (paid === total) return 'paid';
  return paid > 0 ? 'part_paid' : 'unpaid';
}

/** Keep paidAt / paymentMode in step with the payments (see app.services.billing.settle). */
function settle(b) {
  const total = sumItems(b.items);
  const paid = sumPaid(b);
  if (b.payments?.length) b.paymentMode = b.payments[b.payments.length - 1].mode;
  if (paid > 0 && paid >= total) {
    if (!b.paidAt) b.paidAt = b.payments[b.payments.length - 1].at;
  } else if (total > 0 || paid > 0) b.paidAt = null;
}

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

function itemOut(it, feeIds) {
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
    eyes: it.eyes ?? null,
    suggested: kind === 'charge' && feeIds.has(it.standardChargeId),
    accountHeadKey: lineHead(it),
  };
}

function moneyFields(b) {
  const total = sumItems(b?.items);
  const paidAmount = sumPaid(b);
  const status = statusOf(b);
  return {
    total,
    paymentMode: b?.paymentMode ?? null,
    paidAt: b?.paidAt ?? null,
    paid: ['paid', 'no_charge', 'overpaid'].includes(status),
    receiptNo: b?.receiptNo ?? null,
    payments: c(b?.payments || []),
    paidAmount,
    balance: total - paidAmount,
    status,
  };
}

/* A bill exists once it was started (the billing panel opened it, "Bought here", a save) — or
   the demo seeded it with lines. Until then GET 404s, like the server. */
const started = (p) => {
  money();
  return !!(p.bill && (p.bill.started || p.bill.paidAt || (p.bill.items || []).length));
};

/** A new bill starts with the visit's suggested fee lines (visit kind + Emergency when flagged). */
function startBill(p) {
  if (started(p)) return;
  p.bill = { ...(p.bill || {}), items: suggestedItems(p), paymentMode: p.bill?.paymentMode ?? null, started: true };
}

export function billOut(p) {
  money();
  reconcile(p);
  const b = p.bill || { items: [], paymentMode: null };
  const { kindIds, emergency } = feeChargeIds();
  const feeIds = new Set([...kindIds, ...(emergency != null ? [emergency] : [])]);
  const fee = feeFields(p);
  return {
    id: p.id,
    visitId: p.id,
    items: (b.items || []).map((it) => itemOut(it, feeIds)),
    ...moneyFields(b),
    patientId: p.id,
    patientName: p.name,
    token: p.token,
    visitDate: dateStr(0),
    visitKindKey: fee.visitKindKey,
    visitKindLabel: fee.visitKindLabel,
    emergency: fee.emergency,
    feeNote: feeNote(p),
  };
}

/** An earlier visit's bill (demo `oldBills`) in BillOut shape. */
function oldBillOut(o) {
  return {
    id: o.visitId,
    visitId: o.visitId,
    items: o.items.map((it) => itemOut(it, new Set())),
    ...moneyFields(o),
    patientId: o.patientId,
    patientName: o.name,
    token: o.token,
    visitDate: o.date,
    visitKindKey: null,
    visitKindLabel: null,
    emergency: false,
    feeNote: '',
  };
}

/** {bill, out()} for a visit id — today's queue or an earlier visit. */
function billFor(visitId) {
  const old = money().oldBills.find((o) => o.visitId === Number(visitId));
  if (old) return { bill: old, out: () => oldBillOut(old) };
  const p = visitRow(visitId);
  if (!started(p)) throw httpError(404, 'No bill for this visit');
  return { bill: p.bill, out: () => billOut(p) };
}

function withIds(items) {
  return c(items || []).map((it) => ({ ...it, id: it.id ?? store.nextId('billItem') }));
}

function nextReceiptNo() {
  const year = new Date().getFullYear();
  const n = EARLIER_TODAY.receipts.length + store.nextId('receipt');
  return `GK-${year}-${String(n).padStart(5, '0')}`;
}

function receive(b, amount, mode, note = '') {
  if (!MODES.includes(mode)) throw httpError(422, `mode must be one of ${MODES.join(', ')}`);
  const n = Math.round(Number(amount));
  if (!(n > 0)) throw httpError(422, 'The amount must be more than ₹0');
  const balance = sumItems(b.items) - sumPaid(b);
  if (balance <= 0) throw httpError(409, 'Nothing is owed on this bill');
  if (n > balance) throw httpError(422, `₹${n} is more than the ₹${balance} still owed`);
  const m = money();
  m.seq.payment += 1;
  b.payments = [
    ...(b.payments || []),
    { id: m.seq.payment, amount: n, mode, at: new Date().toISOString(), byName: staffName(), note: note || '' },
  ];
  settle(b);
  if (!b.receiptNo) b.receiptNo = nextReceiptNo();
}

function closeNoCharge(b) {
  const total = sumItems(b.items);
  if (total > 0) throw httpError(409, `This bill is ₹${total} — receive the payment instead`);
  if (!b.paidAt) b.paidAt = new Date().toISOString();
}

// GET / POST start / PUT {items, paymentMode?} / POST pay {paymentMode} / payments / no-charge / owing
export const billing = {
  async get(visitId) {
    return billFor(visitId).out();
  },
  async start(visitId) {
    const p = visitRow(visitId);
    startBill(p);
    store.notify();
    return billOut(p);
  },
  async save(visitId, bill) {
    const p = visitRow(visitId);
    const m = money();
    (bill.items || []).forEach((it) => {
      if (it.standardChargeId != null && !S.standardCharges.some((s) => s.id === Number(it.standardChargeId)))
        throw httpError(422, `Unknown standardChargeId ${it.standardChargeId}`);
      if (it.accountHeadKey && !m.heads.some((h) => h.key === it.accountHeadKey))
        throw httpError(422, `Unknown day-book column '${it.accountHeadKey}'`);
    });
    const prev = p.bill?.items || [];
    const items = withIds(bill.items).map((it) => {
      // keep the medicine name the demo uses to follow a re-saved prescription
      const old = prev.find(
        (o) => o.id === it.id || (it.prescriptionLineId && o.prescriptionLineId === it.prescriptionLineId)
      );
      const line = old?.medicineName ? { ...it, medicineName: old.medicineName } : it;
      return { ...line, accountHeadKey: lineHead(line) };
    });
    p.bill = { ...p.bill, items, started: true };
    if (bill.paymentMode !== undefined && !(p.bill.payments || []).length) p.bill.paymentMode = bill.paymentMode;
    settle(p.bill);
    store.notify();
    return billOut(p);
  },
  /** Older callers: receive the whole balance in one mode (₹0 bill -> "No charge"; already paid ->
      the latest payment's mode is corrected). */
  async pay(visitId, paymentMode) {
    const { bill: b, out } = billFor(visitId);
    if (!MODES.includes(paymentMode)) throw httpError(422, `paymentMode must be one of ${MODES.join(', ')}`);
    const balance = sumItems(b.items) - sumPaid(b);
    if (balance > 0) receive(b, balance, paymentMode);
    else if (!(b.payments || []).length) closeNoCharge(b);
    else {
      b.payments[b.payments.length - 1].mode = paymentMode;
      settle(b);
    }
    store.notify();
    return out();
  },
  /** Receive part (or all) of the balance: {amount, mode, note?}. */
  async receive(visitId, { amount, mode, note = '' }) {
    const { bill: b, out } = billFor(visitId);
    receive(b, amount, mode, note);
    store.notify();
    return out();
  },
  /** Undo a payment entered by mistake. */
  async undoPayment(visitId, paymentId) {
    const { bill: b, out } = billFor(visitId);
    if (!(b.payments || []).some((x) => x.id === Number(paymentId))) throw httpError(404, 'Payment not found');
    b.payments = b.payments.filter((x) => x.id !== Number(paymentId));
    settle(b);
    store.notify();
    return out();
  },
  /** Close a ₹0 bill as "No charge". */
  async noCharge(visitId) {
    const p = visitRow(visitId);
    startBill(p);
    closeNoCharge(p.bill);
    store.notify();
    return billOut(p);
  },
  /** A patient's bills with money still owed: [{visitId, patientId, name, token, visitDate, total, paidAmount, balance}]. */
  async owing(patientId) {
    return owedBills().filter((o) => o.patientId === Number(patientId));
  },
  async charges() {
    money();
    return c(S.standardCharges.filter((s) => s.active !== false).sort((a, b) => a.sortOrder - b.sortOrder));
  },
};

/** Every bill still owing (earlier visits first). */
export function owedBills() {
  const rows = [];
  money().oldBills.forEach((o) => {
    const balance = sumItems(o.items) - sumPaid(o);
    if (balance > 0)
      rows.push({
        visitId: o.visitId,
        patientId: o.patientId,
        name: o.name,
        token: o.token,
        visitDate: o.date,
        total: sumItems(o.items),
        paidAmount: sumPaid(o),
        balance,
      });
  });
  S.patients.forEach((p) => {
    if (!started(p)) return;
    const b = billOut(p);
    if (b.balance > 0)
      rows.push({
        visitId: p.id,
        patientId: p.id,
        name: p.name,
        token: p.token,
        visitDate: dateStr(0),
        total: b.total,
        paidAmount: b.paidAmount,
        balance: b.balance,
      });
  });
  return rows;
}

/* ---------------- "Bought here" -> bill line (called by the prescriptions mock) ---------------- */
export function syncMedicineLine(p, line, price) {
  startBill(p); // a bill "Bought here" creates starts with the suggested visit fee too
  p.bill.items = p.bill.items || [];
  const qty = Number(line.dispensedQty) || 1;
  const amount = price != null ? qty * Number(price) : 0;
  let item = p.bill.items.find((it) => it.kind === 'medicine' && it.prescriptionLineId === line.id);
  if (!item) {
    item = {
      id: store.nextId('billItem'),
      kind: 'medicine',
      prescriptionLineId: line.id,
      accountHeadKey: money().settings.medicineHead,
    };
    p.bill.items.push(item);
  }
  Object.assign(item, { label: `${line.name} × ${qty}`, qty, amount, medicineName: line.name });
  settle(p.bill);
}

export function dropMedicineLine(p, lineId) {
  if (!p.bill?.items) return;
  p.bill.items = p.bill.items.filter(
    (it) => !(it.kind === 'medicine' && it.prescriptionLineId === Number(lineId))
  );
  settle(p.bill);
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
const checkHead = (key) => {
  if (key && !money().heads.some((h) => h.key === key)) throw httpError(422, `Unknown day-book column '${key}'`);
  return key || null;
};
const ordered = () => {
  money();
  return c([...S.standardCharges].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id));
};

export const standardChargesAdmin = {
  async list() {
    return ordered();
  },
  async create({ label, amount = 0, amountBothEyes = null, groupLabel = '', accountHeadKey = null }) {
    money();
    const row = {
      id: store.nextId('standardCharge'),
      label: cleanLabel(label),
      amount: Math.max(0, Math.round(Number(amount) || 0)),
      amountBothEyes: amountBothEyes == null ? null : Math.max(0, Math.round(Number(amountBothEyes) || 0)),
      groupLabel: (groupLabel || '').split(/\s+/).filter(Boolean).join(' '),
      accountHeadKey: checkHead(accountHeadKey),
      active: true,
      sortOrder: Math.max(0, ...S.standardCharges.map((s) => s.sortOrder)) + 1,
    };
    S.standardCharges.push(row);
    store.notify();
    return c(row);
  },
  async update(id, patch) {
    money();
    const row = chargeById(id);
    if (patch.label != null) row.label = cleanLabel(patch.label, row.id);
    if (patch.amount != null) {
      const n = Number(patch.amount);
      if (Number.isNaN(n) || n < 0) throw httpError(422, 'Amount must be 0 or more');
      row.amount = Math.round(n);
    }
    if (patch.amountBothEyes !== undefined) {
      const n = patch.amountBothEyes == null ? null : Number(patch.amountBothEyes);
      if (n != null && (Number.isNaN(n) || n < 0)) throw httpError(422, 'Amount must be 0 or more');
      row.amountBothEyes = n == null ? null : Math.round(n); // null = one price whatever the eyes
    }
    if (patch.groupLabel != null) row.groupLabel = patch.groupLabel.split(/\s+/).filter(Boolean).join(' ');
    if (patch.accountHeadKey != null) row.accountHeadKey = checkHead(patch.accountHeadKey);
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
/* Demo only: the patients who came and went earlier today (before the queue you can see),
   so the summary has believable numbers the moment the demo opens. `heads` splits each bill over
   the day-book columns (the day book shows these six too). */
export const EARLIER_TODAY = {
  patients: 6,
  avgVisitMinutes: 54,
  // minutes spent in each stage by those six (sum, visits)
  stages: { reg: [42, 6], pretest: [78, 6], doctor: [66, 6], dilate: [96, 3], billing: [30, 6] },
  receipts: [
    { name: 'Hetal Joshi', token: '#002', total: 750, mode: 'cash', minsAgo: 190, ageSex: '20/F', area: 'Adajan', phone: '98980 11122', heads: { opd: 700, med: 50 } },
    { name: 'Rajesh Parmar', token: '#004', total: 1085, mode: 'upi', minsAgo: 165, ageSex: '54/M', area: 'Vesu', phone: '99250 33344', heads: { opd: 350, test: 500, med: 235 } },
    { name: 'Neha Kapadia', token: '#006', total: 500, mode: 'upi', minsAgo: 140, ageSex: '29/F', area: 'Piplod', phone: '97140 55566', heads: { opd: 500 } },
    { name: 'Dinesh Solanki', token: '#008', total: 2400, mode: 'mediclaim', minsAgo: 115, ageSex: '66/M', area: 'Athwalines', phone: '98250 77788', heads: { opd: 350, test: 2050 } },
    { name: 'Meena Rathod', token: '#010', total: 860, mode: 'card', minsAgo: 80, ageSex: '63/F', area: 'Katargam', phone: '90990 99900', heads: { opd: 350, glasses: 510 } },
    { name: 'Arjun Nair', token: '#013', total: 300, mode: 'cash', minsAgo: 50, ageSex: '41/M', area: 'Pal', phone: '98795 12312', heads: { opd: 300 } },
  ],
  kinds: { new: 2, free_follow_up: 1, follow_up: 2, new_case: 1 },
  medicines: [
    ['Moxifloxacin 0.5% eye drops', 3, 255],
    ['Carboxymethylcellulose 0.5% (tear drops)', 2, 280],
    ['Timolol 0.5% eye drops', 1, 45],
  ],
};

function emptyKinds() {
  const kinds = [...S.visitKinds]
    .filter((k) => k.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((k) => ({ key: k.key, label: k.label, count: 0 }));
  return { kinds, emergencies: 0, notSet: 0 };
}

function countKind(rep, key, n = 1) {
  const row = rep.visitKinds.kinds.find((k) => k.key === key);
  if (row) row.count += n;
  else rep.visitKinds.notSet += n;
}

function emptyReport(date, stages) {
  return {
    date,
    patients: { registered: 0, seen: 0, inProgress: 0 },
    avgVisitMinutes: null,
    stages: stages.map((s) => ({ key: s.key, label: s.label, avgMinutes: null, visits: 0, waitingNow: 0 })),
    visitKinds: emptyKinds(),
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
  rep.collections.billsPaid = new Set(rep.receipts.map((r) => r.visitId ?? r.receiptNo)).size;
  rep.collections.unpaidTotal = rep.collections.unpaid.reduce((s, u) => s + u.balance, 0);
  rep.medicinesQty = rep.medicines.reduce((s, m) => s + m.qty, 0);
  rep.medicinesAmount = rep.medicines.reduce((s, m) => s + m.amount, 0);
  return rep;
}

function addReceipt(rep, r) {
  const slotRow = rep.collections.byMode.find((m) => m.mode === r.paymentMode) || rep.collections.byMode[0];
  slotRow.bills += 1;
  slotRow.amount += r.total;
  rep.receipts.push({ billTotal: r.total, balance: 0, paymentId: null, ...r });
}

function addMedicine(rep, name, qty, amount) {
  const row = rep.medicines.find((m) => m.name === name);
  if (row) {
    row.qty += qty;
    row.amount += amount;
  } else rep.medicines.push({ name, qty, amount });
}

/** Payments received on `date` against real demo bills (today's queue + earlier visits). */
export function paymentsOn(date) {
  const out = [];
  const onDay = (at) => at && new Date(at).toISOString().slice(0, 10) === date;
  S.patients.forEach((p) => {
    if (!started(p)) return;
    (p.bill.payments || []).forEach((x) => onDay(x.at) && out.push({ payment: x, bill: billOut(p), today: true }));
  });
  money().oldBills.forEach((o) =>
    (o.payments || []).forEach((x) => onDay(x.at) && out.push({ payment: x, bill: oldBillOut(o), today: false }))
  );
  return out.sort((a, b) => (a.payment.at < b.payment.at ? -1 : 1));
}

function addPayments(rep, date) {
  paymentsOn(date).forEach(({ payment, bill }) =>
    addReceipt(rep, {
      receiptNo: bill.receiptNo,
      visitId: bill.visitId,
      paymentId: payment.id,
      name: bill.patientName,
      token: bill.token,
      total: payment.amount,
      billTotal: bill.total,
      balance: bill.balance,
      paymentMode: payment.mode,
      paidAt: payment.at,
    })
  );
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
  addPayments(rep, date);
  EARLIER_TODAY.medicines.forEach(([name, qty, amount]) => addMedicine(rep, name, qty, amount));
  Object.entries(EARLIER_TODAY.kinds).forEach(([key, n]) => countKind(rep, key, n));
  live.forEach((p) => {
    const fee = feeFields(p);
    countKind(rep, fee.visitKindKey);
    if (fee.emergency) rep.visitKinds.emergencies += 1;
    const b = billOut(p);
    (p.medicines || [])
      .filter((m) => Number(m.dispensedQty) > 0)
      .forEach((m) => {
        const billed = b.items.find((it) => it.kind === 'medicine' && it.prescriptionLineId === m.id);
        addMedicine(rep, m.name, Number(m.dispensedQty), billed ? billed.amount : 0);
      });
  });
  rep.collections.unpaid = owedBills();
  return finish(rep);
}

/** Made-up receipts for an earlier demo day: steady numbers from the date itself (same date, same
    numbers). Sundays the clinic is closed. Shared with the day book. */
export function pastReceipts(date) {
  if (new Date(date + 'T00:00:00').getDay() === 0) return { seen: 0, receipts: [], rnd: null };
  let seed = [...date].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rnd = (lo, hi) => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return lo + (seed % (hi - lo + 1));
  };
  const seen = rnd(16, 28);
  const names = ['Patel', 'Shah', 'Desai', 'Mehta', 'Joshi', 'Trivedi', 'Parmar', 'Rana', 'Oza', 'Vaghela'];
  const year = date.slice(0, 4);
  const start = new Date(date + 'T09:30:00').getTime();
  const receipts = [];
  for (let i = 0; i < seen; i++) {
    receipts.push({
      receiptNo: `GK-${year}-${String(rnd(100, 900) * 10 + i).padStart(5, '0')}`,
      visitId: null,
      name: `Patient ${names[rnd(0, names.length - 1)]}`,
      token: '#' + String(i + 1).padStart(3, '0'),
      total: [300, 500, 750, 860, 1085, 2400][rnd(0, 5)],
      paymentMode: ['cash', 'upi', 'upi', 'card', 'cash', 'mediclaim'][rnd(0, 5)],
      paidAt: new Date(start + i * rnd(15, 25) * MIN).toISOString(),
    });
  }
  return { seen, receipts, rnd };
}

/* An earlier day in the demo: the made-up receipts above plus any real demo payment that day. */
function pastReport(date, stages) {
  const rep = emptyReport(date, stages);
  const { seen, receipts, rnd } = pastReceipts(date);
  if (!rnd) {
    addPayments(rep, date);
    return finish(rep);
  }
  rep.patients = { registered: seen, seen, inProgress: 0 };
  const newPatients = rnd(3, 7);
  const free = rnd(2, 5);
  const newCases = rnd(1, 3);
  countKind(rep, 'new', newPatients);
  countKind(rep, 'free_follow_up', free);
  countKind(rep, 'new_case', newCases);
  countKind(rep, 'follow_up', Math.max(0, seen - newPatients - free - newCases));
  rep.visitKinds.emergencies = rnd(0, 1);
  const typical = { reg: [4, 9], pretest: [10, 18], doctor: [8, 15], dilate: [28, 40], billing: [3, 8] };
  let visitMins = 0;
  rep.stages.forEach((s) => {
    const [lo, hi] = typical[s.key] || [3, 10];
    s.avgMinutes = rnd(lo, hi);
    s.visits = s.key === 'dilate' ? Math.round(seen / 3) : seen;
    visitMins += s.key === 'dilate' ? s.avgMinutes / 3 : s.avgMinutes;
  });
  rep.avgVisitMinutes = Math.round(visitMins + rnd(5, 12));
  receipts.forEach((r) => addReceipt(rep, r));
  addPayments(rep, date);
  [
    ['Moxifloxacin 0.5% eye drops', 85],
    ['Carboxymethylcellulose 0.5% (tear drops)', 140],
    ['Prednisolone acetate 1% eye drops', 60],
  ].forEach(([name, price]) => {
    const qty = rnd(1, 6);
    addMedicine(rep, name, qty, qty * price);
  });
  rep.collections.unpaid = owedBills().filter((o) => o.visitDate <= date);
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
