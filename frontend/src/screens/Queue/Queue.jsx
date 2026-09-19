import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useShell, useTopbar } from '../../components/AppShell';
import PatientCard, { QueueRow } from '../../components/PatientCard';
import Drawer from '../../components/Drawer';
import { visits, onDataChange } from '../../api';
import { ageSex } from '../../lib/format';

/* Placeholder queue board (F2 — Agent 2 replaces this). It already:
   - reads /queue/:stage (defaults to the first stage)
   - renders the stage pills, desktop table (#boardTable) and mobile cards (#boardCards)
   - honours ?patient=<id> from SearchModal.jumpToPatient by opening the drawer */
export default function Queue() {
  const { stage: stageParam } = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const { stages, stageCounts } = useShell();
  const stage = stages.find((s) => s.key === stageParam) || stages[0];
  const [rows, setRows] = useState([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    const load = () =>
      visits
        .today({ stage: stage?.key })
        .then((r) => alive && setRows(r || []))
        .catch(() => {});
    load();
    const unsub = onDataChange(load);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      unsub();
      clearInterval(t);
    };
  }, [stage?.key]);

  useEffect(() => {
    if (stageParam && stages.length && !stages.some((s) => s.key === stageParam))
      navigate('/queue', { replace: true });
  }, [stageParam, stages, navigate]);

  const selectedId = Number(search.get('patient')) || null;
  const selected = rows.find((p) => p.id === selectedId) || null;
  const count = rows.length;

  useTopbar({
    sub: stage ? `${stage.label} · ${count} ${count === 1 ? 'patient' : 'patients'}` : 'Queue',
    actions: (
      <button
        className="btn-primary"
        id="newPatientBtn"
        onClick={() => alert('New-patient modal — Agent 2 (F2)')}
      >
        + New patient
      </button>
    ),
  });

  const open = (p) => setSearch({ patient: String(p.id) });
  const close = () => setSearch({});

  return (
    <div className="board-wrap" id="boardWrap">
      <div className="stage-summary" id="stageSummary">
        {stages.map((s) => (
          <div
            key={s.key}
            className={`pill${s.key === stage?.key ? ' active' : ''}`}
            onClick={() => navigate(`/queue/${s.key}`)}
          >
            {s.label} <b>{stageCounts[s.key] ?? 0}</b>
          </div>
        ))}
      </div>
      <table className="data-table" id="boardTable">
        <thead>
          <tr>
            <th>Token</th>
            <th>Name</th>
            <th>Age/Sex</th>
            <th>Phone</th>
            <th>Waiting</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="board">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="empty-slot">
                No patients at this stage right now
              </td>
            </tr>
          ) : (
            rows.map((p) => (
              <QueueRow
                key={p.id}
                patient={p}
                stage={stage?.key}
                selected={p.id === selectedId}
                onClick={open}
                now={now}
              />
            ))
          )}
        </tbody>
      </table>
      <div className="patient-cards" id="boardCards">
        {rows.length === 0 ? (
          <div className="empty-slot">No patients at this stage right now</div>
        ) : (
          rows.map((p) => (
            <PatientCard
              key={p.id}
              patient={p}
              stage={stage?.key}
              selected={p.id === selectedId}
              onClick={open}
              now={now}
            />
          ))
        )}
      </div>
      <p className="hint" style={{ marginTop: 18 }}>
        Queue board placeholder — full drawer, new-patient modal, dilation and billing panels are owned by
        Agent 2 (F2/F3).
      </p>

      <Drawer
        open={!!selected}
        name={selected?.name}
        meta={selected ? `${selected.token} · ${ageSex(selected)} · ${stage?.label}` : ''}
        onClose={close}
        foot="Everything here saves on its own — nothing to submit."
      >
        {selected && (
          <>
            <div className="field-label">Patient details</div>
            <div className="summary-card">
              <div className="summary-card-title">Summary</div>
              <div className="summary-line">
                <b>Phone</b> {selected.phone || '—'}
              </div>
              <div className="summary-line">
                <b>Address</b> {selected.address || '—'}
              </div>
              <div className="summary-line">
                <b>Note</b> {selected.note || '—'}
              </div>
            </div>
            <div className="field-label">Move patient</div>
            <div className="stage-buttons" id="stageButtons">
              {stages
                .filter((s) => s.key !== stage?.key)
                .map((s) => (
                  <button
                    key={s.key}
                    className="stage-btn"
                    onClick={() =>
                      visits
                        .move(selected.id, s.key)
                        .then(() => navigate(`/queue/${s.key}?patient=${selected.id}`))
                    }
                  >
                    <span>→ {s.label}</span>
                  </button>
                ))}
            </div>
            <p className="hint" style={{ marginTop: 16 }}>
              Full patient drawer — Agent 2 (F2).
            </p>
          </>
        )}
      </Drawer>
    </div>
  );
}
