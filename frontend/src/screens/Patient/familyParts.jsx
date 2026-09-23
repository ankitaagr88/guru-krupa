import { useEffect, useState } from 'react';
import { family as familyApi } from '../../api';
import { ageSexLabel, fmtDob } from '../../lib/format';
import './patient.css'; // .family-* styles, wherever these pieces show

/* Families on one mobile number — the small pieces every screen shares (lane E1).
   A member carries familyOwnerId + relationKey/relationLabel + familyOwnerName; the owner has
   neither but a familySize above 1. The relations list is admin-configurable (Admin › Family relations). */

/** "Son of Rasila Patel" / "Family of Rasila Patel (relation not set)" / "Owns this number · family of 3" / ''. */
export function familyLine(p, { short = false } = {}) {
  if (!p) return '';
  if (p.familyOwnerId) {
    const owner = p.familyOwnerName || 'the number’s owner';
    if (p.relationLabel) return `${p.relationLabel} of ${owner}`;
    return short ? `Family of ${owner}` : `Family of ${owner} (relation not set)`;
  }
  if ((p.familySize || 1) > 1) return `Owns this number · family of ${p.familySize}`;
  return '';
}

/** The switched-on relations, in the admin's order: [{key, label}]. Loaded once per mount, and
    only when `enabled` (the public /register page never asks). */
export function useRelations(enabled = true) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let alive = true;
    if (!enabled || typeof familyApi?.relations !== 'function') return undefined;
    familyApi
      .relations()
      .then((r) => alive && setRows(Array.isArray(r) ? r : []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled]);
  return rows;
}

/** Relation picker; '' = not set. `placeholder` names the empty choice ("Not set yet" by default;
    "Choose their relation" where one is required), `error` shows under it. */
export function RelationSelect({
  relations,
  value,
  onChange,
  id,
  label = 'Relation',
  disabled = false,
  placeholder = 'Not set yet',
  error = '',
}) {
  const errId = error ? `${id}-error` : undefined;
  const field = (
    <label className="family-field" htmlFor={id}>
      <span className="family-field-label">{label}</span>
      <select
        id={id}
        className={`drop-select${error ? ' error' : ''}`}
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={errId}
      >
        <option value="">{placeholder}</option>
        {relations.map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
      </select>
    </label>
  );
  if (!error) return field;
  return (
    <div className="family-field-wrap">
      {field}
      <span id={errId} className="family-field-error" role="alert">
        {error}
      </span>
    </div>
  );
}

/** The families a same-phone match list can join: one entry per owner, the number's owner first. */
export function ownerChoices(matches, extra = null) {
  const out = [];
  const add = (id, name) => {
    if (id != null && !out.some((o) => o.id === id)) out.push({ id, name });
  };
  if (extra) add(extra.ownerId, extra.ownerName);
  matches.filter((m) => m.familyOwnerId).forEach((m) => add(m.familyOwnerId, m.familyOwnerName || 'Owner'));
  matches.filter((m) => !m.familyOwnerId && (m.familySize || 1) > 1).forEach((m) => add(m.id, m.name));
  matches.forEach((m) => add(m.familyOwnerId || m.id, m.familyOwnerName || m.name));
  return out;
}

/* The "this number is already registered" panel of the staff new-patient forms (queue "New
   patient" and the staff /register page). A number that is already on file usually means a relative
   of an existing patient, so the panel leads with who the number belongs to and asks the new
   patient's relation to its owner straight away (the form won't save without one — see
   `relationMissing`). The same person? Each row keeps its "Use this patient" (`renderUse(m)`, which
   each form handles its own way). Not related? "Not related — separate patient" (`onDismiss`).
   `choice` = {ownerId, ownerName, relationKey} while adding as a family member (the caller sends
   it with the new patient); it is filled in for the number's owner as soon as matches arrive. */
export function SamePhonePrompt({
  matches,
  choice,
  onChoice,
  onDismiss,
  relations,
  renderUse,
  idPrefix = 'np',
  className = '',
  relationError = '',
}) {
  const owners = ownerChoices(matches, choice);
  const first = owners[0];
  // A number on file → start as "new family member of the number's owner".
  useEffect(() => {
    if (!choice && first) onChoice({ ownerId: first.id, ownerName: first.name, relationKey: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, first?.id]);
  if (!choice) return null;

  const notRelated = () => {
    onChoice(null);
    onDismiss?.();
  };
  return (
    <div className={`same-phone family-join ${className}`} role="region" aria-label="Add as a family member" data-testid="family-join">
      {matches.length > 0 ? (
        <>
          <p className="same-phone-title">
            This number belongs to the family of <span className="family-join-owner">{choice.ownerName}</span>
          </p>
          {matches.map((m) => (
            <div key={m.id} className="same-phone-row" data-testid={`same-phone-${m.id}`}>
              <div className="same-phone-who">
                <span className="same-phone-name">{m.name}</span>
                <span className="same-phone-meta">
                  {ageSexLabel(m)}
                  {m.visitId
                    ? ` · in today's queue${m.token ? ` · ${m.token}` : ''}`
                    : m.lastVisitDate
                      ? ` · last visit ${fmtDob(String(m.lastVisitDate).slice(0, 10))}`
                      : ' · no visit yet'}
                </span>
                {familyLine(m, { short: true }) && <span className="family-line">{familyLine(m, { short: true })}</span>}
              </div>
              {renderUse(m)}
            </div>
          ))}
          <p className="same-phone-ask">New patient on this number? Choose how they are related:</p>
        </>
      ) : (
        <p className="same-phone-title">
          New family member of <span className="family-join-owner">{choice.ownerName}</span> on this number
        </p>
      )}
      <div className="family-join-grid">
        {owners.length > 1 && (
          <label className="family-field" htmlFor={`${idPrefix}FamilyOwner`}>
            <span className="family-field-label">Family of</span>
            <select
              id={`${idPrefix}FamilyOwner`}
              className="drop-select"
              value={choice.ownerId}
              onChange={(e) => {
                const o = owners.find((x) => String(x.id) === e.target.value);
                if (o) onChoice({ ...choice, ownerId: o.id, ownerName: o.name });
              }}
            >
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <RelationSelect
          id={`${idPrefix}FamilyRelation`}
          relations={relations}
          label={`Their relation to ${choice.ownerName}`}
          placeholder="Choose their relation"
          value={choice.relationKey}
          error={relationError}
          onChange={(v) => onChoice({ ...choice, relationKey: v })}
        />
      </div>
      <button type="button" className="link-btn same-phone-no" onClick={notRelated}>
        Not related — separate patient
      </button>
    </div>
  );
}

/** The message to show when a new patient joins a family without a relation picked, else ''. */
export function relationMissing(choice) {
  return choice && !choice.relationKey ? `Choose their relation to ${choice.ownerName} (or “Not related”).` : '';
}
