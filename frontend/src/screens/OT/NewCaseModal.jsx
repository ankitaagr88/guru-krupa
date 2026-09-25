import { useEffect, useState } from 'react';
import Modal from '../../components/Modal';
import { ot as otApi, patients as patientsApi, errorMessage } from '../../api';
import { ageSex } from '../../lib/format';
import { OT_PROCEDURES, slotMinutes } from './constants';
import { config as configApi } from '../../api';

/* Slot picker: every slot the backend offers for the day, booked ones greyed
   with the patient's name (GET /ot/slots?date=). */
export function SlotPicker({ slots, value, onChange, loading }) {
  if (loading && slots.length === 0) return <p className="ot-save-note">Loading slots…</p>;
  return (
    <div className="slot-grid" role="radiogroup" aria-label="Time slot">
      {slots
        .slice()
        .sort((a, b) => slotMinutes(a.timeSlot) - slotMinutes(b.timeSlot))
        .map((s) => {
          const booked = s.caseId != null;
          const active = value === s.timeSlot;
          return (
            <button
              key={s.timeSlot}
              type="button"
              role="radio"
              aria-checked={active}
              className={`slot-btn${booked ? ' booked' : ''}${active ? ' active' : ''}`}
              disabled={booked}
              onClick={() => onChange(s.timeSlot)}
              title={booked ? `Booked — ${s.patientName || ''}` : 'Free'}
            >
              {s.timeSlot}
              <small>{booked ? s.patientName || 'Booked' : 'free'}</small>
            </button>
          );
        })}
    </div>
  );
}

/* Mockup `openOtModal` / `addOtCase`, extended: pick an existing patient by
   search or type name/age/sex, then a free slot and the procedure. A 409 from
   the server (slot taken meanwhile) is shown inline and the slots reload.
   `presetPatient` (from /ot?patient=<id>) opens it with that patient already picked. */
export default function NewCaseModal({ open, date: initialDate, onClose, onCreated, presetPatient = null }) {
  const [date, setDate] = useState(initialDate);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [patient, setPatient] = useState(null);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState('');
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [timeSlot, setTimeSlot] = useState('');
  const [procedures, setProcedures] = useState(OT_PROCEDURES);
  const [procedure, setProcedure] = useState(OT_PROCEDURES[0]);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(initialDate);
    setQ('');
    setResults([]);
    setPatient(presetPatient || null);
    setName('');
    setAge('');
    setSex('');
    setTimeSlot('');
    setErr('');
    // Procedure list is admin-configurable (Admin → OT slots & procedures); fall back to the built-ins.
    let cancelled = false;
    configApi
      .get()
      .then((cfg) => {
        if (cancelled) return;
        const list = Array.isArray(cfg?.otProcedures) && cfg.otProcedures.length ? cfg.otProcedures : OT_PROCEDURES;
        setProcedures(list);
        setProcedure(list[0]);
      })
      .catch(() => {
        setProcedures(OT_PROCEDURES);
        setProcedure(OT_PROCEDURES[0]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, initialDate, presetPatient]);

  const loadSlots = (ds) => {
    setSlotsLoading(true);
    return otApi
      .slots(ds)
      .then((s) => setSlots(s || []))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  };
  useEffect(() => {
    if (open && date) loadSlots(date);
  }, [open, date]);

  // Patient search (debounced)
  useEffect(() => {
    if (!open || patient) return undefined;
    const query = q.trim();
    if (!query) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const rows = await patientsApi.list({ q: query });
        if (!cancelled) setResults((rows || []).slice(0, 6));
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open, patient]);

  const submit = async () => {
    setErr('');
    if (!patient && !name.trim()) return setErr('Pick a patient or type a name.');
    if (!timeSlot) return setErr('Pick a time slot.');
    const body = patient
      ? { patientId: patient.id, date, timeSlot, procedure }
      : { patientName: name.trim(), age: age === '' ? null : Number(age), sex: sex || null, date, timeSlot, procedure };
    setSaving(true);
    try {
      const created = await otApi.create(body);
      onCreated?.(created);
    } catch (ex) {
      const status = ex?.response?.status;
      setErr(status === 409 ? `${errorMessage(ex)} — pick another slot.` : errorMessage(ex, 'Could not schedule'));
      if (status === 409) loadSlots(date);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Schedule surgery"
      sub="A real time slot — this blocks OT time, unlike routine OPD visits."
      onClose={onClose}
      className="ot-modal"
      actions={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary full" onClick={submit} disabled={saving}>
            {saving ? 'Scheduling…' : 'Schedule'}
          </button>
        </>
      }
    >
      <p className="label">Patient</p>
      {patient ? (
        <div className="ot-patient-chip" data-testid="ot-picked-patient">
          <span>
            <b>{patient.name}</b> · {ageSex(patient)}
            {patient.phone ? ` · ${patient.phone}` : ''}
          </span>
          <button type="button" onClick={() => setPatient(null)} aria-label="Change patient">
            ✕
          </button>
        </div>
      ) : (
        <>
          <input
            className="fake-input"
            placeholder="Search existing patients by name / phone…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search patients"
          />
          {results.length > 0 && (
            <div className="ot-patient-results">
              {results.map((p) => (
                <button key={p.id} type="button" onClick={() => setPatient(p)}>
                  <span>{p.name}</span>
                  <span className="meta">
                    {ageSex(p)}
                    {p.phone ? ` · ${p.phone}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="ot-or">— or a new patient —</p>
          <div className="ot-manual-grid">
            <input
              className="fake-input"
              id="otPatientName"
              placeholder="Patient name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Patient name"
            />
            <input
              className="fake-input"
              placeholder="Age"
              inputMode="numeric"
              value={age}
              onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, ''))}
              aria-label="Age"
            />
            <select className="drop-select" value={sex} onChange={(e) => setSex(e.target.value)} aria-label="Sex">
              <option value="">Sex…</option>
              <option value="F">F</option>
              <option value="M">M</option>
              <option value="O">Other</option>
            </select>
          </div>
        </>
      )}

      <p className="label">Date</p>
      <input
        className="fake-input"
        type="date"
        value={date}
        onChange={(e) => {
          setDate(e.target.value);
          setTimeSlot('');
        }}
        aria-label="Surgery date"
      />

      <p className="label">Time slot</p>
      <SlotPicker slots={slots} value={timeSlot} onChange={setTimeSlot} loading={slotsLoading} />

      <p className="label">Procedure</p>
      <select
        className="drop-select"
        id="otProcedureSelect"
        value={procedure}
        onChange={(e) => setProcedure(e.target.value)}
        aria-label="Procedure"
      >
        {procedures.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>

      {err && (
        <div className="ot-error" role="alert" style={{ marginTop: 10 }}>
          {err}
        </div>
      )}
    </Modal>
  );
}
