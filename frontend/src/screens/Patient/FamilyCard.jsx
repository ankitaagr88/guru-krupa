import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { family as familyApi, errorMessage } from '../../api';
import { ageSexLabel, fmtLastVisit } from '../../lib/format';
import { RelationSelect, familyLine } from './familyParts';

/* "Family on this number" card of the patient screen (lane E1). The owner of the mobile number
   first, then every member with their relation to the owner, age / sex and last visit, each a link
   to their own record. Actions: Change relation, Make owner of this number, Remove from family,
   and for others registered on the same number: Add to this family / Join their family.
   "Add family member" (a new patient) is the parent's New patient form (`onAddMember`).
   Every change calls `onChanged` so the page header ("Son of ...") refreshes. */
export default function FamilyCard({ patient, relations, reloadKey = 0, onAddMember, onChanged }) {
  const [fam, setFam] = useState(null);
  const [edit, setEdit] = useState(null); // {id, mode: 'relation'|'owner'|'remove'|'add'|'join', value}
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const pid = patient.id;

  useEffect(() => {
    let alive = true;
    familyApi
      .get(pid)
      .then((f) => alive && setFam(f))
      .catch((e) => alive && setErr(errorMessage(e, 'Could not load the family')));
    return () => {
      alive = false;
    };
  }, [pid, reloadKey]);

  if (!fam) {
    return (
      <section className="card patient-card-static patient-family" aria-labelledby="ph-family">
        <h3 id="ph-family" className="section-title">
          Family on this number
        </h3>
        {err ? <p className="family-err">{err}</p> : <p className="patient-empty">Loading…</p>}
      </section>
    );
  }

  const owner = fam.members.find((m) => m.isOwner) || null;
  const ownerForAdd = owner || { id: pid, name: patient.name, phone: patient.phone };

  const act = async (fn, after) => {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const f = await fn();
      setFam(f);
      setMsg(f?.message || after || '');
      setEdit(null);
      onChanged?.();
    } catch (e) {
      setErr(errorMessage(e, 'Could not save'));
    } finally {
      setBusy(false);
    }
  };

  const open = (id, mode, value = '') => {
    setErr('');
    setEdit({ id, mode, value });
  };

  const editor = (m) => {
    if (!edit || edit.id !== m.id) return null;
    const setValue = (v) => setEdit((e) => ({ ...e, value: v }));
    const cancel = (
      <button type="button" className="btn-ghost" onClick={() => setEdit(null)} disabled={busy}>
        Cancel
      </button>
    );
    if (edit.mode === 'relation')
      return (
        <div className="family-edit">
          <RelationSelect
            id={`famRel${m.id}`}
            relations={relations}
            label={`${m.name}'s relation to ${owner?.name || 'the owner'}`}
            value={edit.value}
            onChange={setValue}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => act(() => familyApi.setRelation(m.id, edit.value || null), 'Relation saved.')}
          >
            Save relation
          </button>
          {cancel}
        </div>
      );
    if (edit.mode === 'owner')
      return (
        <div className="family-edit">
          <p className="family-edit-note">
            {m.name} will own this number. {owner?.name} stays in the family as a member.
          </p>
          <RelationSelect
            id={`famOwner${m.id}`}
            relations={relations}
            label={`${owner?.name}'s relation to ${m.name}`}
            value={edit.value}
            onChange={setValue}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => act(() => familyApi.makeOwner(m.id, edit.value || null))}
          >
            Make {m.name.split(/\s+/)[0]} the owner
          </button>
          {cancel}
        </div>
      );
    if (edit.mode === 'remove')
      return (
        <div className="family-edit">
          <p className="family-edit-note">
            {m.name} stays a patient with all their visits; only the family link goes.
          </p>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => act(() => familyApi.remove(m.id))}
          >
            Remove from family
          </button>
          {cancel}
        </div>
      );
    if (edit.mode === 'add' || edit.mode === 'join') {
      // add: the other person joins this family; join: this patient joins the other person's family.
      const target = edit.mode === 'add' ? ownerForAdd : { id: m.familyOwnerId || m.id, name: m.familyOwnerName || m.name };
      const who = edit.mode === 'add' ? m : { id: pid, name: patient.name };
      return (
        <div className="family-edit">
          <RelationSelect
            id={`famLink${m.id}`}
            relations={relations}
            label={`${who.name}'s relation to ${target.name}`}
            value={edit.value}
            onChange={setValue}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() =>
              act(async () => {
                await familyApi.link(who.id, target.id, edit.value || null);
                return familyApi.get(pid).then((f) => ({ ...f, message: `${who.name} added to ${target.name}'s family.` }));
              })
            }
          >
            {edit.mode === 'add' ? 'Add to this family' : `Join ${target.name.split(/\s+/)[0]}'s family`}
          </button>
          {cancel}
        </div>
      );
    }
    return null;
  };

  const meta = (m) =>
    `${ageSexLabel(m)} · ${m.lastVisitDate ? `last visit ${fmtLastVisit(String(m.lastVisitDate).slice(0, 10)).toLowerCase()}` : 'no visit yet'}`;

  return (
    <section className="card patient-card-static patient-family" aria-labelledby="ph-family" data-testid="family-card">
      <div className="patient-family-head">
        <h3 id="ph-family" className="section-title">
          Family on this number
          {fam.phone && <span className="patient-visit-meta num"> · {fam.phone}</span>}
        </h3>
        <button
          type="button"
          className="btn-ghost"
          data-testid="family-add"
          onClick={() => onAddMember?.({ phone: ownerForAdd.phone || patient.phone || '', ownerId: ownerForAdd.id, ownerName: ownerForAdd.name })}
        >
          Add family member
        </button>
      </div>

      {fam.members.length === 0 && (
        <p className="patient-empty">No family linked yet.</p>
      )}
      {fam.members.map((m) => {
        const me = m.id === pid;
        return (
          <div key={m.id} className={`family-row${me ? ' is-me' : ''}`} data-testid={`family-member-${m.id}`}>
            <div className="family-who">
              {me ? (
                <span className="family-name">{m.name}</span>
              ) : (
                <Link className="family-name" to={`/patients/${m.id}`}>
                  {m.name}
                </Link>
              )}
              {m.isOwner ? (
                <span className="family-rel">Owns this number</span>
              ) : (
                <span className={`family-rel${m.relationLabel ? '' : ' unset'}`}>{m.relationLabel || 'Relation not set'}</span>
              )}
              <span className="family-meta">{meta(m)}</span>
            </div>
            <div className="family-actions" hidden={edit?.id === m.id}>
              {!m.isOwner && (
                <>
                  <button type="button" className="link-btn" onClick={() => open(m.id, 'relation', m.relationKey || '')}>
                    Change relation
                  </button>
                  <button type="button" className="link-btn" onClick={() => open(m.id, 'owner', '')}>
                    Make owner of this number
                  </button>
                </>
              )}
              <button type="button" className="link-btn danger" onClick={() => open(m.id, 'remove')}>
                Remove from family
              </button>
            </div>
            {editor(m)}
          </div>
        );
      })}

      {fam.samePhone.length > 0 && (
        <div className="family-others">
          <div className="field-label">Also registered on this number</div>
          {fam.samePhone.map((m) => {
            const inAFamily = !!m.familyOwnerId || (m.familySize || 1) > 1;
            return (
              <div key={m.id} className="family-row" data-testid={`family-other-${m.id}`}>
                <div className="family-who">
                  <Link className="family-name" to={`/patients/${m.id}`}>
                    {m.name}
                  </Link>
                  <span className="family-meta">{meta(m)}</span>
                  {inAFamily && <span className="family-line">{familyLine(m, { short: true })}</span>}
                </div>
                <div className="family-actions" hidden={edit?.id === m.id}>
                  {inAFamily ? (
                    fam.members.length === 0 && (
                      <button type="button" className="link-btn" onClick={() => open(m.id, 'join', '')}>
                        Join their family
                      </button>
                    )
                  ) : (
                    <button type="button" className="link-btn" onClick={() => open(m.id, 'add', '')}>
                      Add to this family
                    </button>
                  )}
                </div>
                {editor(m)}
              </div>
            );
          })}
        </div>
      )}

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
    </section>
  );
}
