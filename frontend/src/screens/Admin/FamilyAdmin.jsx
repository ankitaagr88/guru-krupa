import { useEffect, useState } from 'react';
import { family as familyApi, errorMessage } from '../../api';
import { EditableText, ReorderBtns } from './pieces';
import '../Patient/patient.css'; // .family-msg / .family-err

/* Admin › Family relations (lane E1 owns this file): the relations a family member can have to the
   owner of the shared mobile number (Son, Daughter, Spouse...), and "Group patients who share a
   number" for records that came in before families existed (e.g. the KiviHealth import).
   Takes the parent's `run(fn, okMsg)`. */
export function RelationsSection({ run }) {
  const [rows, setRows] = useState([]);
  const [label, setLabel] = useState('');

  const load = async () => {
    try {
      setRows(await familyApi.relations({ includeInactive: true }));
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

  const add = async (e) => {
    e?.preventDefault?.();
    const n = label.trim();
    if (!n) return;
    if (await doRun(() => familyApi.admin.create(n), `${n} added`)) setLabel('');
  };
  const rename = (r) => (v) =>
    v.trim() && v.trim() !== r.label && doRun(() => familyApi.admin.update(r.key, { label: v.trim() }));
  const toggle = (r) => doRun(() => familyApi.admin.update(r.key, { active: r.active === false }));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    doRun(() => familyApi.admin.reorder(next.map((r) => r.key)));
  };
  const remove = (r) => {
    if (!window.confirm(`Delete "${r.label}"? If patients already have it, switch it off instead.`)) return;
    doRun(() => familyApi.admin.remove(r.key), `${r.label} deleted`);
  };

  return (
    <section className="admin-block" aria-labelledby="h-relations">
      <h2 id="h-relations">Family relations</h2>
      <p className="hint">
        Families share one mobile number: one person owns the number and everyone else is linked to them with
        their relation (&ldquo;Son of Rasila Patel&rdquo;). These are the relations reception can pick, in this
        order. A relation patients already have can&apos;t be deleted — switch it off to hide it from new links.
      </p>
      <table className="data-table uniform-cells admin-table" style={{ marginBottom: 10 }}>
        <thead>
          <tr>
            <th style={{ width: 50 }}></th>
            <th>Relation</th>
            <th style={{ width: 90 }}>Patients</th>
            <th style={{ width: 70 }}>Active</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody id="relationList">
          {rows.map((r, i) => (
            <tr key={r.key} data-testid={`relation-${r.key}`} className={r.active === false ? 'staff-inactive' : ''}>
              <td className="no-label">
                <ReorderBtns i={i} n={rows.length} onMove={(dir) => move(i, dir)} label={`relation ${r.label}`} />
              </td>
              <td data-label="Relation">
                <EditableText value={r.label} onCommit={rename(r)} ariaLabel={`Relation ${r.label}`} />
              </td>
              <td data-label="Patients" className="num">
                {r.patientCount ?? 0}
              </td>
              <td data-label="Active">
                <button
                  type="button"
                  className={`switch${r.active !== false ? ' on' : ''}`}
                  role="switch"
                  aria-checked={r.active !== false}
                  aria-label={`Relation ${r.label} active`}
                  onClick={() => toggle(r)}
                >
                  <div className="knob" />
                </button>
              </td>
              <td className="no-label">
                <button className="admin-del" onClick={() => remove(r)} aria-label={`Delete relation ${r.label}`} type="button">
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="admin-add-row" onSubmit={add}>
        <input
          className="fake-input"
          placeholder="New relation — e.g. Nephew"
          aria-label="New relation"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button className="admin-add" type="submit" disabled={!label.trim()}>
          + Add a relation
        </button>
      </form>

      <GroupSharedNumbers onDone={load} />
    </section>
  );
}

/* "Group patients who share a number": first a preview (nothing changes), then the grouping. The
   earliest registered patient on a number owns it (or the family already there); everyone else on
   that number is linked with the relation "not set" for staff to fill in. Running it again only
   picks up newcomers. */
function GroupSharedNumbers({ onDone }) {
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const call = async (fn, set) => {
    setBusy(true);
    setErr('');
    try {
      set(await fn());
    } catch (e) {
      setErr(errorMessage(e, 'Could not group the patients'));
    } finally {
      setBusy(false);
    }
  };
  const check = () => {
    setResult(null);
    call(() => familyApi.admin.groupingPreview(), setPreview);
  };
  const group = () =>
    call(
      () => familyApi.admin.groupingRun(),
      (r) => {
        setResult(r);
        setPreview(null);
        onDone?.();
      }
    );

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  return (
    <div className="family-group" data-testid="family-grouping">
      <h3 className="section-title" style={{ margin: '18px 0 4px' }}>
        Group patients who share a number
      </h3>
      <p className="hint">
        For records that came in before families (for example the KiviHealth import): patients on the same mobile
        number are linked to the earliest registered one, with the relation &ldquo;not set&rdquo; so reception can
        fill it in later. Nothing changes until you press &ldquo;Group them&rdquo;.
      </p>
      {!preview && (
        <button type="button" className="btn-ghost" style={{ flex: 'none' }} onClick={check} disabled={busy}>
          {busy ? 'Checking…' : 'Check shared numbers'}
        </button>
      )}
      {preview && (
        <div className="family-msg" role="status" data-testid="family-grouping-preview">
          {preview.membersLinked === 0 ? (
            <p style={{ margin: 0 }}>Nothing to group: everyone who shares a number is already in a family.</p>
          ) : (
            <>
              <p style={{ margin: '0 0 6px' }}>
                {plural(preview.numbers, 'shared number', 'shared numbers')} ·{' '}
                {plural(preview.newFamilies, 'new family', 'new families')} ·{' '}
                {plural(preview.membersLinked, 'patient', 'patients')} to link
              </p>
              <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
                {preview.sample.slice(0, 5).map((s) => (
                  <li key={s.ownerId}>
                    <span className="num">{s.phone}</span>: {s.memberNames.join(', ')} → family of {s.ownerName}
                  </li>
                ))}
              </ul>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn-primary" onClick={group} disabled={busy}>
                  {busy ? 'Grouping…' : `Group them (${preview.membersLinked})`}
                </button>
                <button type="button" className="btn-ghost" style={{ flex: 'none' }} onClick={() => setPreview(null)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {result && (
        <p className="family-msg" role="status" data-testid="family-grouping-done">
          Done: {plural(result.membersLinked, 'patient', 'patients')} linked on{' '}
          {plural(result.numbers, 'number', 'numbers')} ({plural(result.newFamilies, 'new family', 'new families')}).
          Set their relations from each patient&apos;s page.
        </p>
      )}
      {err && (
        <p className="family-err" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}
