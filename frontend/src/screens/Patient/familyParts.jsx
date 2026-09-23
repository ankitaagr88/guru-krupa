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

/** Relation picker; '' = not set. */
export function RelationSelect({ relations, value, onChange, id, label = 'Relation', disabled = false }) {
  return (
    <label className="family-field" htmlFor={id}>
      <span className="family-field-label">{label}</span>
      <select
        id={id}
        className="drop-select"
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
      >
        <option value="">Not set yet</option>
        {relations.map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
      </select>
    </label>
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

/* The "Already registered with this number" prompt of the staff new-patient forms (queue "New
   patient" and the staff /register page). Three answers: "Use this patient" (an existing record),
   "Add as a family member" (a new patient linked to the number's owner with their relation) or
   "No — separate patient". `choice` = {ownerId, ownerName, relationKey} while adding as a family
   member (the caller sends it with the new patient), else null. `renderUse(m)` draws the per-row
   "Use this patient" button, which each form handles its own way. */
export function SamePhonePrompt({
  matches,
  choice,
  onChoice,
  onDismiss,
  relations,
  renderUse,
  idPrefix = 'np',
  className = '',
}) {
  const owners = ownerChoices(matches, choice);
  if (choice) {
    return (
      <div className={`same-phone family-join ${className}`} role="region" aria-label="Add as a family member" data-testid="family-join">
        <p className="same-phone-title">
          New family member of <span className="family-join-owner">{choice.ownerName}</span> on this number
        </p>
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
            value={choice.relationKey}
            onChange={(v) => onChoice({ ...choice, relationKey: v })}
          />
        </div>
        <button type="button" className="link-btn same-phone-no" onClick={() => onChoice(null)}>
          Not a family member
        </button>
      </div>
    );
  }
  if (!matches.length) return null;
  const first = owners[0];
  return (
    <div className={`same-phone ${className}`} role="region" aria-label="Already registered with this number" data-testid="same-phone">
      <p className="same-phone-title">Already registered with this number — is it one of these?</p>
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
      <div className="family-join-actions">
        <button
          type="button"
          className="btn-ghost"
          data-testid="family-add-member"
          onClick={() => onChoice({ ownerId: first.id, ownerName: first.name, relationKey: null })}
        >
          Add as a family member
        </button>
        <button type="button" className="link-btn same-phone-no" onClick={onDismiss}>
          No — separate patient
        </button>
      </div>
    </div>
  );
}
