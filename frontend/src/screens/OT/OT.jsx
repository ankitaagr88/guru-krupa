import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShell, useTopbar } from '../../components/AppShell';
import DateStrip, { fmtDateLabel } from '../../components/DateStrip';
import { ot as otApi, onDataChange } from '../../api';
import { dateStr } from '../../mocks/data';
import NewCaseModal from './NewCaseModal';
import CaseDrawer from './CaseDrawer';
import { OT_STATUS, caseSlot, slotMinutes } from './constants';
import './ot.css';

const STRIP_FROM = -3;
const STRIP_TO = 7;

/* OT / Surgery (F6). Mockup renderOT / buildOtDateStrip / selectOtDate /
   renderOtList / openOtCase — date strip with per-day counts, the day's cases
   with real time slots, the schedule modal and the case drawer. */
export default function OT() {
  const { isMobile } = useShell();
  const [date, setDate] = useState(dateStr(0));
  const [cases, setCases] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [lensTiers, setLensTiers] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [current, setCurrent] = useState(null); // the open case (drawer)

  const loadCounts = useCallback(
    () =>
      otApi
        .counts({ from: dateStr(STRIP_FROM), to: dateStr(STRIP_TO) })
        .then((c) => setCounts(c || {}))
        .catch(() => {}),
    []
  );
  const loadCases = useCallback(
    (ds) =>
      otApi
        .cases({ date: ds })
        .then((rows) => {
          setCases(rows || []);
          setLoading(false);
        })
        .catch(() => setLoading(false)),
    []
  );

  useEffect(() => {
    otApi
      .lensTiers()
      .then((t) => setLensTiers(t || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const load = () => {
      if (!alive) return;
      loadCases(date);
      loadCounts();
    };
    load();
    const unsub = onDataChange(load);
    const t = setInterval(load, 60000);
    return () => {
      alive = false;
      unsub();
      clearInterval(t);
    };
  }, [date, loadCases, loadCounts]);

  const actions = useMemo(
    () => (
      <button type="button" className="btn-primary" id="otScheduleBtn" onClick={() => setModalOpen(true)}>
        + Schedule surgery
      </button>
    ),
    []
  );
  useTopbar({ sub: 'OT · surgery scheduling and operative records', actions });

  const sorted = useMemo(
    () => cases.slice().sort((a, b) => slotMinutes(caseSlot(a)) - slotMinutes(caseSlot(b))),
    [cases]
  );

  const openCase = async (k) => {
    setCurrent(k);
    try {
      const fresh = await otApi.get(k.id);
      setCurrent((cur) => (cur && cur.id === fresh.id ? fresh : cur));
    } catch {
      /* keep the list copy */
    }
  };

  // Drawer edits update the open case and mirror into the list row.
  const setCase = useCallback((next) => {
    setCurrent((prev) => {
      const val = typeof next === 'function' ? next(prev) : next;
      if (val) setCases((rows) => rows.map((r) => (r.id === val.id ? val : r)));
      return val;
    });
  }, []);

  const onCaseChanged = (updated) => {
    if (!updated) return;
    setCases((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
    loadCounts();
  };

  return (
    <div className="appt-wrap ot-wrap" id="otWrap">
      <div className="appt-head">
        <h2 id="otHeading">{fmtDateLabel(date, true)}</h2>
      </div>
      <p className="hint" style={{ margin: '-10px 0 16px' }}>
        Real time slots — surgery needs advance prep (fasting, OT staff, anesthesia), unlike the rest of the app&apos;s
        walk-in-order flow.
      </p>

      <DateStrip value={date} onChange={setDate} counts={counts} from={STRIP_FROM} to={STRIP_TO} />

      <table className="data-table" id="otTable">
        <thead>
          <tr>
            <th>Patient</th>
            <th>Time</th>
            <th>Procedure</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="otList">
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={5} className="empty-slot">
                {loading ? 'Loading…' : 'No surgeries scheduled this day'}
              </td>
            </tr>
          ) : (
            sorted.map((k) => {
              const st = OT_STATUS[k.status] || { label: k.status, cls: '' };
              return (
                <tr key={k.id} onClick={() => openCase(k)} data-testid={`ot-row-${k.id}`}>
                  <td className="td-name">
                    {k.patientName}
                    {k.age ? <span className="ot-td-sub"> · {k.age}{k.sex ? k.sex[0] : ''}</span> : null}
                  </td>
                  <td data-label="Time" className="ot-td-slot">
                    {caseSlot(k)}
                  </td>
                  <td data-label="Procedure">{k.procedure}</td>
                  <td data-label="Status">
                    <span className={`status-pill ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="no-label">
                    <button
                      type="button"
                      className="rx-open-btn ot-open-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        openCase(k);
                      }}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      <NewCaseModal
        open={modalOpen}
        date={date}
        onClose={() => setModalOpen(false)}
        onCreated={(created) => {
          setModalOpen(false);
          if (created.date === date) setCases((rows) => [...rows, created]);
          else setDate(created.date);
          loadCounts();
        }}
      />

      <CaseDrawer
        caseObj={current}
        setCase={setCase}
        lensTiers={lensTiers}
        isMobile={isMobile}
        onClose={(pendingSave) => {
          setCurrent(null);
          Promise.resolve(pendingSave).finally(() => loadCases(date));
        }}
        onStatus={onCaseChanged}
      />
    </div>
  );
}
