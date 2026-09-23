/* Demo-mode billing (lane B owns this file): per-visit bill, standard charges, receipts,
   and the "Today" summary. Same method names and shapes as `billing` / `reports` in
   src/api/real.js. In demo mode a "patient" row is today's visit, so the bill lives on it. */
import { store } from './store';

const S = store.state;
const c = store.clone;

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

export function billOut(p) {
  const b = p.bill || { items: [], paymentMode: null };
  return {
    visitId: p.id,
    items: c(b.items || []),
    total: (b.items || []).reduce((s, it) => s + Number(it.amount || 0), 0),
    paymentMode: b.paymentMode ?? null,
    paidAt: b.paidAt ?? null,
    paid: !!b.paidAt,
  };
}

// GET / PUT {items, paymentMode?} / POST pay {paymentMode}
export const billing = {
  async get(visitId) {
    return billOut(visitRow(visitId));
  },
  async save(visitId, bill) {
    const p = visitRow(visitId);
    p.bill = { ...p.bill, items: c(bill.items || []) };
    if (bill.paymentMode !== undefined) p.bill.paymentMode = bill.paymentMode;
    store.notify();
    return billOut(p);
  },
  async pay(visitId, paymentMode) {
    const p = visitRow(visitId);
    p.bill = p.bill || { items: [] };
    p.bill.paymentMode = paymentMode;
    p.bill.paidAt = Date.now();
    store.notify();
    return billOut(p);
  },
};

export const reports = {};
