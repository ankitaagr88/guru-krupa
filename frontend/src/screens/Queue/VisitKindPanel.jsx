import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { billing as billingApi, fees as feesApi, errorMessage } from '../../api';
import { announceBillChanged } from '../Billing/billEvents';
import { emergencyWhen, kindTagText, rupees } from './visitKind';
import './visitKind.css';

/* Visit type & fee in the patient drawer (lane E2). The kind (new patient, follow-up, new case,
   after surgery…) was suggested at registration from Admin › Visit types & fee rules; reception
   sees why ("Last visit 12 days ago") and can change it — including "Different problem → New
   case" — and switch the emergency fee on or off. The bill's suggested fee line follows on the
   server; this panel announces it so an open bill reloads.
   `mode="doctor"`: only the kind and the "Different problem" button. `onChanged(visitOut)` lets
   the queue reload. */
export default function VisitKindPanel({ row, mode = 'full', busy = false, onChanged }) {
  const toast = useToast();
  const [kinds, setKinds] = useState([]);
  const [rules, setRules] = useState(null);
  const [emergencyCharge, setEmergencyCharge] = useState(null);
  const [latest, setLatest] = useState(null); // what the last change returned, until the board catches up
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    if (typeof feesApi?.kinds !== 'function') return undefined;
    Promise.all([feesApi.kinds(), feesApi.rules(), billingApi.charges ? billingApi.charges() : []])
      .then(([k, r, charges]) => {
        if (!alive) return;
        setKinds(k || []);
        setRules(r || null);
        setEmergencyCharge((charges || []).find((ch) => ch.id === r?.emergencyChargeId) || null);
      })
      .catch(() => alive && setKinds([]));
    return () => {
      alive = false;
    };
  }, []);

  const rowId = row?.id;
  useEffect(() => setLatest(null), [rowId, row?.visitKindKey, row?.emergency]);

  if (!row || typeof feesApi?.setKind !== 'function') return null;
  const v = latest && latest.id === row.id ? { ...row, ...latest } : row;
  const current = kinds.find((k) => k.key === v.visitKindKey);
  const label = current?.label ?? v.visitKindLabel;
  const charge = current ? current.chargeAmount : v.visitKindCharge;
  const newCase = kinds.find((k) => k.key === rules?.newCaseKind);
  const showDifferent =
    !!newCase && v.visitKindKey !== rules.newCaseKind && v.visitKindKey !== rules.newPatientKind;
  const disabled = busy || saving;

  const change = async (patch, okMsg) => {
    setSaving(true);
    try {
      const out = await feesApi.setKind(row.id, patch);
      setLatest({
        id: row.id,
        visitKindKey: out?.visitKindKey ?? patch.visitKindKey ?? v.visitKindKey,
        visitKindLabel: out?.visitKindLabel ?? v.visitKindLabel,
        visitKindCharge: out ? (out.visitKindCharge ?? null) : v.visitKindCharge,
        emergency: out?.emergency ?? patch.emergency ?? v.emergency,
      });
      announceBillChanged(row.id);
      toast.success(okMsg);
      onChanged?.(out);
    } catch (err) {
      toast.error('Could not change the visit type', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const pick = (k) =>
    k.key !== v.visitKindKey &&
    change({ visitKindKey: k.key }, `Visit type: ${kindTagText(k.label, k.chargeAmount)}`);
  const different = () =>
    change({ visitKindKey: newCase.key }, `Different problem — charged as ${newCase.label}`);

  const feeText = charge == null ? 'no charge' : rupees(charge);

  return (
    <div className="visit-kind" data-testid="visit-kind-panel">
      <div className="field-label">Visit type &amp; fee</div>
      <div className="visit-kind-now" data-testid="visit-kind-now">
        <span className="visit-kind-name">{label || 'Not set yet'}</span>
        {label && <span className="mono visit-kind-fee">{feeText}</span>}
        {v.emergency && <span className="status-pill alert">Emergency</span>}
        {v.feeReason && <small className="visit-kind-why">{v.feeReason}</small>}
      </div>

      {mode === 'full' && kinds.length > 0 && (
        <div className="visit-kind-opts" role="radiogroup" aria-label="Visit type">
          {kinds.map((k) => (
            <button
              key={k.key}
              type="button"
              role="radio"
              aria-checked={k.key === v.visitKindKey}
              className={`channel-opt walkin${k.key === v.visitKindKey ? ' active' : ''}`}
              onClick={() => pick(k)}
              disabled={disabled}
            >
              {k.label}{' '}
              <span className="mono">{k.chargeAmount == null ? 'free' : rupees(k.chargeAmount)}</span>
            </button>
          ))}
        </div>
      )}

      {showDifferent && (
        <button
          type="button"
          className="stage-btn visit-kind-different"
          onClick={different}
          disabled={disabled}
          data-testid="different-problem"
        >
          Different problem — charge as {newCase.label}{' '}
          <small>
            came back for something new ·{' '}
            <span className="mono">
              {newCase.chargeAmount == null ? 'free' : rupees(newCase.chargeAmount)}
            </span>
          </small>
        </button>
      )}

      {mode === 'full' && emergencyCharge && (
        <label className="visit-kind-emergency">
          <input
            type="checkbox"
            checked={!!v.emergency}
            disabled={disabled}
            onChange={(e) =>
              change(
                { emergency: e.target.checked },
                e.target.checked ? 'Emergency fee added' : 'Emergency fee removed'
              )
            }
          />
          <span>
            Emergency fee <span className="mono">{rupees(emergencyCharge.amount)}</span>
            <small>suggested automatically {emergencyWhen(rules) ? `for ${emergencyWhen(rules)}` : ''}</small>
          </span>
        </label>
      )}
    </div>
  );
}
