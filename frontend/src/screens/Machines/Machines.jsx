import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useShell, useTopbar } from '../../components/AppShell';
import { useOffline } from '../../offline/OfflineContext';
import { readings as readingsApi, visits as visitsApi, onDataChange, errorMessage, USE_MOCKS } from '../../api';
import InstallPrompt from './InstallPrompt';
import ReadingCard from './ReadingCard';
import ManualEntryForm from './ManualEntryForm';
import ExamPhotos from './ExamPhotos';
import { filterVisits, isBusy, visitRow } from './lib';
import { IconCamera, IconPencil } from '../../components/Icons';
import PatientLink from '../../components/PatientLink';
import './machines.css';

const POLL_MS = 2000;
const MACHINE_KEY = 'gk_machine'; // the machine this device was last used at

/* ------------------------------------------------------------------ */
/* Patient picker (mockup filterMachinePatients / selectMachinePatient) */
/* ------------------------------------------------------------------ */
function PatientPicker({ rows, query, onQuery, onPick, stages, loading, machine }) {
  const items = filterVisits(rows, query);
  const stageLabel = (key) => stages.find((s) => s.key === key)?.label || key;
  return (
    <>
      <p className="label">Which patient is this {machine ? `${machine.label} ` : ''}reading for?</p>
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
/* Machine picker — step 1: every machine, one tap                       */
/* ------------------------------------------------------------------ */
function MachinePicker({ machines, onPick, forPatient }) {
  return (
    <>
      {forPatient && (
        <div className="machine-chosen" data-testid="machine-for-patient">
          <span>
            Reading for <b>{forPatient.name}</b>
            {forPatient.token ? <span className="machine-patient-meta"> · {forPatient.token}</span> : null}
          </span>
        </div>
      )}
      <p className="label">Which machine are you using?</p>
      <div className="machine-opts" id="machineOptZone">
        {machines.map((m) => (
          <button key={m.key} type="button" className="test-opt" onClick={() => onPick(m)} data-testid={`machine-${m.key}`}>
            <span className="test-opt-label">
              {m.manualOnly ? <IconPencil /> : <IconCamera />} {m.label}
            </span>
            {m.manualOnly && <span className="manual-tag">typed in</span>}
          </button>
        ))}
        {machines.length === 0 && <p className="machine-list-empty">Loading machines…</p>}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Capture area (mockup renderMachineCaptureArea / renderMachineOptions) */
/* ------------------------------------------------------------------ */
function CaptureArea({ patient, machine, machines, stages, isMobile, onNextPatient, onChangeMachine }) {
  const { isOffline, enqueue, flush, onUploaded, listPending, pendingCount } = useOffline();
  const [list, setList] = useState([]);
  const [flash, setFlash] = useState(null); // {spin, text}
  // Typed entry: always for a typed-in-only machine; on request when a printout is unreadable.
  const [typing, setTyping] = useState(!!machine.manualOnly);
  const [pending, setPending] = useState([]);
  const fileRef = useRef(null);
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

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const m = machine;
    if (!file) return;
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

  const latest = (() => {
    const mine = list.filter((r) => r.machineKey === machine.key);
    return mine.length ? mine[mine.length - 1] : null;
  })();
  let tag = null;
  if (pending.some((p) => p.machineKey === machine.key))
    tag = <span className="done-tag machine-tag processing">waiting to upload</span>;
  else if (latest && isBusy(latest)) tag = <span className="done-tag machine-tag processing">processing…</span>;
  else if (latest && latest.status === 'failed')
    tag = <span className="done-tag machine-tag failed">failed — retake</span>;
  else if (latest && latest.approved) tag = <span className="done-tag machine-tag">approved</span>;
  else if (latest) tag = <span className="done-tag machine-tag processing">captured — needs approval</span>;

  return (
    <div id="machineCaptureArea" style={{ marginTop: 16 }}>
      <div className="summary-card" style={{ marginBottom: 14 }}>
        <div className="summary-card-title">{isMobile ? 'Capturing' : 'Readings'}</div>
        <div className="summary-line" data-testid="capture-machine">
          <span>Machine</span>
          <b>{machine.label}</b>
        </div>
        <div className="summary-line">
          <span>Patient</span>
          <span>
            <b>
              <PatientLink id={patient.patientId} name={patient.name} />
            </b>{' '}
            — {patient.token} · currently {stageLabel}
          </span>
        </div>
      </div>

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

      {!machine.manualOnly && !typing && (
        <div className="machine-capture-row">
          <button
            type="button"
            className="btn-primary machine-capture-btn"
            onClick={() => fileRef.current?.click()}
            data-testid={isMobile ? 'capture-btn' : 'intake-add'}
          >
            {isMobile && <IconCamera />}
            {isMobile ? 'Photograph the printout' : 'Add printout image'}
          </button>
          {tag}
        </div>
      )}
      {!machine.manualOnly && !typing && (
        <button type="button" className="machine-type-link" onClick={() => setTyping(true)}>
          Printout unreadable? Type the values instead
        </button>
      )}
      {!isMobile && !typing && (
        <p className="hint" style={{ margin: '6px 0 14px' }}>
          Phone photos show up here for approval.
        </p>
      )}

      {typing && (
        <ManualEntryForm
          key={machine.key}
          visitId={visitId}
          machine={machine}
          onCancel={machine.manualOnly ? onNextPatient : () => setTyping(false)}
          onSaved={(r) => {
            upsert(r);
            setTyping(false);
          }}
        />
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

      <p className="field-label">{isMobile ? 'Already captured for this patient (all machines)' : 'Values read for this patient'}</p>
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
                showImage={!isMobile}
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

      <div className="machine-next-row">
        <button type="button" className="btn-primary" onClick={onNextPatient} data-testid="next-patient">
          Next patient on {machine.label}
        </button>
        <button type="button" className="btn-ghost" onClick={onChangeMachine} data-testid="change-machine">
          Change machine
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Screen                                                               */
/* ------------------------------------------------------------------ */
/* /machines?visit=<visitId> (the patient page, the pre-testing drawer): that patient is picked
   straight away — with a remembered machine it goes on to the capture, otherwise it asks the
   machine first and then captures for them. The link is used once; "Next patient" is a free pick. */
export default function Machines() {
  const { isMobile, stages } = useShell();
  const [search, setSearch] = useSearchParams();
  const wantVisit = Number(search.get('visit')) || null;
  const [visitMissing, setVisitMissing] = useState(false);
  const { isOffline, simulateOffline, toggleSimulateOffline, pendingCount } = useOffline();
  const [machines, setMachines] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [machineKey, setMachineKey] = useState(() => {
    try {
      return localStorage.getItem(MACHINE_KEY) || '';
    } catch {
      return '';
    }
  });
  const machine = machines.find((m) => m.key === machineKey) || null;
  const chooseMachine = (key) => {
    setMachineKey(key);
    try {
      if (key) localStorage.setItem(MACHINE_KEY, key);
      else localStorage.removeItem(MACHINE_KEY);
    } catch {
      /* private window: just not remembered */
    }
  };

  useTopbar({
    sub: '',
  });

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

  // ?visit=<id>: preselect that patient once today's list is in, then drop the link.
  useEffect(() => {
    if (!wantVisit || loading) return;
    const row = rows.find((r) => r.id === wantVisit && r.stage !== 'done');
    setVisitMissing(!row);
    if (row) setSelected(row);
    setSearch(
      (s) => {
        const next = new URLSearchParams(s);
        next.delete('visit');
        return next;
      },
      { replace: true }
    );
  }, [wantVisit, loading, rows, setSearch]);

  // Keep the selected row's stage fresh.
  const current = useMemo(() => (selected ? rows.find((r) => r.id === selected.id) || selected : null), [rows, selected]);

  return (
    <div className="appt-wrap machines-wrap" id="machinesWrap">
      {isMobile && (
        <div className="machines-head-right" style={{ marginBottom: 10 }}>
          <InstallPrompt />
        </div>
      )}

      <div id="connectivityBanner" style={isMobile ? undefined : { display: 'none' }}>
        {isOffline && (
          <div className="status-pill coral" style={{ marginBottom: 8, display: 'block', width: 'fit-content' }}>
            No connection — photos will save on this device and process automatically once you&apos;re back online
            {pendingCount > 0 ? ` · ${pendingCount} waiting` : ''}
          </div>
        )}
        {USE_MOCKS && (
          <button type="button" className="machine-demo-link" onClick={toggleSimulateOffline} data-testid="offline-toggle">
            {simulateOffline ? 'Demo only: back online' : 'Demo only: try without a connection'}
          </button>
        )}
      </div>

      {visitMissing && (
        <p className="hint" role="status" data-testid="machine-visit-missing">
          Not in today&apos;s queue — pick the patient.
        </p>
      )}

      {!machine ? (
        <MachinePicker machines={machines} onPick={(m) => chooseMachine(m.key)} forPatient={current} />
      ) : !current ? (
        <>
          <div className="machine-chosen" data-testid="machine-chosen">
            <span>
              Machine: <b>{machine.label}</b>
            </span>
            <button type="button" className="link-btn" onClick={() => chooseMachine('')} data-testid="change-machine">
              Change machine
            </button>
          </div>
          <PatientPicker
            rows={rows}
            query={query}
            onQuery={setQuery}
            onPick={(p) => {
              setSelected(p);
              setQuery('');
            }}
            stages={stages}
            loading={loading}
            machine={machine}
          />
        </>
      ) : (
        <CaptureArea
          key={`${machine.key}-${current.id}`}
          patient={current}
          machine={machine}
          machines={machines}
          stages={stages}
          isMobile={isMobile}
          onNextPatient={() => setSelected(null)}
          onChangeMachine={() => {
            setSelected(null);
            chooseMachine('');
          }}
        />
      )}
    </div>
  );
}
