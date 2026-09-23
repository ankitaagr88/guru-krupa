import { useEffect, useState } from 'react';
import { admin as adminApi, fees as feesApi } from '../../api';
import { EditableText, ReorderBtns } from './pieces';
import './visitFees.css';

/* Admin › Visit types & fee rules (lane E2 owns this file): new patient / follow-up / new case /
   after surgery, the charge each puts on the bill, and the day limits and emergency hours that pick
   one automatically when a patient is registered. Reception can always change the pick. Takes the
   parent's `run(fn, okMsg)`. */

const RULE_KINDS = [
  ['newPatientKind', 'First visit (no earlier visit on record)'],
  ['freeFollowUpKind', 'Back within the free follow-up days'],
  ['followUpKind', 'Back after that, up to the new-case limit'],
  ['newCaseKind', 'Back after the new-case limit, or a different problem'],
  ['postOpKind', 'After surgery, within the post-surgery days'],
];

const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export function VisitFeesSection({ run }) {
  const [kinds, setKinds] = useState([]);
  const [charges, setCharges] = useState([]);
  const [rules, setRules] = useState(null);
  const [draft, setDraft] = useState(null);
  const [label, setLabel] = useState('');
  const [chargeId, setChargeId] = useState('');

  const load = async () => {
    if (!feesApi?.admin) return;
    try {
      const [k, ch, r] = await Promise.all([
        feesApi.admin.kinds.list(),
        adminApi.standardCharges.list(),
        feesApi.admin.rules(),
      ]);
      setKinds(k || []);
      setCharges(ch || []);
      setRules(r || null);
      setDraft(r ? { ...r } : null);
    } catch {
      setKinds([]);
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

  const chargeOptions = charges.filter((ch) => ch.active !== false);
  const chargeName = (id) => {
    const ch = charges.find((c) => c.id === id);
    return ch ? `${ch.label} · ${rupees(ch.amount)}` : '';
  };
  const chargeSelect = ({ value, onChange, ariaLabel, noneLabel = 'Free — no charge' }) => (
    <select
      className="admin-select"
      aria-label={ariaLabel}
      value={value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">{noneLabel}</option>
      {chargeOptions.map((ch) => (
        <option key={ch.id} value={ch.id}>
          {ch.label} · {rupees(ch.amount)}
        </option>
      ))}
      {value != null && !chargeOptions.some((ch) => ch.id === value) && (
        <option value={value}>{chargeName(value) || 'Switched-off charge'}</option>
      )}
    </select>
  );

  /* ---------- visit kinds ---------- */
  const add = async (e) => {
    e?.preventDefault?.();
    const l = label.trim();
    if (!l) return;
    const body = { label: l, standardChargeId: chargeId === '' ? null : Number(chargeId) };
    if (await doRun(() => feesApi.admin.kinds.create(body), `${l} added`)) {
      setLabel('');
      setChargeId('');
    }
  };
  const rename = (k) => (v) =>
    v.trim() && v.trim() !== k.label && doRun(() => feesApi.admin.kinds.update(k.id, { label: v.trim() }));
  const setCharge = (k) => (id) =>
    doRun(
      () => feesApi.admin.kinds.update(k.id, { standardChargeId: id }),
      `${k.label}: ${id == null ? 'no charge' : chargeName(id)}`
    );
  const toggle = (k) => doRun(() => feesApi.admin.kinds.update(k.id, { active: k.active === false }));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= kinds.length) return;
    const next = [...kinds];
    [next[i], next[j]] = [next[j], next[i]];
    doRun(() => feesApi.admin.kinds.reorder(next.map((k) => k.id)));
  };
  const remove = (k) => {
    if (
      !window.confirm(`Delete the visit type "${k.label}"? If visits already use it, switch it off instead.`)
    )
      return;
    doRun(() => feesApi.admin.kinds.remove(k.id), `${k.label} deleted`);
  };

  /* ---------- rules ---------- */
  const setRule = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const dayInput = (key, ariaLabel) => (
    <input
      className="fake-input fee-rule-days"
      inputMode="numeric"
      aria-label={ariaLabel}
      value={draft?.[key] ?? ''}
      onChange={(e) => setRule(key, e.target.value.replace(/[^\d]/g, ''))}
    />
  );
  const dirty =
    draft && rules && Object.keys(draft).some((k) => String(draft[k] ?? '') !== String(rules[k] ?? ''));
  const saveRules = (e) => {
    e?.preventDefault?.();
    if (!draft) return;
    const body = { ...draft };
    ['freeFollowUpDays', 'newCaseAfterDays', 'postOpDays'].forEach((k) => {
      body[k] = Number(body[k]);
    });
    doRun(() => feesApi.admin.saveRules(body), 'Fee rules saved');
  };
  const activeKinds = kinds.filter((k) => k.active !== false);

  return (
    <section className="admin-block" aria-labelledby="h-visitfees">
      <h2 id="h-visitfees">Visit types &amp; fee rules</h2>
      <p className="hint">
        When a patient is registered, the app picks the kind of visit from the rules below and puts its fee on
        the bill as a suggestion. Reception can always change it — for example &ldquo;Different problem &rarr;
        New case&rdquo; — or remove the fee from the bill.
      </p>

      <h3 className="fee-subhead">Visit types</h3>
      <table className="data-table uniform-cells admin-table" style={{ marginBottom: 10 }}>
        <thead>
          <tr>
            <th style={{ width: 50 }}></th>
            <th>Visit type</th>
            <th style={{ width: 260 }}>Charge on the bill</th>
            <th style={{ width: 70 }}>Active</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody id="visitKindList">
          {kinds.length === 0 && (
            <tr>
              <td colSpan={5} className="hint">
                No visit types yet — add the first one below.
              </td>
            </tr>
          )}
          {kinds.map((k, i) => (
            <tr
              key={k.id}
              data-testid={`visit-kind-${k.key}`}
              className={k.active === false ? 'staff-inactive' : ''}
            >
              <td className="no-label">
                <ReorderBtns
                  i={i}
                  n={kinds.length}
                  onMove={(dir) => move(i, dir)}
                  label={`visit type ${k.label}`}
                />
              </td>
              <td data-label="Visit type">
                <EditableText value={k.label} onCommit={rename(k)} ariaLabel={`Visit type ${k.label}`} />
                {k.inUse > 0 && (
                  <small className="fee-in-use">
                    <span className="mono">{k.inUse}</span> visit{k.inUse === 1 ? '' : 's'}
                  </small>
                )}
              </td>
              <td data-label="Charge">
                {chargeSelect({
                  value: k.standardChargeId,
                  onChange: setCharge(k),
                  ariaLabel: `Charge for ${k.label}`,
                })}
              </td>
              <td data-label="Active">
                <button
                  type="button"
                  className={`switch${k.active !== false ? ' on' : ''}`}
                  role="switch"
                  aria-checked={k.active !== false}
                  aria-label={`Visit type ${k.label} active`}
                  onClick={() => toggle(k)}
                >
                  <div className="knob" />
                </button>
              </td>
              <td className="no-label">
                <button
                  className="admin-del"
                  onClick={() => remove(k)}
                  aria-label={`Delete visit type ${k.label}`}
                  type="button"
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="admin-add-row" onSubmit={add} style={{ marginBottom: 18 }}>
        <input
          className="fake-input"
          placeholder="New visit type — e.g. OT follow-up"
          aria-label="New visit type"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <select
          className="admin-select"
          aria-label="New visit type charge"
          value={chargeId}
          onChange={(e) => setChargeId(e.target.value)}
          style={{ maxWidth: 260 }}
        >
          <option value="">Free — no charge</option>
          {chargeOptions.map((ch) => (
            <option key={ch.id} value={ch.id}>
              {ch.label} · {rupees(ch.amount)}
            </option>
          ))}
        </select>
        <button className="admin-add" type="submit" disabled={!label.trim()}>
          + Add a visit type
        </button>
      </form>

      <h3 className="fee-subhead">Rules that pick the visit type</h3>
      {draft ? (
        <form className="fee-rules" onSubmit={saveRules} data-testid="fee-rules-form">
          <div className="fee-rule">
            <p className="fee-rule-text">
              Back within {dayInput('freeFollowUpDays', 'Free follow-up days')} days of the last visit (same
              problem): <b>free follow-up</b>.
            </p>
          </div>
          <div className="fee-rule">
            <p className="fee-rule-text">
              Back after more than {dayInput('newCaseAfterDays', 'New case after days')} days: <b>new case</b>{' '}
              <span className="fee-rule-aside">(182 days is about 6 months)</span>. In between:{' '}
              <b>follow-up</b>.
            </p>
          </div>
          <div className="fee-rule fee-rule-confirm">
            <p className="fee-rule-text">
              After surgery: for {dayInput('postOpDays', 'Post-surgery days')} days after the surgery date,
              the visit is &ldquo;
              {activeKinds.find((k) => k.key === draft.postOpKind)?.label || draft.postOpKind}&rdquo;.
            </p>
            <span className="status-pill alert fee-confirm-tag">To confirm with Dr Anu</span>
            <p className="fee-rule-aside">
              Set for now to free for 30 days after the surgery date. Change the days here, and the fee in the
              &ldquo;After surgery&rdquo; visit type above, once Dr Anu confirms the rule.
            </p>
          </div>
          <div className="fee-rule">
            <p className="fee-rule-text">
              Emergency fee when registered from{' '}
              <input
                className="fake-input fee-rule-time"
                aria-label="Emergency from"
                placeholder="20:00"
                value={draft.emergencyFrom ?? ''}
                onChange={(e) => setRule('emergencyFrom', e.target.value)}
              />{' '}
              to{' '}
              <input
                className="fake-input fee-rule-time"
                aria-label="Emergency to"
                placeholder="08:00"
                value={draft.emergencyTo ?? ''}
                onChange={(e) => setRule('emergencyTo', e.target.value)}
              />{' '}
              (24-hour clock, clinic time)
            </p>
            <label className="fee-rule-check">
              <input
                type="checkbox"
                checked={!!draft.emergencyOnSunday}
                onChange={(e) => setRule('emergencyOnSunday', e.target.checked)}
              />{' '}
              and all day on Sundays (emergency by prior appointment)
            </label>
            <div className="fee-rule-select">
              <span>Emergency charge</span>
              {chargeSelect({
                value: draft.emergencyChargeId ?? null,
                onChange: (id) => setRule('emergencyChargeId', id),
                ariaLabel: 'Emergency charge',
                noneLabel: 'No emergency fee',
              })}
            </div>
            <p className="fee-rule-aside">Reception can remove the emergency fee from any visit.</p>
          </div>
          <details className="fee-rule-kinds">
            <summary>Which visit type each rule uses</summary>
            {RULE_KINDS.map(([key, text]) => (
              <div className="fee-rule-select" key={key}>
                <span>{text}</span>
                <select
                  className="admin-select"
                  aria-label={text}
                  value={draft[key] ?? ''}
                  onChange={(e) => setRule(key, e.target.value)}
                >
                  {activeKinds.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </details>
          <div className="fee-rule-actions">
            <button className="btn-primary" type="submit" disabled={!dirty}>
              Save fee rules
            </button>
            {dirty && (
              <button type="button" className="btn-ghost" onClick={() => setDraft({ ...rules })}>
                Undo changes
              </button>
            )}
          </div>
        </form>
      ) : (
        <p className="hint">Loading the fee rules…</p>
      )}
    </section>
  );
}
