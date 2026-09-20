import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTopbar } from '../../components/AppShell';
import Modal from '../../components/Modal';
import Drawer from '../../components/Drawer';
import { useToast } from '../../components/Toast';
import MedicinePicker from '../../components/MedicinePicker';
import { inventory as inventoryApi, onDataChange, errorMessage } from '../../api';
import './inventory.css';

/* Stock levels (mockup renderInventory / addInventoryItem / adjustStock /
   pushLowStockToast) + adjust modal with reason/note and per-item movement
   history (B8). Rows are normalised so the real API's `reorderLevel` / `low`
   and the mock's `reorder` both work. The add-item row has a medicine picker
   (GET /medicines) that fills the name and sends `medicineId` so the item is
   linked to the master list; free text still works for non-medicine stock. */

const REASONS = [
  { key: 'received', label: 'Stock received' },
  { key: 'dispensed', label: 'Dispensed to patient' },
  { key: 'expired', label: 'Expired / discarded' },
  { key: 'damaged', label: 'Damaged / spilt' },
  { key: 'sample', label: 'MR sample' },
  { key: 'correction', label: 'Count correction' },
  { key: 'adjusted', label: 'Other adjustment' },
];

export function normItem(it) {
  const reorder = Number(it.reorderLevel ?? it.reorder ?? 0);
  const stock = Number(it.stock) || 0;
  return { ...it, stock, reorder, low: it.low ?? stock <= reorder };
}

export default function Inventory() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [adjusting, setAdjusting] = useState(null); // item
  const [history, setHistory] = useState(null); // item
  const [movements, setMovements] = useState([]);
  const [draft, setDraft] = useState({
    name: '',
    medicineId: null,
    medicine: null,
    unit: '',
    stock: '',
    reorder: '',
  });
  const [busy, setBusy] = useState(false);
  const announced = useRef(false);

  const load = useCallback(async () => {
    try {
      const rows = (await inventoryApi.list()).map(normItem);
      setItems(rows);
      return rows;
    } catch (err) {
      toast.error('Could not load stock', errorMessage(err));
      return [];
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // First load: one low-stock toast per item below its reorder point
  useEffect(() => {
    (async () => {
      const rows = await load();
      if (announced.current) return;
      announced.current = true;
      rows.filter((r) => r.low).forEach((r) => toast.lowStock(r));
    })();
    const unsub = onDataChange(load);
    return unsub;
  }, [load, toast]);

  const lowCount = items.filter((i) => i.low).length;
  useTopbar({
    sub: `Stock levels · ${lowCount ? `${lowCount} item${lowCount === 1 ? '' : 's'} running low` : 'all items above reorder point'}`,
  });

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => (!s || i.name.toLowerCase().includes(s)) && (!onlyLow || i.low));
  }, [items, q, onlyLow]);

  const quickAdjust = async (item, delta) => {
    if (item.stock + delta < 0) return;
    try {
      const wasLow = item.low;
      const updated = normItem(
        await inventoryApi.adjust(item.id, delta, delta > 0 ? 'received' : 'adjusted', '')
      );
      setItems((rows) => rows.map((r) => (r.id === item.id ? updated : r)));
      if (!wasLow && updated.low) toast.lowStock(updated);
      await load();
    } catch (err) {
      toast.error('Could not adjust stock', errorMessage(err));
    }
  };

  const addItem = async (e) => {
    e?.preventDefault?.();
    const name = draft.name.trim();
    if (!name) {
      toast.error('Add an item name.');
      return;
    }
    setBusy(true);
    try {
      const reorder = parseInt(draft.reorder, 10);
      await inventoryApi.create({
        name,
        ...(draft.medicineId != null ? { medicineId: draft.medicineId } : {}),
        unit: draft.unit.trim() || 'units',
        stock: parseInt(draft.stock, 10) || 0,
        reorderLevel: Number.isNaN(reorder) ? 5 : reorder,
      });
      setDraft({ name: '', medicineId: null, medicine: null, unit: '', stock: '', reorder: '' });
      toast.success('Item added', name);
      await load();
    } catch (err) {
      toast.error('Could not add item', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async (item) => {
    setHistory(item);
    setMovements([]);
    try {
      const rows = await inventoryApi.movements(item.id);
      setMovements(
        (rows || [])
          .map((m) => ({ ...m, ts: m.at ?? (m.createdAt ? Date.parse(m.createdAt) : null) }))
          .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      );
    } catch (err) {
      toast.error('Could not load history', errorMessage(err));
    }
  };

  return (
    <div className="appt-wrap inv-wrap">
      <div className="appt-head">
        <h2>Stock levels</h2>
        <div className="inv-tools">
          <input
            className="fake-input"
            placeholder="Find an item…"
            aria-label="Find an item"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            type="button"
            className={`inv-low-toggle${onlyLow ? ' active' : ''}`}
            onClick={() => setOnlyLow((v) => !v)}
          >
            Low only{lowCount ? ` · ${lowCount}` : ''}
          </button>
        </div>
      </div>
      <p className="hint" style={{ margin: '-10px 0 16px' }}>
        Drops used during dilation and medicines given to patients deduct from stock here automatically — no
        separate stock entry needed for those.
      </p>
      <table className="data-table" id="invTable">
        <thead>
          <tr>
            <th>Item</th>
            <th>Reorder at</th>
            <th>Status</th>
            <th>Stock</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={5} className="empty-slot">
                Loading…
              </td>
            </tr>
          )}
          {!loading && shown.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-slot">
                {items.length === 0 ? 'No stock items yet' : 'Nothing matches'}
              </td>
            </tr>
          )}
          {shown.map((item) => (
            <tr key={item.id} className={item.low ? 'inv-row-low' : ''} data-testid={`inv-row-${item.id}`}>
              <td className="td-name">{item.name}</td>
              <td data-label="Reorder at">
                {item.reorder} {item.unit}
              </td>
              <td data-label="Status">
                {item.stock <= 0 ? (
                  <span className="status-pill coral">Out of stock</span>
                ) : item.low ? (
                  <span className="status-pill coral">Low stock</span>
                ) : (
                  <span className="status-pill sage">OK</span>
                )}
              </td>
              <td className="no-label">
                <div className="inv-stock-ctl">
                  <button
                    type="button"
                    className="reorder-btn"
                    onClick={() => quickAdjust(item, -1)}
                    disabled={item.stock <= 0}
                    aria-label={`Remove one ${item.name}`}
                  >
                    −
                  </button>
                  <span className="inv-stock-num" data-testid={`stock-${item.id}`}>
                    {item.stock}
                  </span>
                  <button
                    type="button"
                    className="reorder-btn"
                    onClick={() => quickAdjust(item, 1)}
                    aria-label={`Add one ${item.name}`}
                  >
                    +
                  </button>
                  <span className="inv-unit">{item.unit}</span>
                </div>
              </td>
              <td className="no-label">
                <div className="inv-row-actions">
                  <button type="button" className="inv-link" onClick={() => setAdjusting(item)}>
                    Adjust…
                  </button>
                  <button type="button" className="inv-link" onClick={() => openHistory(item)}>
                    History
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="admin-block" style={{ marginTop: 18 }}>
        <h2>Add a stock item</h2>
        <form className="bill-add-row inv-add-row" onSubmit={addItem}>
          <MedicinePicker
            id="invNewName"
            className="fake-input"
            placeholder="Item name — pick a medicine or type"
            ariaLabel="Item name"
            value={draft.name}
            onChange={(v) => setDraft({ ...draft, name: v, medicineId: null, medicine: null })}
            onPick={(m) => setDraft({ ...draft, name: m.name, medicineId: m.id, medicine: m })}
          />
          <input
            className="fake-input"
            id="invNewUnit"
            placeholder="Unit — bottles/strips"
            aria-label="Unit"
            style={{ width: 150 }}
            value={draft.unit}
            onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
          />
          <input
            className="fake-input"
            id="invNewStock"
            placeholder="Stock"
            aria-label="Opening stock"
            inputMode="numeric"
            style={{ width: 80 }}
            value={draft.stock}
            onChange={(e) => setDraft({ ...draft, stock: e.target.value })}
          />
          <input
            className="fake-input"
            id="invNewReorder"
            placeholder="Reorder at"
            aria-label="Reorder level"
            inputMode="numeric"
            style={{ width: 100 }}
            value={draft.reorder}
            onChange={(e) => setDraft({ ...draft, reorder: e.target.value })}
          />
          <button className="med-add-btn" type="submit" disabled={busy}>
            Add
          </button>
        </form>
        <p className="hint" style={{ margin: '6px 0 0' }} data-testid="inv-link-hint">
          {draft.medicine
            ? `Linked to the medicine list: ${draft.medicine.name} — prescriptions will deduct from this item.`
            : 'Pick from the medicine list so prescriptions deduct from this item, or type any other stock item.'}
        </p>
      </div>

      <AdjustModal
        item={adjusting}
        onClose={() => setAdjusting(null)}
        onDone={async (updated, wasLow) => {
          setAdjusting(null);
          if (!wasLow && updated.low) toast.lowStock(updated);
          await load();
        }}
      />

      <Drawer
        open={!!history}
        id="invHistoryDrawer"
        name={history?.name}
        meta={history ? `${history.stock} ${history.unit} in stock · reorder at ${history.reorder}` : ''}
        onClose={() => setHistory(null)}
      >
        <div className="field-label">Movement history</div>
        {movements.length === 0 ? (
          <p className="small-note">No movements recorded yet.</p>
        ) : (
          movements.map((m) => (
            <div className="inv-move" key={m.id}>
              <span className={`inv-move-delta ${Number(m.delta) < 0 ? 'neg' : 'pos'}`}>
                {Number(m.delta) > 0 ? '+' : ''}
                {m.delta}
              </span>
              <div className="inv-move-main">
                <div className="inv-move-reason">
                  {REASONS.find((r) => r.key === m.reason)?.label || m.reason || 'Adjusted'}
                </div>
                {m.note && <div className="inv-move-note">{m.note}</div>}
                <div className="inv-move-when">{m.ts ? fmtWhen(m.ts) : ''}</div>
              </div>
            </div>
          ))
        )}
      </Drawer>
    </div>
  );
}

function AdjustModal({ item, onClose, onDone }) {
  const toast = useToast();
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('received');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (item) {
      setDelta('');
      setReason('received');
      setNote('');
    }
  }, [item]);
  if (!item) return null;
  const n = parseInt(delta, 10);
  const preview = Number.isNaN(n) ? null : Math.max(0, item.stock + n);
  const submit = async () => {
    if (Number.isNaN(n) || n === 0) {
      toast.error('Enter how many to add (+) or remove (−).');
      return;
    }
    setBusy(true);
    try {
      const updated = normItem(await inventoryApi.adjust(item.id, n, reason, note.trim()));
      toast.success('Stock updated', `${item.name}: ${item.stock} → ${updated.stock} ${item.unit}`);
      onDone(updated, item.low);
    } catch (err) {
      toast.error('Could not adjust stock', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={`Adjust stock — ${item.name}`}
      sub={`Currently ${item.stock} ${item.unit}. Use a negative number to remove stock.`}
      onClose={onClose}
      actions={
        <>
          <button className="btn-ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn-primary full" onClick={submit} disabled={busy} type="button">
            {busy ? 'Saving…' : 'Save adjustment'}
          </button>
        </>
      }
    >
      <p className="label">Change</p>
      <div className="inv-delta-row">
        <button
          type="button"
          className="reorder-btn"
          onClick={() => setDelta(String((Number.isNaN(n) ? 0 : n) - 1))}
        >
          −
        </button>
        <input
          className="fake-input"
          placeholder="e.g. +10 or -2"
          aria-label="Change in stock"
          inputMode="numeric"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          autoFocus
        />
        <button
          type="button"
          className="reorder-btn"
          onClick={() => setDelta(String((Number.isNaN(n) ? 0 : n) + 1))}
        >
          +
        </button>
      </div>
      {preview != null && (
        <p className="small-note" style={{ margin: '2px 0 10px' }}>
          After this: <b>{preview}</b> {item.unit}
          {preview <= item.reorder ? ' — below the reorder point' : ''}
        </p>
      )}
      <p className="label">Reason</p>
      <select
        className="drop-select"
        aria-label="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      >
        {REASONS.map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
      </select>
      <textarea
        className="fake-input"
        rows={2}
        placeholder="Note (optional) — batch, supplier, who took it…"
        aria-label="Note"
        style={{ marginTop: 10 }}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </Modal>
  );
}

function fmtWhen(ts) {
  const d = new Date(ts);
  return (
    d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) +
    ', ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  );
}
