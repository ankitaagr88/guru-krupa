import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTopbar, useShell } from '../../components/AppShell';
import { visits as visitsApi, onDataChange } from '../../api';
import { ageSex } from '../../lib/format';
import PrescriptionModal from './PrescriptionModal';
import { visitInfo } from './hospital';
import './prescription.css';

/* Doctor-facing list of today's patients with their prescription status.
   Click a row (or "Write Rx") to open the PrescriptionModal. */
const FILTERS = [
  { key: 'all', label: 'All today' },
  { key: 'doctor', label: 'With doctor' },
  { key: 'pending', label: 'No Rx yet' },
  { key: 'written', label: 'Rx written' },
];

export default function PrescriptionsToday() {
  const { stages } = useShell();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    try {
      const list = await visitsApi.today();
      setRows((list || []).filter((v) => v.stage !== 'done' || visitInfo(v).hasPrescription));
    } catch {
      /* keep last */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const unsub = onDataChange(load);
    const t = setInterval(load, 30000);
    return () => {
      unsub();
      clearInterval(t);
    };
  }, [load]);

  const written = rows.filter((v) => visitInfo(v).hasPrescription).length;
  useTopbar({ sub: `Prescriptions · ${written} written today · ${rows.length - written} pending` });

  const shown = useMemo(
    () =>
      rows.filter((v) => {
        const i = visitInfo(v);
        if (filter === 'doctor') return v.stage === 'doctor';
        if (filter === 'pending') return !i.hasPrescription;
        if (filter === 'written') return i.hasPrescription;
        return true;
      }),
    [rows, filter]
  );

  const stageLabel = (key) => stages.find((s) => s.key === key)?.label || key || '—';

  return (
    <div className="appt-wrap rx-list-wrap">
      <div className="appt-head">
        <h2>Prescriptions — today</h2>
        <div className="rx-list-filters" role="group" aria-label="Filter">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`rx-filter${filter === f.key ? ' active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <p className="hint" style={{ margin: '-10px 0 16px' }}>
        Write or print a prescription for any patient in the clinic today. Quantities given from clinic stock
        deduct from Stock automatically.
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Token</th>
            <th>Patient</th>
            <th>Age</th>
            <th>Stage</th>
            <th>Prescription</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={6} className="empty-slot">
                Loading…
              </td>
            </tr>
          )}
          {!loading && shown.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-slot">
                No patients match
              </td>
            </tr>
          )}
          {shown.map((v) => {
            const i = visitInfo(v);
            return (
              <tr key={v.id} onClick={() => setSelected(v)}>
                <td className="td-token">{i.token}</td>
                <td className="td-name">{i.name}</td>
                <td data-label="Age">{ageSex(i)}</td>
                <td data-label="Stage">
                  <span className={`status-pill stage-${v.stage}`}>{stageLabel(v.stage)}</span>
                </td>
                <td data-label="Prescription">
                  {i.hasPrescription ? (
                    <span className="status-pill sage">Written</span>
                  ) : (
                    <span className="status-pill">None yet</span>
                  )}
                </td>
                <td className="no-label">
                  <button
                    type="button"
                    className="rx-open-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected(v);
                    }}
                  >
                    {i.hasPrescription ? '🖨 View / print' : '✎ Write Rx'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <PrescriptionModal visit={selected} onClose={() => setSelected(null)} onSaved={load} />
    </div>
  );
}
