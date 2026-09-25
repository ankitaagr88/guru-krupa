import { ageSexLabel, computeRowStatus, fmtDob, fmtElapsed } from '../lib/format';
import { familyLine } from '../screens/Patient/familyParts';
import PatientLink from './PatientLink';

/* Mobile queue card (mockup `patientCardHtml`). Desktop uses <QueueRow> inside
   #boardTable. Both share computeRowStatus(). `now` lets the queue ticker
   re-render every second without each card owning a timer. Under the name: the family
   line ("Son of Rasila Patel") when the patient shares a number with family.
   A tap anywhere on the row / card — the name too — opens the patient's drawer; the record is
   one click further, from the drawer's "Patient record" link (and the small record icon at the
   end of a desktop row). A finished visit shows its total time, not a clock that keeps running. */

const toMs = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};
const clock = (ms) => new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

/** The "Waiting" pill: a running wait, or — once the visit is done — the total time it took. */
function waitPill(p, stageKey, live) {
  const finished = stageKey === 'done' || p.status === 'completed';
  if (!finished) return live;
  const end = toMs(p.completedAt) ?? p.stageEnteredAt;
  const start = toMs(p.createdAt) ?? toMs(p.checkedInAt);
  if (start != null && end != null && end >= start) return { text: `Total ${fmtElapsed(end - start)}`, cls: 'done' };
  return { text: end != null ? `Done at ${clock(end)}` : 'Done', cls: 'done' };
}

export function StatusPills({ status, note, tags }) {
  return (
    <>
      {status ? (
        <span className={`status-pill ${status.cls}`}>{status.text}</span>
      ) : note ? (
        <span className="status-note">{note}</span>
      ) : null}
      {tags.map((t, i) => (
        <span key={i} className={`status-pill ${t.cls}`}>
          {t.text}
        </span>
      ))}
    </>
  );
}

export default function PatientCard({ patient: p, stage, selected, onClick, now = Date.now() }) {
  const st = stage ?? p.stage;
  const { status, note, tags, wait: live } = computeRowStatus(p, st, now);
  const wait = waitPill(p, st, live);
  const family = familyLine(p, { short: true });
  return (
    <div
      className={`patient-card${selected ? ' selected' : ''}`}
      onClick={() => onClick?.(p)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick?.(p))}
      role="button"
      tabIndex={0}
      aria-label={`Open ${p.name}`}
      data-testid={`patient-card-${p.id}`}
    >
      <div className="pc-top">
        <div className="pc-name">
          <span className="pc-name-text">{p.name}</span>
          {family && <span className="family-line">{family}</span>}
        </div>
        <div className="pc-token">{p.token}</div>
      </div>
      <div className="pc-meta">
        <span className="num">{ageSexLabel(p)}</span>
        {p.phone && <span>{p.phone}</span>}
        <span className={`status-pill ${wait.cls}`}>{wait.text}</span>
      </div>
      <div className="pc-status">
        <StatusPills status={status} note={note} tags={tags} />
      </div>
    </div>
  );
}

/** Desktop table row (mockup `rowHtml`). Use inside <table id="boardTable" className="data-table">. */
export function QueueRow({ patient: p, stage, selected, onClick, now = Date.now() }) {
  const st = stage ?? p.stage;
  const { status, note, tags, wait: live } = computeRowStatus(p, st, now);
  const wait = waitPill(p, st, live);
  return (
    <tr
      onClick={() => onClick?.(p)}
      className={`queue-row${selected ? ' row-selected' : ''}`}
      data-testid={`queue-row-${p.id}`}
    >
      <td className="td-token">{p.token}</td>
      <td className="td-name">
        <button
          type="button"
          className="row-name-btn"
          onClick={(e) => {
            e.stopPropagation();
            onClick?.(p);
          }}
        >
          {p.name}
        </button>
        {p.familyOwnerId && <span className="family-line">{familyLine(p, { short: true })}</span>}
      </td>
      <td className="num" title={p.dob ? `DOB ${fmtDob(p.dob)}` : undefined}>
        {ageSexLabel(p)}
      </td>
      <td>{p.phone || '—'}</td>
      <td>
        <span className={`status-pill ${wait.cls}`}>{wait.text}</span>
      </td>
      <td>
        <div className="status-cell">
          <StatusPills status={status} note={note} tags={tags} />
        </div>
      </td>
      <td className="td-record">
        {p.patientId && (
          <PatientLink id={p.patientId} className="row-record-link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <path d="M14 3v5h5M9 13h6M9 17h4" />
            </svg>
            <span className="sr-only">{p.name}&apos;s record</span>
          </PatientLink>
        )}
      </td>
    </tr>
  );
}
