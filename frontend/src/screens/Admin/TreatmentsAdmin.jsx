import { useEffect, useState } from 'react';
import Modal from '../../components/Modal';
import MedicinePicker from '../../components/MedicinePicker';
import { treatments as api, errorMessage } from '../../api';
import { EditableText, ReorderBtns } from './pieces';
import './treatments.css';

/* Admin › Diagnoses & treatment standards (B15/F17).

   The list of diagnoses / symptoms the doctor picks from when writing a
   prescription, and — per diagnosis — the treatment that auto-fills:
     • Dr Anu's own standard, set here once (wins), or
     • the most common prescription across every past prescription for that
       diagnosis (a medicine that appears in at least half of them, with the
       dosage written most often). Plain counting, no AI.
   Takes the parent's `run(fn, okMsg)` so errors toast like every other Admin section. */

export function TreatmentsSection({ run }) {
  const [rows, setRows] = useState([]);
  const [showInactive, setShowInactive] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null); // diagnosis row whose standard is open

  const load = async () => {
    try {
      setRows(await api.diagnoses({ includeInactive: true }));
    } catch {
      setRows([]);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const doRun = async (fn, okMsg) => {
    const ok = await run(fn, okMsg);
    await load();
    return ok;
  };

  const shown = rows.filter((d) => showInactive || d.active !== false);
  const add = async (e) => {
    e?.preventDefault?.();
    const n = name.trim();
    if (!n) return;
    if (await doRun(() => api.admin.create(n), `${n} added`)) setName('');
  };
  const rename = (d) => (v) => v.trim() && v.trim() !== d.name && doRun(() => api.admin.update(d.id, { name: v.trim() }));
  const toggle = (d) => doRun(() => api.admin.update(d.id, { active: d.active === false }));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    doRun(() => api.admin.reorder(next.map((d) => d.id)));
  };
  const remove = (d) => {
    if (!window.confirm(`Delete "${d.name}"? If prescriptions already use it, switch it off instead.`)) return;
    doRun(() => api.admin.remove(d.id), `${d.name} deleted`);
  };

  return (
    <section className="admin-block" aria-labelledby="h-treatments">
      <h2 id="h-treatments">Diagnoses &amp; treatment standards</h2>
      <p className="hint">
        The diagnoses the doctor picks from when writing a prescription. Each one can carry a{' '}
        <b>standard treatment</b> that fills the prescription automatically — either the one Dr Anu sets here, or,
        when none is set, the most common prescription written for that diagnosis so far (counted from the records,
        not guessed). The doctor then changes only what this patient needs.
      </p>
      <div className="admin-tools">
        <label className="admin-check">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            aria-label="Show inactive diagnoses"
          />
          Show inactive
        </label>
      </div>
      <table className="data-table uniform-cells admin-table" style={{ marginBottom: 10 }}>
        <thead>
          <tr>
            <th style={{ width: 50 }}></th>
            <th>Diagnosis</th>
            <th style={{ width: 150 }}>Standard treatment</th>
            <th style={{ width: 110 }}>Past prescriptions</th>
            <th style={{ width: 70 }}>Active</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody id="diagnosisList">
          {shown.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-slot">
                No diagnoses yet — add the first one below
              </td>
            </tr>
          )}
          {shown.map((d) => {
            const i = rows.indexOf(d);
            return (
              <tr key={d.id} data-testid={`diagnosis-${d.id}`} className={d.active === false ? 'staff-inactive' : ''}>
                <td className="no-label">
                  <ReorderBtns i={i} n={rows.length} onMove={(dir) => move(i, dir)} label={`diagnosis ${d.name}`} />
                </td>
                <td data-label="Diagnosis">
                  <EditableText value={d.name} onCommit={rename(d)} ariaLabel={`Diagnosis ${d.name}`} />
                </td>
                <td data-label="Standard treatment" className="no-label">
                  <button
                    type="button"
                    className={`admin-link tx-std-btn${d.hasStandard ? ' set' : ''}`}
                    onClick={() => setEditing(d)}
                    aria-label={`Standard treatment for ${d.name}`}
                  >
                    {d.hasStandard ? 'Set by doctor · edit' : d.prescriptionCount > 0 ? 'From history · set' : 'Not set · add'}
                  </button>
                </td>
                <td data-label="Past prescriptions">
                  <span className="num">{d.prescriptionCount}</span>
                </td>
                <td data-label="Active">
                  <button
                    type="button"
                    className={`switch${d.active !== false ? ' on' : ''}`}
                    role="switch"
                    aria-checked={d.active !== false}
                    aria-label={`Diagnosis ${d.name} active`}
                    onClick={() => toggle(d)}
                  >
                    <div className="knob" />
                  </button>
                </td>
                <td className="no-label">
                  <button className="admin-del" onClick={() => remove(d)} aria-label={`Delete diagnosis ${d.name}`} type="button">
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <form className="admin-add-row" onSubmit={add}>
        <input
          className="fake-input"
          placeholder="New diagnosis — e.g. Dry eye"
          aria-label="New diagnosis"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="admin-add" type="submit" disabled={!name.trim()}>
          + Add a diagnosis
        </button>
      </form>

      {editing && (
        <StandardEditor
          diagnosis={editing}
          onClose={() => {
            setEditing(null);
            load();
          }}
          run={run}
        />
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- editor */
const blank = () => ({ name: '', medicineId: null, matched: false, dosage: '', qtyGiven: 0 });

function StandardEditor({ diagnosis, onClose, run }) {
  const [std, setStd] = useState(null);
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api.standard(diagnosis.id);
        if (cancelled) return;
        setStd(s);
        setLines((s.lines || []).map((l) => ({ ...blank(), ...l })));
      } catch (e) {
        if (!cancelled) setErr(errorMessage(e, 'Could not load the standard'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [diagnosis.id]);

  const setLine = (i, patch) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const addLine = (name, med) => {
    const n = (name || '').trim();
    if (!n) return;
    setLines((ls) => [...ls, { ...blank(), name: med?.name || n, medicineId: med?.id ?? null, matched: !!med }]);
    setSearch('');
  };
  const useHistory = () => {
    if (!std?.historyLines?.length) return;
    setLines(std.historyLines.map((l) => ({ ...blank(), ...l })));
  };

  const save = async () => {
    setBusy(true);
    const ok = await run(
      () =>
        api.admin.saveStandard(
          diagnosis.id,
          lines.filter((l) => l.name.trim()).map((l) => ({
            name: l.name.trim(),
            medicineId: l.medicineId ?? undefined,
            dosage: l.dosage,
            qtyGiven: Number(l.qtyGiven) || 0,
          }))
        ),
      `Standard treatment for ${diagnosis.name} saved`
    );
    setBusy(false);
    if (ok) onClose();
  };
  const clear = async () => {
    if (!window.confirm(`Remove Dr Anu's standard for ${diagnosis.name}? The most common past prescription will be used instead.`))
      return;
    setBusy(true);
    const ok = await run(() => api.admin.clearStandard(diagnosis.id), 'Standard removed');
    setBusy(false);
    if (ok) onClose();
  };

  const sourceLine = !std
    ? ''
    : std.source === 'admin'
      ? `Set by ${std.updatedBy || 'the doctor'}${std.updatedAt ? ` on ${new Date(std.updatedAt).toLocaleDateString('en-IN')}` : ''}.`
      : std.source === 'history'
        ? `Not set by the doctor yet — showing the most common prescription across ${std.historyCount} past prescription${std.historyCount === 1 ? '' : 's'}. Save it as-is or change it.`
        : 'Nothing set yet and no past prescriptions for this diagnosis. Add the medicines below.';

  return (
    <Modal
      open
      title={`Standard treatment · ${diagnosis.name}`}
      sub="What fills the prescription when the doctor picks this diagnosis."
      onClose={onClose}
      className="tx-editor"
      actions={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {std?.source === 'admin' && (
            <button type="button" className="btn-ghost" onClick={clear} disabled={busy}>
              Use history instead
            </button>
          )}
          <button type="button" className="btn-primary full" onClick={save} disabled={busy || !std} data-testid="tx-save">
            {busy ? 'Saving…' : 'Save standard'}
          </button>
        </>
      }
    >
      {err && <p className="ot-save-note err">{err}</p>}
      {std && (
        <p className="rx-fill-note" data-testid="tx-source">
          {sourceLine}
        </p>
      )}
      <div className="tx-lines" data-testid="tx-lines">
        {lines.length === 0 && <p className="rx-none">No medicines yet.</p>}
        {lines.map((l, i) => (
          <div className={`med-row${l.matched ? '' : ' manual'}`} key={i} data-testid="tx-line">
            <div className="med-main">
              <div className="med-name">
                {l.name}
                {l.matched ? (
                  <span className="match-tag">in list</span>
                ) : (
                  <span className="match-tag rx-not-listed">not in list</span>
                )}
                {l.frequency != null && (
                  <span className="tx-freq" title="Share of past prescriptions that included it">
                    {Math.round(l.frequency * 100)}% of past
                  </span>
                )}
              </div>
              <input
                className="dosage-input"
                placeholder="Dosage — e.g. 1 drop, both eyes, 3x daily"
                aria-label={`Dosage for ${l.name}`}
                value={l.dosage}
                onChange={(e) => setLine(i, { dosage: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="rm"
              onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}
              aria-label={`Remove ${l.name}`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="med-manual">
        <MedicinePicker
          value={search}
          onChange={setSearch}
          onPick={(m) => addLine(m.name, m)}
          onEnter={() => addLine(search)}
          ariaLabel="Add a medicine to the standard"
          placeholder="Search or type a medicine name…"
        />
        <button type="button" className="med-add-btn" onClick={() => addLine(search)} disabled={!search.trim()}>
          Add
        </button>
      </div>
      {std?.source === 'admin' && std.historyLines?.length > 0 && (
        <p className="tx-history-hint">
          History says: {std.historyLines.map((l) => `${l.name} (${Math.round((l.frequency || 0) * 100)}%)`).join(', ')}
          {' · '}
          <button type="button" className="rx-add-link" onClick={useHistory}>
            load these instead
          </button>
        </p>
      )}
    </Modal>
  );
}
