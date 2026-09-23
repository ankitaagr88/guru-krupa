import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useShell, useTopbar } from '../../components/AppShell';
import PatientCard, { QueueRow } from '../../components/PatientCard';
import Drawer from '../../components/Drawer';
import { useToast } from '../../components/Toast';
import { patients as patientsApi, visits as visitsApi, onDataChange, errorMessage } from '../../api';
import { ageSex, fmtLastVisit } from '../../lib/format';
import useConfig from './useConfig';
import PatientDrawer from './PatientDrawer';
import NewPatientModal from './NewPatientModal';
import { normalizeVisit, normalizeVisits, stepRemaining } from './queueModel';
import './queue.css';

const POLL_MS = 15000;
const CONFIRM_OVERRIDE = "The dilation wait isn't finished yet. Send this patient back to the doctor anyway?";

/* Queue board (F2/F3): /queue/:stage. Desktop table + mobile cards, 1 s waiting
   ticker, drawer for the selected patient (?patient=<patientId>, shared with
   SearchModal), new-patient modal, dilation timers (checkTimers) and the
   refresh strategy: poll visits.today every 15 s while visible + reload after
   every mutation + onDataChange (mock mode). */
export default function Queue() {
  const { stage: stageParam } = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const { stages, stageCounts, refreshCounts } = useShell();
  const toast = useToast();
  const config = useConfig();
  const stage = stages.find((s) => s.key === stageParam) || stages[0];

  const [all, setAll] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [refreshKey, setRefreshKey] = useState(0);
  const [npOpen, setNpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState(null); // patient with no visit today (deep link)
  const alerted = useRef(new Set());

  /* ---------- data ---------- */
  const load = useCallback(async ({ bump = false } = {}) => {
    try {
      const list = await visitsApi.today();
      setAll(normalizeVisits(list));
      setLoaded(true);
      if (bump) setRefreshKey((k) => k + 1);
    } catch {
      /* keep the last good board; the next poll retries */
    }
  }, []);

  useEffect(() => {
    load();
    const unsub = onDataChange(() => load({ bump: true }));
    const visible = () => document.visibilityState !== 'hidden';
    const poll = setInterval(() => visible() && load(), POLL_MS);
    const onVis = () => visible() && load();
    document.addEventListener('visibilitychange', onVis);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      unsub();
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  const afterMutation = useCallback(async () => {
    await load({ bump: true });
    refreshCounts?.();
  }, [load, refreshCounts]);

  useEffect(() => {
    if (stageParam && stages.length && !stages.some((s) => s.key === stageParam))
      navigate('/queue', { replace: true });
  }, [stageParam, stages, navigate]);

  /* ---------- derived ---------- */
  const rows = useMemo(() => all.filter((r) => r.stage === stage?.key), [all, stage?.key]);
  const counts = useMemo(() => {
    if (!loaded) return stageCounts || {};
    const c = {};
    all.forEach((r) => {
      c[r.stage] = (c[r.stage] || 0) + 1;
    });
    return c;
  }, [all, loaded, stageCounts]);

  const selectedPid = Number(search.get('patient')) || null;
  const selected = useMemo(
    () => (selectedPid ? all.find((r) => r.patientId === selectedPid) || null : null),
    [all, selectedPid]
  );

  // Deep link to a patient who has no visit today (search → returning patient).
  useEffect(() => {
    if (!loaded || !selectedPid || selected) {
      setFallback(null);
      return;
    }
    let alive = true;
    patientsApi
      .get(selectedPid)
      .then((p) => alive && setFallback(p))
      .catch(() => alive && setFallback(null));
    return () => {
      alive = false;
    };
  }, [loaded, selectedPid, selected]);

  /* ---------- dilation timers (mockup checkTimers) ---------- */
  useEffect(() => {
    all.forEach((row) => {
      if (row.stage !== 'dilate' || !row.dilation) return;
      const idx = row.dilation.currentIndex;
      const step = row.dilation.steps[idx];
      if (!step || !step.given || step.done) return;
      const remaining = stepRemaining(row.dilation, now);
      if (remaining == null || remaining > 0) return;
      const key = `${row.id}-${idx}-${step.startedAt}`;
      if (alerted.current.has(key)) return;
      alerted.current.add(key);
      const next = row.dilation.steps[idx + 1];
      toast.dilationDue(row, next ? `Give ${next.name} next.` : 'All drops given — ready for the doctor.');
      visitsApi
        .dilationStepDone(row.id, idx)
        .catch(() => {}) // another device may already have advanced it
        .then(() => load({ bump: true }));
    });
  }, [now, all, load, toast]);

  /* ---------- actions ---------- */
  const open = (p) => setSearch({ patient: String(p.patientId ?? p.id) });
  const close = useCallback(() => setSearch({}), [setSearch]);

  const run = async (fn, { closeDrawer = true } = {}) => {
    setBusy(true);
    try {
      await fn();
      if (closeDrawer) close();
      await afterMutation();
    } catch (err) {
      toast.error('Could not update', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const moveTo = (stageKey, { confirm = false } = {}) => {
    if (!selected) return;
    if (confirm && !window.confirm(CONFIRM_OVERRIDE)) return;
    const call =
      stageKey === 'done'
        ? () => visitsApi.complete(selected.id)
        : () => visitsApi.move(selected.id, stageKey);
    run(call);
  };
  const complete = () => selected && run(() => visitsApi.complete(selected.id));
  const startDilation = () => {
    if (!selected) return;
    if (config.protocolSteps.length === 0) {
      toast.error('No dilation protocol', 'Add at least one step to the dilation protocol in Admin first.');
      return;
    }
    run(() => visitsApi.startDilation(selected.id));
  };
  const stepGiven = (i) =>
    selected && run(() => visitsApi.dilationStepGiven(selected.id, i), { closeDrawer: false });

  const addNewPatient = async (body) => {
    setBusy(true);
    try {
      const p = await patientsApi.create(body);
      let visit = null;
      try {
        visit = await visitsApi.create({
          patientId: p.id,
          note: body.note || undefined,
          elsewhere: body.elsewhere,
          elsewhereNote: body.elsewhereNote,
        });
      } catch (err) {
        if (err?.response?.status !== 409) throw err;
      }
      const token = visit?.token || p.token;
      toast.success(`${p.name} added to the queue`, token ? `Token ${token}` : undefined);
      setNpOpen(false);
      navigate(`/queue/${stages[0]?.key || 'reg'}`);
      await afterMutation();
    } catch (err) {
      toast.error('Could not add patient', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const registerFallback = () => {
    if (!fallback) return;
    run(
      async () => {
        const v = await visitsApi.create({ patientId: fallback.id });
        toast.success(`${fallback.name} added to the queue`, v?.token ? `Token ${v.token}` : undefined);
        navigate(`/queue/${stages[0]?.key || 'reg'}?patient=${fallback.id}`);
      },
      { closeDrawer: false }
    );
  };

  /* ---------- topbar ---------- */
  const count = rows.length;
  const actions = useMemo(
    () => (
      <button className="btn-primary" id="newPatientBtn" onClick={() => setNpOpen(true)}>
        + New patient
      </button>
    ),
    []
  );
  useTopbar({
    sub: stage ? `${stage.label} · ${count} ${count === 1 ? 'patient' : 'patients'}` : 'Queue',
    actions,
  });

  const fallbackRow =
    fallback && !selected ? normalizeVisit({ ...fallback, id: fallback.visitId ?? fallback.id }) : null;

  return (
    <div className="board-wrap" id="boardWrap">
      <div className="stage-summary" id="stageSummary">
        {stages.map((s) => (
          <div
            key={s.key}
            className={`pill${s.key === stage?.key ? ' active' : ''}`}
            onClick={() => navigate(`/queue/${s.key}`)}
            role="tab"
            aria-selected={s.key === stage?.key}
            data-testid={`stage-pill-${s.key}`}
          >
            {s.label} <b>{counts[s.key] ?? 0}</b>
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
                {loaded ? 'No patients at this stage right now' : 'Loading…'}
              </td>
            </tr>
          ) : (
            rows.map((p) => (
              <QueueRow
                key={p.id}
                patient={p}
                stage={stage?.key}
                selected={p.patientId === selectedPid}
                onClick={open}
                now={now}
              />
            ))
          )}
        </tbody>
      </table>
      <div className="patient-cards" id="boardCards">
        {rows.length === 0 ? (
          <div className="empty-slot">{loaded ? 'No patients at this stage right now' : 'Loading…'}</div>
        ) : (
          rows.map((p) => (
            <PatientCard
              key={p.id}
              patient={p}
              stage={stage?.key}
              selected={p.patientId === selectedPid}
              onClick={open}
              now={now}
            />
          ))
        )}
      </div>

      <PatientDrawer
        open={!!selected}
        row={selected}
        stages={stages}
        config={config}
        now={now}
        refreshKey={refreshKey}
        onClose={close}
        onMove={moveTo}
        onStartDilation={startDilation}
        onComplete={complete}
        onStepGiven={stepGiven}
        busy={busy}
      />

      {/* Returning patient with no visit today (from search): offer to register one. */}
      {!selected && (
        <Drawer
          open={!!fallbackRow}
          id="drawer-noVisit"
          name={fallbackRow?.name}
          meta={fallbackRow ? `${ageSex(fallbackRow)} · no visit today` : ''}
          onClose={close}
        >
          {fallbackRow && (
            <>
              <div className="summary-card">
                <div className="summary-card-title">Patient</div>
                <div className="summary-line">
                  <b>Phone:</b> {fallbackRow.phone || '—'}
                </div>
                <div className="summary-line">
                  <b>Address:</b> {fallbackRow.address || '—'}
                </div>
                <div className="summary-line">
                  <b>Last visit:</b> {fmtLastVisit(fallbackRow.lastVisitDate)}
                </div>
              </div>
              <div className="field-label">Register</div>
              <div className="stage-buttons">
                <button className="stage-btn amber" onClick={registerFallback} disabled={busy}>
                  Add to today&apos;s queue{' '}
                  <small>new token, starts at {stages[0]?.label || 'Registration'}</small>
                </button>
              </div>
            </>
          )}
        </Drawer>
      )}

      <NewPatientModal
        open={npOpen}
        onClose={() => setNpOpen(false)}
        onSubmit={addNewPatient}
        onRegistered={afterMutation}
        config={config}
        busy={busy}
      />
    </div>
  );
}
