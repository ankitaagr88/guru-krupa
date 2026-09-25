import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { visits as visitsApi, errorMessage } from '../../api';

/* "Add to today's queue" for a returning patient (search results, the patient page): an optional
   reason for visit, then POST /visits {patientId, note} and the queue opens on their drawer.
   Already in today's queue (409 — another desk was quicker)? It just opens them there.
   Rendered into <body> so it sits above whatever opened it (e.g. the top-bar search list). */
export default function AddToTodayModal({ patient, firstStage = 'reg', onClose, onAdded }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const open = !!patient;

  useEffect(() => {
    if (!open) return undefined;
    setNote('');
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open, patient?.id]);

  if (!open) return null;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true);
    try {
      const v = await visitsApi.create({ patientId: patient.id, note: note.trim() || undefined });
      toast.success(`${patient.name} added to the queue`, v?.token ? `Token ${v.token}` : undefined);
      onAdded?.(v);
      onClose?.();
      navigate(`/queue/${v?.stageKey || v?.stage || firstStage}?patient=${patient.id}`);
    } catch (err) {
      if (err?.response?.status === 409) {
        toast.info(`${patient.name} is already in today's queue`);
        onClose?.();
        navigate(`/queue?patient=${patient.id}`);
      } else {
        toast.error('Could not add to the queue', errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const dialog = (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      id="addToTodayModal"
      title={`Add ${patient.name} to today's queue`}
      sub="A new token is given; they start at the first stage."
    >
      <form onSubmit={submit}>
        <label className="np-label" htmlFor="addTodayNote">
          Reason for visit (optional)
        </label>
        <input
          ref={inputRef}
          id="addTodayNote"
          className="fake-input"
          placeholder="e.g. Follow-up, itching in the right eye"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          autoComplete="off"
        />
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary full" disabled={busy} data-testid="add-today-confirm">
            {busy ? 'Adding…' : "Add to today's queue"}
          </button>
        </div>
      </form>
    </Modal>
  );
  return typeof document !== 'undefined' ? createPortal(dialog, document.body) : dialog;
}
