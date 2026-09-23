import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { family as familyApi, errorMessage } from '../../api';
import { phoneKey } from '../../lib/format';
import { RelationSelect, familyLine, ownerChoices, useRelations } from './familyParts';

/* Family box of the queue drawer's registration details (lane E1). A member shows "Son of Rasila
   Patel" with the relation picker (saved on change); the owner shows the family size; someone in
   no family whose number others already use gets "Part of the Patel family?" with the owner and
   the relation, and "Link to family". Nothing shows for a number nobody else has. */
export default function RegistrationFamily({ patientId, phone }) {
  const relations = useRelations();
  const [fam, setFam] = useState(null);
  const [pick, setPick] = useState({ ownerId: null, relationKey: null });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const key = phoneKey(phone);

  useEffect(() => {
    if (patientId == null || typeof familyApi?.get !== 'function') return undefined;
    let alive = true;
    // The phone autosaves a moment after typing stops; look again once it has.
    const t = setTimeout(() => {
      familyApi
        .get(patientId)
        .then((f) => alive && setFam(f))
        .catch(() => {}); // the box is a convenience; registration works without it
    }, fam && fam.patientId === patientId ? 900 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch on patient / number change only
  }, [patientId, key]);

  if (!fam || fam.patientId !== patientId) return null;
  const me = fam.members.find((m) => m.id === patientId);
  const owner = fam.members.find((m) => m.isOwner);

  const save = async (fn, okMsg) => {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const f = await fn();
      setFam(f);
      setMsg(f?.message || okMsg);
    } catch (e) {
      setErr(errorMessage(e, 'Could not save'));
    } finally {
      setBusy(false);
    }
  };

  let body = null;
  if (me && !me.isOwner) {
    body = (
      <>
        <span className="family-line" data-testid="reg-family-line">
          {familyLine({ familyOwnerId: owner?.id, familyOwnerName: owner?.name, relationLabel: me.relationLabel })}
        </span>
        <div className="reg-family-row">
          <RelationSelect
            id="detFamilyRelation"
            relations={relations}
            label={`Relation to ${owner?.name || 'the owner'}`}
            value={me.relationKey}
            disabled={busy}
            onChange={(v) => save(() => familyApi.setRelation(patientId, v), 'Relation saved.')}
          />
        </div>
      </>
    );
  } else if (me) {
    body = (
      <span className="family-line" data-testid="reg-family-line">
        Owns this number · family of {fam.members.length} ·{' '}
        <Link to={`/patients/${patientId}`}>see the family</Link>
      </span>
    );
  } else if (fam.samePhone.length > 0) {
    const owners = ownerChoices(fam.samePhone);
    const ownerId = pick.ownerId ?? owners[0].id;
    const chosen = owners.find((o) => o.id === ownerId) || owners[0];
    const surname = chosen.name.trim().split(/\s+/).slice(-1)[0];
    body = (
      <>
        <p className="reg-family-q">Part of the {surname} family?</p>
        <div className="reg-family-row">
          {owners.length > 1 && (
            <label className="family-field" htmlFor="detFamilyOwner">
              <span className="family-field-label">Family of</span>
              <select
                id="detFamilyOwner"
                className="drop-select"
                value={ownerId}
                onChange={(e) => setPick((x) => ({ ...x, ownerId: Number(e.target.value) }))}
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
            id="detFamilyJoinRelation"
            relations={relations}
            label={`Relation to ${chosen.name}`}
            value={pick.relationKey}
            onChange={(v) => setPick((x) => ({ ...x, relationKey: v }))}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => save(() => familyApi.link(patientId, chosen.id, pick.relationKey), `Linked to ${chosen.name}'s family.`)}
          >
            Link to family
          </button>
        </div>
      </>
    );
  }
  if (!body) return null;
  return (
    <div className="reg-family" role="group" aria-label="Family on this number" data-testid="reg-family">
      {body}
      {msg && (
        <p className="family-msg" role="status">
          {msg}
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
