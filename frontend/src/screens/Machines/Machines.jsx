import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShell, useTopbar } from '../../components/AppShell';
import { useOffline } from '../../offline/OfflineContext';
import { readings as readingsApi, visits as visitsApi, onDataChange, errorMessage } from '../../api';
import InstallPrompt from './InstallPrompt';
import ReadingCard from './ReadingCard';
import ManualEntryForm from './ManualEntryForm';
import ExamPhotos from './ExamPhotos';
import { filterVisits, isBusy, visitRow } from './lib';
import { IconCamera, IconPencil } from '../../components/Icons';
import './machines.css';

const POLL_MS = 2000;

/* ------------------------------------------------------------------ */
/* Patient picker (mockup filterMachinePatients / selectMachinePatient) */
/* ------------------------------------------------------------------ */
function PatientPicker({ rows, query, onQuery, onPick, stages, loading }) {
  const items = filterVisits(rows, query);
  const stageLabel = (key) => stages.find((s) => s.key === key)?.label || key;
  return (
    <>
      <p className="label">Which patient is this reading for?</p>
      <input
        className="fake-input"
        id="machinePatientSearch"
        placeholder="Search by name or token…"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        autoComplete="off"
      />
      <div id="machinePatientList" style={{ marginTop: 8 }}>
        {loading && rows.length === 0 ? (
          <p className="machine-list-empty">Loading today&apos;s patients…</p>
        ) : items.length === 0 ? (
          <p className="machine-list-empty">No matching patients in the clinic right now</p>
        ) : (
          items.map((p) => (
            <button key={p.id} type="button" className="test-opt" onClick={() => onPick(p)}>
              <span>
                {p.name}{' '}
                <span className="machine-patient-meta">
                  {p.token} · {stageLabel(p.stage)}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Capture area (mockup renderMachineCaptureArea / renderMachineOptions) */
/* ------------------------------------------------------------------ */
function CaptureArea({ patient, machines, stages, isMobile, onChangePatient }) {
  const { isOffline, enqueue, flush, onUploaded, listPending, pendingCount } = useOffline();
  const [list, setList] = useState([]);
  const [flash, setFlash] = useState(null); // {spin, text}
  const [manualFor, setManualFor] = useState(null); // machine
  const [pending, setPending] = useState([]);
  const fileRef = useRef(null);
  const captureFor = useRef(null);
  const visitId = patient.id;
  const stageLabel = stages.find((s) => s.key === patient.stage)?.label || patient.stage;

  const upsert = useCallback((r) => {
    if (!r) return;
    setList((cur) => {
      const i = cur.findIndex((x) => x.id === r.id);
      if (i >= 0) {
        const next = cur.slice();
        next[i] = r;
        return next;
      }
      return [...cur, r];
    });
  }, []);

  // Readings already captured for this visit (+ mock-mode refresh on store change).
  useEffect(() => {
    let alive = true;
    const load = () =>
      readingsApi
        .listForVisit(visitId)
        .then((r) => alive && setList(r || []))
        .catch(() => {});
    load();
    const unsub = onDataChange(load);
    return () => {
      alive = false;
      unsub();
    };
  }, [visitId]);

  // Queued (offline) captures for this visit.
  useEffect(() => {
    let alive = true;
    listPending().then((all) => alive && setPending(all.filter((x) => Number(x.visitId) === Number(visitId))));
    return () => {
      alive = false;
    };
  }, [visitId, pendingCount, listPending]);

  // When the sync loop uploads queued captures, drop them into the list.
  useEffect(
    () =>
      onUploaded((uploaded) => {
        uploaded.forEach(({ rec, reading }) => {
          if (Number(rec.visitId) === Number(visitId)) upsert(reading);
        });
      }),
    [onUploaded, upsert, visitId]
  );

  // Poll pending/processing readings every 2s until done/failed (mockup markReadingProcessing).
  const busyIds = list.filter(isBusy).map((r) => r.id);
  const busyKey = busyIds.join(',');
  useEffect(() => {
    if (!busyKey) return undefined;
    const ids = busyKey.split(',').map(Number);
    const t = setInterval(() => {
      ids.forEach((id) =>
        readingsApi
          .get(id)
          .then(upsert)
          .catch(() => {})
      );
    }, POLL_MS);
    return () => clearInterval(t);
  }, [busyKey, upsert]);

  const showFlash = (text, spin = false, ms = 0) => {
    setFlash({ text, spin });
    if (ms) setTimeout(() => setFlash((f) => (f && f.text === text ? null : f)), ms);
  };

  const pickMachine = (m) => {
    if (m.manualOnly) {
      setManualFor(m);
      return;
    }
    captureFor.current = m;
    fileRef.current?.click();
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const m = captureFor.current;
    if (!file || !m) return;
    try {
      showFlash('Photo captured — saving on this device…', true);
      await enqueue({ visitId, machineKey: m.key, blob: file, capturedAt: new Date().toISOString() });
      if (isOffline) {
        showFlash(
          "No connection — photo saved on this device. It will upload and process automatically once you're back online.",
          false,
          2600
        );
        return;
      }
      showFlash('Uploading…', true);
      const res = await flush(true);
      const mine = res?.uploaded?.find((u) => Number(u.rec.visitId) === Number(visitId));
      if (mine) {
        upsert(mine.reading);
        showFlash("Uploaded — you can move on. Values will appear once the server's finished reading it.", false, 2200);
      } else if (res?.dropped?.length) {
        showFlash((res.dropped[0].lastError || 'The server rejected this photo'), false, 4000);
      } else {
        showFlash('Saved on this device — will retry upload shortly.', false, 2600);
      }
    } catch (ex) {
      showFlash(errorMessage(ex, 'Could not save the photo'), false, 4000);
    }
  };

  const latestFor = (key) => {
    const mine = list.filter((r) => r.machineKey === key);
    return mine.length ? mine[mine.length - 1] : null;
  };
  const queuedFor = (key) => pending.some((p) => p.machineKey === key);

  return (
    <div id="machineCaptureArea" style={{ marginTop: 16 }}>
      <div className="summary-card" style={{ marginBottom: 14 }}>
        <div className="summary-card-title">Capturing for</div>
        <div className="summary-line">
          <b>{patient.name}</b> — {patient.token} · currently {stageLabel}
        </div>
      </div>

      <p className="label">Photograph the machine&apos;s printout to scan it in</p>
      {!isMobile && (
        <div className="desktop-capture-note" style={{ marginBottom: 12 }}>
          Use your phone to photograph printouts — open this screen there (or install the app). On desktop you can
          pick an image file below to test the flow.
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        {...(isMobile ? { capture: 'environment' } : {})}
        onChange={onFile}
        style={{ display: 'none' }}
        data-testid="capture-input"
        aria-label="Printout photo"
      />

      <div className="machine-opts" id="machineOptZone">
        {machines.map((m) => {
          const r = latestFor(m.key);
          let tag = null;
          if (queuedFor(m.key)) tag = <span className="done-tag processing">waiting to upload</span>;
          else if (r && isBusy(r)) tag = <span className="done-tag processing">processing…</span>;
          else if (r && r.status === 'failed') tag = <span className="done-tag failed">failed — retake</span>;
          else if (r && r.approved) tag = <span className="done-tag">approved — rescan</span>;
          else if (r) tag = <span className="done-tag processing">captured — check and approve</span>;
          return (
            <button
              key={m.key}
              type="button"
              className="test-opt"
              onClick={() => pickMachine(m)}
              data-testid={`machine-${m.key}`}
            >
              <span className="test-opt-label">
                {m.manualOnly ? <IconPencil /> : <IconCamera />} {m.label}
              </span>
              {tag || (m.manualOnly ? <span className="manual-tag">typed in</span> : null)}
            </button>
          );
        })}
        {machines.length === 0 && <p className="machine-list-empty">Loading machines…</p>}
      </div>
      {machines.some((m) => !m.manualOnly) && !manualFor && (
        <button
          type="button"
          className="machine-type-link"
          onClick={() => setManualFor(machines.find((m) => !m.manualOnly))}
        >
          Printout unreadable? Type the values instead
        </button>
      )}

      {manualFor && (
        <div>
          {machines.length > 1 && (
            <select
              className="drop-select"
              style={{ marginBottom: 8 }}
              value={manualFor.key}
              onChange={(e) => setManualFor(machines.find((m) => m.key === e.target.value))}
              aria-label="Machine for manual entry"
            >
              {machines.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
          <ManualEntryForm
            key={manualFor.key}
            visitId={visitId}
            machine={manualFor}
            onCancel={() => setManualFor(null)}
            onSaved={(r) => {
              upsert(r);
              setManualFor(null);
            }}
          />
        </div>
      )}

      <div id="machineFlashZone">
        {flash && (
          <div className="capture-flash" role="status">
            {flash.spin && <div className="spin" />}
            <p>{flash.text}</p>
          </div>
        )}
      </div>

      {pending.length > 0 && (
        <div className="summary-card pending-card" style={{ marginBottom: 10 }}>
          <div className="summary-card-title">Waiting to upload ({pending.length})</div>
          {pending.map((pc) => (
            <div key={pc.uuid} className="summary-line">
              <span>{machines.find((m) => m.key === pc.machineKey)?.label || pc.machineKey}</span>
              {pc.lastError && <small>retrying · {pc.lastError}</small>}
            </div>
          ))}
        </div>
      )}

      <p className="field-label">Already captured for this patient</p>
      <div id="machineReadingsList">
        {list.length === 0 ? (
          <p className="machine-list-empty">None yet</p>
        ) : (
          list
            .slice()
            .sort((a, b) => String(a.capturedAt || '').localeCompare(String(b.capturedAt || '')))
            .map((r) => (
              <ReadingCard
                key={r.id}
                reading={r}
                machines={machines}
                onChange={upsert}
                onRemove={(gone, created) => {
                  setList((cur) => cur.filter((x) => x.id !== gone.id));
                  if (created) upsert(created);
                }}
              />
            ))
        )}
      </div>

      <ExamPhotos visitId={visitId} isMobile={isMobile} isOffline={isOffline} />

      <button type="button" className="btn-ghost" style={{ marginTop: 14, width: '100%' }} onClick={onChangePatient}>
        Change patient
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Screen                                                               */
/* ------------------------------------------------------------------ */
export default function Machines() {
  const { isMobile, stages } = useShell();
  const { isOffline, simulateOffline, toggleSimulateOffline, pendingCount } = useOffline();
  const [machines, setMachines] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);

  useTopbar({ sub: 'Machines · capture a reading for any patient, any stage' });

  useEffect(() => {
    let alive = true;
    readingsApi
      .machines()
      .then((m) => alive && setMachines(m || []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Today's queue (any stage except done). Mock: refresh on store change; real: poll 30s.
  useEffect(() => {
    let alive = true;
    const load = () =>
      visitsApi
        .today()
        .then((r) => {
          if (!alive) return;
          setRows((r || []).map(visitRow));
          setLoading(false);
        })
        .catch(() => alive && setLoading(false));
    load();
    const unsub = onDataChange(load);
    const t = setInterval(load, 30000);
    return () => {
      alive = false;
      unsub();
      clearInterval(t);
    };
  }, []);

  // Keep the selected row's stage fresh.
  const current = useMemo(() => (selected ? rows.find((r) => r.id === selected.id) || selected : null), [rows, selected]);

  return (
    <div className="appt-wrap machines-wrap" id="machinesWrap">
      <div className="appt-head">
        <h2>Machine readings</h2>
        <div className="machines-head-right">
          <InstallPrompt />
        </div>
      </div>
      <p className="hint" style={{ margin: '-10px 0 12px' }}>
        Capture a machine&apos;s printout for any patient currently in the clinic — not tied to one stage, since tests
        can happen before, during, or after the doctor.
      </p>

      <div id="connectivityBanner">
        {isOffline && (
          <div className="status-pill coral" style={{ marginBottom: 8, display: 'block', width: 'fit-content' }}>
            No connection — photos will save on this device and process automatically once you&apos;re back online
            {pendingCount > 0 ? ` · ${pendingCount} waiting` : ''}
          </div>
        )}
        <button type="button" className="btn-ghost machine-demo-btn" onClick={toggleSimulateOffline} data-testid="offline-toggle">
          {simulateOffline ? 'Demo: back online' : 'Demo: no connection'}
        </button>
      </div>

      {!current ? (
        <PatientPicker
          rows={rows}
          query={query}
          onQuery={setQuery}
          onPick={(p) => {
            setSelected(p);
            setQuery(p.name);
          }}
          stages={stages}
          loading={loading}
        />
      ) : (
        <>
          <p className="label">Which patient is this reading for?</p>
          <input className="fake-input" id="machinePatientSearch" value={current.name} readOnly />
          <CaptureArea
            patient={current}
            machines={machines}
            stages={stages}
            isMobile={isMobile}
            onChangePatient={() => {
              setSelected(null);
              setQuery('');
            }}
          />
        </>
      )}
    </div>
  );
}
