import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTopbar } from '../../components/AppShell';
import DateStrip, { fmtDateLabel } from '../../components/DateStrip';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { appointments as api, onDataChange, errorMessage } from '../../api';
import { dateStr } from '../../mocks/data';
import { CHANNEL_LABEL } from '../Queue/queueModel';
import { IconPencil } from '../../components/Icons';
import PatientLink from '../../components/PatientLink';
import './appointments.css';

const CHANNELS = ['whatsapp', 'call', 'walkin'];

/* Appointments (F4): day strip with counts, per-day list, add / edit / delete
   modal (name, phone, date, channel — no time slots) and check-in, which
   registers today's visit and jumps to the queue with the drawer open. */
export default function Appointments() {
  const navigate = useNavigate();
  const toast = useToast();
  const [date, setDate] = useState(dateStr(0));
  const [counts, setCounts] = useState({});
  const [rows, setRows] = useState([]);
  const [modal, setModal] = useState(null); // null | { id?, name, phone, date, channel }
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .counts({ from: dateStr(-1), to: dateStr(6) })
      .then((c) => {
        // B4 contract: {date: {total, checkedIn}}; tolerate plain numbers too.
        const out = {};
        Object.entries(c || {}).forEach(([d, v]) => {
          out[d] = typeof v === 'number' ? v : Number(v?.total || 0);
        });
        setCounts(out);
      })
      .catch(() => {});
    api
      .list({ date })
      .then((r) => setRows(r || []))
      .catch(() => {});
  }, [date]);

  useEffect(() => {
    load();
    return onDataChange(load);
  }, [load]);

  const openNew = () => setModal({ name: '', phone: '', date, channel: 'whatsapp' });
  const openEdit = (a) =>
    setModal({ id: a.id, name: a.name, phone: a.phone || '', date: a.date, channel: a.channel });

  const save = async () => {
    const name = modal.name.trim();
    if (!name) {
      setModal((m) => ({ ...m, error: 'Add at least a name.' }));
      return;
    }
    setBusy(true);
    try {
      const body = { name, phone: modal.phone.trim(), date: modal.date, channel: modal.channel };
      if (modal.id) await api.update(modal.id, body);
      else await api.create(body);
      setModal(null);
      if (modal.date !== date) setDate(modal.date);
      else load();
    } catch (err) {
      toast.error('Could not save appointment', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a) => {
    if (!window.confirm(`Remove ${a.name}'s appointment?`)) return;
    try {
      await api.remove(a.id);
      load();
    } catch (err) {
      toast.error('Could not remove', errorMessage(err));
    }
  };

  const checkIn = async (a) => {
    if (a.checkedIn) return;
    setBusy(true);
    try {
      const res = await api.checkin(a.id);
      const visit = res?.visit;
      const pid = visit?.patientId ?? visit?.patient?.id ?? res?.appointment?.patientId ?? visit?.id;
      toast.success(`${a.name} checked in`, visit?.token ? `Token ${visit.token}` : undefined);
      load();
      navigate(pid ? `/queue/reg?patient=${pid}` : '/queue/reg');
    } catch (err) {
      toast.error('Could not check in', errorMessage(err));
      load();
    } finally {
      setBusy(false);
    }
  };

  const actions = useMemo(
    () => (
      <button className="btn-primary" id="newApptBtn" onClick={openNew}>
        + New appointment
      </button>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [date]
  );
  useTopbar({ sub: 'Appointments · booked via WhatsApp, call, or walk-in', actions });

  return (
    <div className="appt-wrap">
      <div className="appt-head">
        <h2 id="apptHeading">{fmtDateLabel(date, true)}</h2>
      </div>
      <p className="hint" style={{ margin: '-10px 0 16px' }}>
        No fixed time slots — this is just who&apos;s told us they&apos;re coming on a given day. Patients are
        seen in the order they arrive.
      </p>
      <DateStrip value={date} onChange={setDate} counts={counts} />
      <table className="data-table appt-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th>Channel</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="apptList">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="empty-slot">
                No one has let us know they are coming this day yet
              </td>
            </tr>
          ) : (
            rows.map((a) => (
              <tr key={a.id} data-testid={`appt-row-${a.id}`} style={{ cursor: 'default' }}>
                <td className="td-name">
                  <PatientLink id={a.patientId} name={a.name} />
                </td>
                <td data-label="Phone">{a.phone || '—'}</td>
                <td data-label="Channel">
                  <span className={`channel-tag ${a.channel}`}>{CHANNEL_LABEL[a.channel] || a.channel}</span>
                </td>
                <td className="no-label appt-actions">
                  <button
                    type="button"
                    className="appt-icon-btn"
                    onClick={() => openEdit(a)}
                    aria-label={`Edit ${a.name}`}
                    title="Edit"
                    disabled={a.checkedIn}
                  >
                    <IconPencil />
                  </button>
                  <button
                    type="button"
                    className="appt-icon-btn"
                    onClick={() => remove(a)}
                    aria-label={`Delete ${a.name}`}
                    title="Delete"
                  >
                    ✕
                  </button>
                  <button
                    type="button"
                    className={`appt-checkin${a.checkedIn ? ' done' : ''}`}
                    onClick={() => checkIn(a)}
                    disabled={a.checkedIn || busy}
                  >
                    {a.checkedIn ? 'Checked in' : 'Check in'}
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        id="apptModalOverlay"
        title={modal?.id ? 'Edit appointment' : 'New appointment'}
        sub="No fixed time slot — just noting them down for a day. Channel is just for the record."
        actions={
          <>
            <button className="btn-ghost" type="button" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button className="btn-primary full" type="button" onClick={save} disabled={busy} id="apptSubmit">
              {modal?.id ? 'Save changes' : 'Book appointment'}
            </button>
          </>
        }
      >
        {modal && (
          <>
            <input
              className={`fake-input${modal.error ? ' error' : ''}`}
              id="apptName"
              placeholder="Patient name"
              value={modal.name}
              onChange={(e) => setModal((m) => ({ ...m, name: e.target.value, error: '' }))}
              autoFocus
            />
            {modal.error && (
              <p className="hint" style={{ color: 'var(--alert-ink)', margin: '-4px 0 8px' }}>
                {modal.error}
              </p>
            )}
            <input
              className="fake-input"
              id="apptPhone"
              placeholder="Phone number"
              value={modal.phone}
              onChange={(e) => setModal((m) => ({ ...m, phone: e.target.value }))}
              inputMode="tel"
            />
            <p className="label" style={{ marginBottom: 6 }}>
              Day
            </p>
            <input
              className="fake-input"
              id="apptDate"
              type="date"
              value={modal.date}
              onChange={(e) => setModal((m) => ({ ...m, date: e.target.value || m.date }))}
            />
            <p className="label" style={{ marginBottom: 6 }}>
              Booked via
            </p>
            <div className="channel-toggle" id="apptChannelToggle">
              {CHANNELS.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  className={`channel-opt ${ch}${modal.channel === ch ? ' active' : ''}`}
                  data-channel={ch}
                  onClick={() => setModal((m) => ({ ...m, channel: ch }))}
                >
                  {CHANNEL_LABEL[ch]}
                </button>
              ))}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
