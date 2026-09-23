import { useState } from 'react';
import { prescriptions as prescriptionsApi, errorMessage } from '../../api';
import { useToast } from '../../components/Toast';
import { announceBillChanged } from '../Billing/billEvents';

/* Billing stage: the doctor's prescription, one row per medicine, with a
   "Bought here" button. Only that button deducts stock — the doctor's
   "to give" quantity is a suggestion, because some patients already have the
   medicine and don't buy it from the clinic. `onChange(rx)` hands the updated
   prescription back to the drawer. "Bought here" also puts the medicine on the bill
   (qty × the price per pack set in Admin › Medicines) and Undo takes it off; the bill
   panel hears about it through `announceBillChanged`. */
export default function DispensePanel({ visitId, lines, onChange, busy = false }) {
  const toast = useToast();
  const [qtys, setQtys] = useState({});
  const [working, setWorking] = useState(null);

  if (!lines || lines.length === 0)
    return (
      <div id="dispenseSection" data-testid="dispense-panel">
        <div className="field-label">Medicines from clinic stock</div>
        <p className="small-note" style={{ margin: '0 0 12px' }}>
          No medicines were prescribed for this visit.
        </p>
      </div>
    );

  const qtyFor = (l) => {
    const v = qtys[l.id];
    if (v != null && v !== '') return Math.max(1, parseInt(v, 10) || 1);
    return Math.max(1, Number(l.qtyGiven) || 1);
  };

  const confirm = async (l) => {
    setWorking(l.id);
    try {
      const rx = await prescriptionsApi.dispense(visitId, l.id, qtyFor(l));
      onChange?.(rx);
      announceBillChanged(visitId);
      (rx?.lowStock || []).forEach((it) =>
        toast.lowStock(typeof it === 'string' ? { name: it, stock: '?', unit: '', reorder: '?' } : it)
      );
    } catch (err) {
      toast.error(err?.response?.status === 409 ? 'Not enough stock' : 'Could not record it', errorMessage(err));
    } finally {
      setWorking(null);
    }
  };
  const undo = async (l) => {
    setWorking(l.id);
    try {
      onChange?.(await prescriptionsApi.undispense(visitId, l.id));
      announceBillChanged(visitId);
    } catch (err) {
      toast.error('Could not undo', errorMessage(err));
    } finally {
      setWorking(null);
    }
  };

  const bought = lines.filter((l) => l.dispensedQty > 0).length;

  return (
    <div id="dispenseSection" data-testid="dispense-panel">
      <div className="field-label">Medicines from clinic stock</div>
      <p className="hint" style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--ink-faint)' }}>
        Confirm each medicine the patient actually buys here — it comes off the stock and goes on the bill. Skip the
        ones they already have.
      </p>
      {lines.map((l) => {
        const done = l.dispensedQty > 0;
        const stocked = l.inStock != null;
        return (
          <div key={l.id} className={`dispense-row${done ? ' done' : ''}`} data-testid="dispense-row">
            <div className="dispense-main">
              <b>{l.name}</b>
              <small>
                {l.dosage || '—'}
                {stocked ? ` · ${l.inStock} in stock` : ' · not stocked here'}
                {Number(l.qtyGiven) > 0 ? ` · doctor: give ${l.qtyGiven}` : ''}
                {stocked && (
                  <>
                    {' · '}
                    {l.price != null ? (
                      <span className="dispense-price" data-testid={`price-${l.id}`}>
                        <span style={{ fontFamily: 'var(--font-mono)' }}>₹{l.price}</span> a pack
                      </span>
                    ) : (
                      <span className="dispense-price" style={{ color: 'var(--alert-ink)' }} data-testid={`price-${l.id}`}>
                        price not set
                      </span>
                    )}
                  </>
                )}
              </small>
            </div>
            {done ? (
              <>
                <span className="status-pill done">
                  Bought {l.dispensedQty}
                  {l.dispensedBy ? ` · ${l.dispensedBy}` : ''}
                </span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => undo(l)}
                  disabled={busy || working === l.id}
                  aria-label={`Undo bought here for ${l.name}`}
                >
                  Undo
                </button>
              </>
            ) : stocked ? (
              <>
                <input
                  className="fake-input dispense-qty"
                  type="number"
                  min="1"
                  inputMode="numeric"
                  aria-label={`Quantity bought of ${l.name}`}
                  value={qtys[l.id] ?? (Number(l.qtyGiven) > 0 ? l.qtyGiven : 1)}
                  onChange={(e) => setQtys((q) => ({ ...q, [l.id]: e.target.value }))}
                />
                <button
                  type="button"
                  className="btn-primary sm"
                  onClick={() => confirm(l)}
                  disabled={busy || working === l.id || l.inStock <= 0}
                  data-testid={`bought-${l.id}`}
                  title={l.inStock <= 0 ? 'Out of stock' : ''}
                >
                  {working === l.id ? 'Saving…' : 'Bought here'}
                </button>
              </>
            ) : (
              <span className="status-pill">Patient buys outside</span>
            )}
          </div>
        );
      })}
      <p className="small-note" style={{ margin: '6px 0 12px' }}>
        {bought} of {lines.length} bought from the clinic
      </p>
    </div>
  );
}
