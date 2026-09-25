/* Demo-mode day book, its columns (account heads) and the cash drawer (lane M owns this file).
   Same method names and shapes as `daybook` in src/api/real.js. The demo state (columns, settings,
   earlier bills, cash drawer) is `money()` in ./billing — fresh after mockStore.reset().

   Today's sheet = the six made-up patients seen earlier today (EARLIER_TODAY) + today's queue
   (each visit's bill split over the columns) + balances from earlier visits collected today + OT
   cases that day. An earlier day uses the same made-up receipts as the Today page. */
import { store } from './store';
import { dateStr } from './data';
import { EARLIER_TODAY, billOut, lineHead, money, pastReceipts, paymentsOn } from './billing';

const S = store.state;
const c = store.clone;
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

const addDays = (date, n) => {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/* ---------------- columns ---------------- */
function headUseCounts() {
  const counts = {};
  S.standardCharges.forEach((ch) => {
    if (ch.accountHeadKey) counts[ch.accountHeadKey] = (counts[ch.accountHeadKey] || 0) + 1;
  });
  S.patients.forEach((p) =>
    (p.bill?.items || []).forEach((it) => {
      if (it.accountHeadKey) counts[it.accountHeadKey] = (counts[it.accountHeadKey] || 0) + 1;
    })
  );
  money().oldBills.forEach((o) =>
    o.items.forEach((it) => {
      counts[it.accountHeadKey] = (counts[it.accountHeadKey] || 0) + 1;
    })
  );
  return counts;
}

const headsOrdered = () => [...money().heads].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
const headOut = (h, counts) => ({ ...c(h), useCount: counts[h.key] || 0 });
const headByKey = (key) => {
  const h = money().heads.find((x) => x.key === key);
  if (!h) throw httpError(404, 'Day-book column not found');
  return h;
};
const cleanLabel = (label, exceptId) => {
  const l = (label || '').split(/\s+/).filter(Boolean).join(' ');
  if (!l) throw httpError(422, 'A column needs a name');
  if (money().heads.some((h) => h.id !== exceptId && h.label.toLowerCase() === l.toLowerCase()))
    throw httpError(409, `'${l}' is already a column`);
  return l;
};
const SETTING_USES = { medicineHead: 'medicines', otherHead: 'hand-typed lines', otHead: 'OT payments' };
const settingsUsing = (key) =>
  Object.entries(SETTING_USES)
    .filter(([f]) => money().settings[f] === key)
    .map(([, what]) => what);

/* ---------------- the sheet ---------------- */
function otRows(date) {
  const m = money();
  return S.otCases
    .filter((k) => k.date === date && k.status !== 'cancelled' && (k.billing?.lensTier || k.billing?.paymentMode))
    .map((k) => {
      const price = S.lensTiers.find((t) => t.key === k.billing?.lensTier)?.price || 0;
      const mode = MODES.includes(k.billing?.paymentMode) ? k.billing.paymentMode : null;
      const received = mode ? price : 0;
      return {
        kind: 'ot',
        visitId: null,
        otCaseId: k.id,
        patientId: k.patientId ?? null,
        name: k.patientName,
        phone: null,
        ageSex: [k.age, k.sex].filter((x) => x != null && x !== '').join('/'),
        area: '',
        token: null,
        visitDate: k.date,
        amounts: price ? { [m.settings.otHead]: price } : {},
        total: price,
        received,
        modes: mode ? [mode] : [],
        left: price - received,
        status: mode ? 'paid' : price ? 'unpaid' : '',
        note: [k.procedure, k.billing?.lensTier && `lens ${k.billing.lensTier}`].filter(Boolean).join(' · '),
      };
    });
}

function madeUpRow(r, amounts) {
  return {
    kind: 'visit',
    visitId: null,
    otCaseId: null,
    patientId: null,
    name: r.name,
    phone: r.phone || null,
    ageSex: r.ageSex || '',
    area: r.area || '',
    token: r.token,
    visitDate: null,
    amounts,
    total: r.total,
    received: r.total,
    modes: [r.mode || r.paymentMode],
    left: 0,
    status: 'paid',
    note: '',
  };
}

/** A made-up earlier-day receipt split over the columns. */
function splitPast(total) {
  if (total >= 2000) return { opd: 350, test: total - 350 };
  if (total > 700) return { opd: 700, med: total - 700 };
  return { opd: total };
}

function sheetRows(date) {
  const today = dateStr(0);
  const rows = [];
  if (date === today) {
    EARLIER_TODAY.receipts.forEach((r) => rows.push(madeUpRow(r, { ...r.heads })));
    S.patients.forEach((p) => {
      const b = billOut(p);
      const amounts = {};
      (p.bill?.items || []).forEach((it) => {
        const k = lineHead(it);
        amounts[k] = (amounts[k] || 0) + Number(it.amount || 0);
      });
      const todays = (b.payments || []).filter((x) => String(x.at).slice(0, 10) === date);
      rows.push({
        kind: 'visit',
        visitId: p.id,
        otCaseId: null,
        patientId: p.id,
        name: p.name,
        phone: p.phone || null,
        ageSex: [p.age, p.sex].filter((x) => x != null && x !== '').join('/'),
        area: p.address || '',
        token: p.token,
        visitDate: date,
        amounts,
        total: b.total,
        received: todays.reduce((s, x) => s + x.amount, 0),
        modes: [...new Set(todays.map((x) => x.mode))],
        left: b.balance,
        status: (p.bill?.items || []).length || p.bill?.paidAt ? b.status : '',
        note: '',
      });
    });
  } else if (date < today) {
    pastReceipts(date).receipts.forEach((r) => rows.push(madeUpRow(r, splitPast(r.total))));
  }
  // balances from earlier visits collected that day
  const old = {};
  paymentsOn(date)
    .filter(({ bill }) => bill.visitDate !== date)
    .forEach(({ payment, bill }) => {
      const row = (old[bill.visitId] = old[bill.visitId] || {
        kind: 'old_balance',
        visitId: bill.visitId,
        otCaseId: null,
        patientId: bill.patientId,
        name: bill.patientName,
        phone: null,
        ageSex: '',
        area: '',
        token: bill.token,
        visitDate: bill.visitDate,
        amounts: {},
        total: 0,
        received: 0,
        modes: [],
        left: bill.balance,
        status: bill.status,
        note: `Old balance · visit of ${bill.visitDate}`,
      });
      const o = money().oldBills.find((x) => x.visitId === bill.visitId);
      if (o) Object.assign(row, { phone: o.phone, ageSex: o.ageSex, area: o.area });
      row.total += payment.amount;
      row.received += payment.amount;
      if (!row.modes.includes(payment.mode)) row.modes.push(payment.mode);
    });
  rows.push(...Object.values(old));
  rows.push(...otRows(date));
  return rows;
}

function cashReceived(rows) {
  // received money by mode (the made-up rows count their whole total in their one mode)
  const byMode = Object.fromEntries(MODES.map((m) => [m, [0, 0]]));
  rows.forEach((r) => {
    if (!r.received) return;
    if (r.kind === 'visit' && r.visitId != null) return; // real bills: counted by payment below
    if (r.kind === 'old_balance') return;
    byMode[r.modes[0]] = byMode[r.modes[0]] || [0, 0];
    byMode[r.modes[0]][0] += 1;
    byMode[r.modes[0]][1] += r.received;
  });
  return byMode;
}

function modeTotals(date, rows) {
  const byMode = cashReceived(rows);
  paymentsOn(date).forEach(({ payment }) => {
    byMode[payment.mode][0] += 1;
    byMode[payment.mode][1] += payment.amount;
  });
  return byMode;
}

function movementsOn(date) {
  return money().movements.filter((x) => x.day === date);
}

function cashFlowOn(date) {
  const cash = modeTotals(date, sheetRows(date)).cash[1];
  return movementsOn(date).reduce((s, x) => s + (x.direction === 'in' ? x.amount : -x.amount), cash);
}

function openingFor(date) {
  const m = money();
  if (m.cashDays[date]) return { amount: m.cashDays[date].openingCash, row: m.cashDays[date], source: 'set' };
  const anchor = Object.keys(m.cashDays)
    .filter((d) => d < date)
    .sort()
    .pop();
  if (!anchor) return { amount: 0, row: null, source: 'none' };
  let amount = m.cashDays[anchor].openingCash;
  for (let d = anchor; d < date; d = addDays(d, 1)) amount += cashFlowOn(d);
  return { amount, row: null, source: 'carried' };
}

function dayBook(date) {
  const m = money();
  const rows = sheetRows(date);
  const used = {};
  rows.forEach((r) =>
    Object.entries(r.amounts).forEach(([k, a]) => {
      used[k] = (used[k] || 0) + a;
    })
  );
  const known = new Set(m.heads.map((h) => h.key));
  // a line under a column that no longer exists counts under "other"
  rows.forEach((r) =>
    Object.keys(r.amounts).forEach((k) => {
      if (!known.has(k)) {
        r.amounts[m.settings.otherHead] = (r.amounts[m.settings.otherHead] || 0) + r.amounts[k];
        used[m.settings.otherHead] = (used[m.settings.otherHead] || 0) + r.amounts[k];
        delete r.amounts[k];
      }
    })
  );
  const heads = headsOrdered()
    .filter((h) => h.active || used[h.key])
    .map((h) => ({ key: h.key, label: h.label }));
  const byMode = modeTotals(date, rows);
  const opening = openingFor(date);
  const moves = movementsOn(date);
  const cashIn = moves.filter((x) => x.direction === 'in').reduce((s, x) => s + x.amount, 0);
  const cashOut = moves.filter((x) => x.direction === 'out').reduce((s, x) => s + x.amount, 0);
  const received = byMode.cash[1];
  return {
    date,
    heads,
    rows,
    totals: {
      amounts: Object.fromEntries(heads.map((h) => [h.key, used[h.key] || 0])),
      total: rows.reduce((s, r) => s + r.total, 0),
      received: rows.reduce((s, r) => s + r.received, 0),
      left: rows.reduce((s, r) => s + Math.max(r.left, 0), 0),
    },
    byMode: Object.entries(byMode).map(([mode, [payments, amount]]) => ({ mode, payments, amount })),
    receivedTotal: Object.values(byMode).reduce((s, [, a]) => s + a, 0),
    cash: {
      openingCash: opening.amount,
      openingSource: opening.source,
      openingSetBy: opening.row?.setBy ?? null,
      openingSetAt: opening.row?.setAt ?? null,
      openingNote: opening.row?.note ?? '',
      cashReceived: received,
      movements: c(moves),
      cashIn,
      cashOut,
      closingCash: opening.amount + received + cashIn - cashOut,
    },
  };
}

/** A CSV version of the sheet (the demo can't build a real Excel file; the server does). */
function csv(book) {
  const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [['PATIENT LIST'], ['DATE', book.date], ['CASH BALANCE', book.cash.openingCash]];
  lines.push(['SR NO', 'DATE', 'NAME', 'PH NO', 'AGE', 'ADD', ...book.heads.map((h) => h.label), 'TOTAL', 'MODE', 'LEFT']);
  book.rows.forEach((r, i) =>
    lines.push([
      i + 1,
      book.date,
      r.kind === 'old_balance' ? `${r.name} (old balance)` : r.kind === 'ot' ? `${r.name} (OT)` : r.name,
      r.phone || '',
      r.ageSex,
      r.area,
      ...book.heads.map((h) => r.amounts[h.key] || 0),
      r.total,
      r.modes.map((m) => m.toUpperCase()).join(' + '),
      r.left,
    ])
  );
  lines.push(['', '', 'TOTAL', '', '', '', ...book.heads.map((h) => book.totals.amounts[h.key] || 0), book.totals.total, '', book.totals.left]);
  lines.push([]);
  lines.push(['+ CASH RECEIVED', book.cash.cashReceived]);
  book.cash.movements.forEach((x) => lines.push([`${x.direction === 'in' ? '+' : '-'}${x.amount} ${x.person}`, x.reason]));
  lines.push(['CASH BAL', book.cash.closingCash]);
  return lines.map((l) => l.map(q).join(',')).join('\n');
}

export const daybook = {
  // ---- columns & settings ----
  async heads({ includeInactive = false } = {}) {
    const counts = headUseCounts();
    return headsOrdered()
      .filter((h) => includeInactive || h.active)
      .map((h) => headOut(h, counts));
  },
  async settings() {
    return c(money().settings);
  },
  admin: {
    async create(label) {
      const m = money();
      const l = cleanLabel(label);
      const base = l.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'column';
      let key = base;
      for (let n = 2; m.heads.some((h) => h.key === key); n += 1) key = `${base.slice(0, 27)}_${n}`;
      m.seq.head += 1;
      const row = { id: m.seq.head, key, label: l, active: true, sortOrder: Math.max(0, ...m.heads.map((h) => h.sortOrder)) + 1 };
      m.heads.push(row);
      store.notify();
      return headOut(row, {});
    },
    async update(key, patch) {
      const h = headByKey(key);
      if (patch.label != null) h.label = cleanLabel(patch.label, h.id);
      if (patch.active != null && !!patch.active !== h.active) {
        const uses = settingsUsing(h.key);
        if (!patch.active && uses.length)
          throw httpError(409, `${h.label} is the column for ${uses.join(' and ')} — pick another one in the settings below first`);
        h.active = !!patch.active;
      }
      store.notify();
      return headOut(h, headUseCounts());
    },
    async remove(key) {
      const h = headByKey(key);
      const used = headUseCounts()[h.key] || 0;
      if (used)
        throw httpError(409, `${used} charge(s) or bill line(s) are counted under '${h.label}': switch it off instead`);
      const uses = settingsUsing(h.key);
      if (uses.length)
        throw httpError(409, `${h.label} is the column for ${uses.join(' and ')} — pick another one in the settings first`);
      money().heads = money().heads.filter((x) => x.key !== key);
      store.notify();
      return null;
    },
    async reorder(keys) {
      const m = money();
      if (keys.length !== m.heads.length || !keys.every((k) => m.heads.some((h) => h.key === k)))
        throw httpError(422, 'order must list every existing column exactly once');
      keys.forEach((k, i) => {
        headByKey(k).sortOrder = i;
      });
      store.notify();
      return daybook.heads({ includeInactive: true });
    },
    async saveSettings(patch) {
      const m = money();
      Object.keys(SETTING_USES).forEach((f) => {
        if (patch[f] == null) return;
        const h = m.heads.find((x) => x.key === patch[f]);
        if (!h) throw httpError(422, `Unknown day-book column '${patch[f]}'`);
        if (!h.active) throw httpError(422, `'${h.label}' is switched off`);
      });
      Object.keys(SETTING_USES).forEach((f) => {
        if (patch[f] != null) m.settings[f] = patch[f];
      });
      store.notify();
      return c(m.settings);
    },
  },

  // ---- the day book & cash drawer ----
  async day(date) {
    return dayBook(date || dateStr(0));
  },
  async setOpening(date, { openingCash, note = '' }) {
    const n = Math.round(Number(openingCash));
    if (Number.isNaN(n) || n < 0) throw httpError(422, 'Opening cash must be ₹0 or more');
    money().cashDays[date] = { openingCash: n, note: (note || '').trim(), setBy: staffName(), setAt: new Date().toISOString() };
    store.notify();
    return dayBook(date);
  },
  async addMovement(date, { direction = 'out', amount, person = '', reason = '' }) {
    if (!['out', 'in'].includes(direction)) throw httpError(422, 'direction must be out or in');
    const n = Math.round(Number(amount));
    if (!(n > 0)) throw httpError(422, 'The amount must be more than ₹0');
    const m = money();
    m.seq.movement += 1;
    m.movements.push({
      id: m.seq.movement,
      day: date,
      direction,
      amount: n,
      person: (person || '').split(/\s+/).filter(Boolean).join(' '),
      reason: (reason || '').trim(),
      at: new Date(Date.now() + m.seq.movement).toISOString(),
      byName: staffName(),
    });
    store.notify();
    return dayBook(date);
  },
  async removeMovement(date, id) {
    const m = money();
    if (!m.movements.some((x) => x.id === Number(id) && x.day === date)) throw httpError(404, 'Cash entry not found');
    m.movements = m.movements.filter((x) => x.id !== Number(id));
    store.notify();
    return dayBook(date);
  },
  async people() {
    const seen = [];
    [...money().movements]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .forEach((x) => {
        if (x.person && !seen.some((p) => p.toLowerCase() === x.person.toLowerCase())) seen.push(x.person);
      });
    return seen;
  },
  /** {blob, filename}: the server sends an Excel file; the demo a CSV of the same sheet. */
  async download(date) {
    const book = dayBook(date || dateStr(0));
    return { blob: new Blob([csv(book)], { type: 'text/csv' }), filename: `day-book-${book.date}.csv` };
  },
};
