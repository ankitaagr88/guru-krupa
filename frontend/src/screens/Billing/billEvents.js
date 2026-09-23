/* "The server changed this visit's bill" — e.g. "Bought here" added a medicine line. The
   medicines panel announces it; an open BillingPanel for the same visit reloads. */
export const BILL_CHANGED = 'gk:bill-changed';

export function announceBillChanged(visitId) {
  window.dispatchEvent(new CustomEvent(BILL_CHANGED, { detail: { visitId } }));
}
