import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import {
  doctor as doctorApi,
  treatments as treatmentsApi,
  prescriptions as prescriptionsApi,
  errorMessage,
} from '../../api';

/* The doctor's panel in the queue drawer (doctor stage):
     DiagnosisPicker — picking a diagnosis saves it on the visit and fills the prescription
                       from that diagnosis's standard (Dr Anu's own, else the most common past
                       prescription — counted, not AI). Existing medicines are replaced only
                       after the doctor confirms.
     FollowUpPicker  — "come back in…": storing the date books (or moves) the patient's
                       appointment for that day; "No follow-up" removes it.
   Both report the updated visit (VisitOut) through `onVisit`. */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n) => String(n).padStart(2, '0');
/** Local calendar date → 'YYYY-MM-DD' (not toISOString, which is UTC). */
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** '2026-10-07' → 'Tue 7 Oct' */
export function fmtFollowUp(iso) {
  if (!iso) return '';
  const d = parseIso(iso);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** The quick "come back in…" choices, as dates counted from `from` (today). */
export function followUpPresets(from = new Date()) {
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const days = (n) => isoDate(new Date(base.getFullYear(), base.getMonth(), base.getDate() + n));
  const months = (n) => {
    const d = new Date(base.getFullYear(), base.getMonth() + n, 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return isoDate(new Date(d.getFullYear(), d.getMonth(), Math.min(base.getDate(), last)));
  };
  return [
    { label: '1 week', date: days(7) },
    { label: '2 weeks', date: days(14) },
    { label: '1 month', date: months(1) },
    { label: '3 months', date: months(3) },
  ];
}

const SOURCE_LABEL = {
  admin: "Dr Anu's standard",
  history: 'most common past prescription',
  none: 'no standard yet',
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function DiagnosisPicker({ visitId, diagnosisId, lines, onVisit, onRx, disabled }) {
  const toast = useToast();
  const [diagnoses, setDiagnoses] = useState([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // {source, count, historyCount, kept?}

  useEffect(() => {
    let alive = true;
    treatmentsApi
      .diagnoses()
      .then((list) => alive && setDiagnoses(Array.isArray(list) ? list : []))
      .catch(() => alive && setDiagnoses([]));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => setNote(null), [visitId]);

  const pick = async (value) => {
    const id = value ? Number(value) : null;
    setBusy(true);
    setNote(null);
    try {
      const v = await doctorApi.setDiagnosis(visitId, id);
      onVisit?.(v);
      if (!id) return;
      const std = await treatmentsApi.standard(id);
      const stdLines = std?.lines || [];
      const name = std?.diagnosisName || diagnoses.find((d) => d.id === id)?.name || 'this diagnosis';
      if (stdLines.length === 0) {
        setNote({ source: 'none', count: 0 });
        return;
      }
      const current = lines || [];
      if (
        current.length > 0 &&
        !window.confirm(`Replace the ${plural(current.length, 'medicine')} with the usual set for ${name}?`)
      ) {
        setNote({ source: std.source, count: stdLines.length, kept: true });
        return;
      }
      const body = stdLines.map((l) => ({
        name: l.name,
        medicineId: l.medicineId ?? undefined,
        dosage: l.dosage || '',
        qtyGiven: Number(l.qtyGiven) || 0,
      }));
      const res = await prescriptionsApi.save(visitId, body, null, id);
      onRx?.(res);
      setNote({ source: std.source, count: stdLines.length, historyCount: std.historyCount || 0 });
    } catch (err) {
      toast.error('Could not set the diagnosis', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dx-picker">
      <label className="field-label" htmlFor="drawerDiagnosis">
        Diagnosis
      </label>
      <select
        id="drawerDiagnosis"
        className="drop-select"
        value={diagnosisId ?? ''}
        onChange={(e) => pick(e.target.value)}
        disabled={busy || disabled}
      >
        <option value="">Pick a diagnosis — fills the usual prescription</option>
        {diagnoses.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
        {diagnosisId != null && !diagnoses.some((d) => d.id === diagnosisId) && diagnoses.length > 0 && (
          <option value={diagnosisId}>(switched off in Admin)</option>
        )}
      </select>
      {busy && <p className="dx-note">Looking up the usual prescription…</p>}
      {!busy && note && (
        <p className="dx-note" data-testid="dx-note">
          <span className={`dx-source ${note.source}`}>{SOURCE_LABEL[note.source] || note.source}</span>
          {note.source === 'none' &&
            'Add the medicines in the prescription — once saved, they start counting towards the usual set.'}
          {note.source !== 'none' &&
            (note.kept
              ? 'Kept the medicines already listed.'
              : `Filled ${plural(note.count, 'medicine')}${
                  note.source === 'history' && note.historyCount
                    ? ` (from ${plural(note.historyCount, 'past prescription')})`
                    : ''
                } — open the prescription to change them.`)}
        </p>
      )}
    </div>
  );
}

export function FollowUpPicker({ visitId, followUpDate, followUpNote, onVisit, disabled }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(followUpNote || '');
  useEffect(() => setNote(followUpNote || ''), [visitId, followUpNote]);

  const presets = followUpPresets();
  const now = new Date();
  const tomorrow = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

  const book = async (date, noteText = note) => {
    if (!date) return;
    setBusy(true);
    try {
      const v = await doctorApi.setFollowUp(visitId, date, noteText.trim());
      onVisit?.(v);
      toast.success('Follow-up booked', `Appointment added for ${fmtFollowUp(date)}`);
    } catch (err) {
      toast.error('Could not book the follow-up', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    setBusy(true);
    try {
      const v = await doctorApi.clearFollowUp(visitId);
      onVisit?.(v);
      setNote('');
    } catch (err) {
      toast.error('Could not remove the follow-up', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fu-picker" id="followUpSection">
      <div className="field-label">Follow-up</div>
      <div className="fu-presets" role="group" aria-label="Come back in">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            className={followUpDate === p.date ? 'active' : ''}
            aria-pressed={followUpDate === p.date}
            onClick={() => book(p.date)}
            disabled={busy || disabled}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="fu-row">
        <input
          type="date"
          className="fake-input fu-date"
          aria-label="Follow-up date"
          min={tomorrow}
          value={followUpDate || ''}
          onChange={(e) => e.target.value && book(e.target.value)}
          disabled={busy || disabled}
        />
        <input
          className="fake-input fu-note"
          placeholder="Note for the appointment (optional)"
          aria-label="Follow-up note"
          maxLength={255}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => followUpDate && note.trim() !== (followUpNote || '') && book(followUpDate)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          disabled={busy || disabled}
        />
      </div>
      <div className="fu-status">
        {followUpDate ? (
          <span data-testid="fu-status">
            Appointment booked for <b>{fmtFollowUp(followUpDate)}</b>
          </span>
        ) : (
          <span className="faint" data-testid="fu-status">
            No follow-up booked
          </span>
        )}
        <button type="button" className="fu-clear" onClick={clear} disabled={!followUpDate || busy || disabled}>
          No follow-up
        </button>
      </div>
    </div>
  );
}
