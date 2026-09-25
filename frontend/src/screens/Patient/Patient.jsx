import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTopbar, useShell } from '../../components/AppShell';
import { patients as patientsApi, errorMessage } from '../../api';
import { useToast } from '../../components/Toast';
import { PhotoTile } from '../Machines/ExamPhotos';
import { OT_STATUS } from '../OT/constants';
import { ageSexLabel, fmtDob, fmtLastVisit } from '../../lib/format';
import { PrescriptionModal } from '../Prescription';
import NewPatientModal from '../Queue/NewPatientModal';
import useConfig from '../Queue/useConfig';
import EditPatientModal from './EditPatientModal';
import FamilyCard from './FamilyCard';
import OwedBalances from '../Billing/OwedBalances';
import ExamGlassesBlock from './ExamGlassesBlock';
import { useRelations } from './familyParts';
import './patient.css';

/* Patient screen — everything the clinic holds on one person, newest first.
   Reached by clicking a patient's name anywhere in the app (/patients/:id).
   The person's own details can be edited here (Edit details); the day's work still happens
   on the Queue / OT screens. "Family on this number" shows who shares the mobile number (the
   owner and the members with their relation) and adds / links / re-arranges them. */

const fmtDate = (d) => {
  if (!d) return '';
  const dt = new Date(String(d).length === 10 ? `${d}T00:00:00` : d);
  return Number.isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
const fmtWhen = (iso) => {
  if (!iso) return '';
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
};
const CHANNEL = { whatsapp: 'WhatsApp', call: 'Call', walkin: 'Walk-in' };

export default function Patient() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { stages } = useShell();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [rxVisit, setRxVisit] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [addingMember, setAddingMember] = useState(null); // {phone, ownerId, ownerName} while the form is open
  const [savingMember, setSavingMember] = useState(false);
  const config = useConfig();
  const relations = useRelations();
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    setErr('');
    patientsApi
      .fullHistory(id)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setErr(errorMessage(e, 'Could not load this patient')));
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  const p = data?.patient;
  useTopbar({
    title: p?.name || 'Patient',
    sub: p ? `Patient record · ${data.totals.visits} visit${data.totals.visits === 1 ? '' : 's'}` : 'Patient record',
  });

  const stageLabel = (key) => stages.find((s) => s.key === key)?.label || key;
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayVisit = data?.visits.find((v) => v.date === todayStr && v.status === 'active');

  if (err)
    return (
      <div className="board-wrap">
        <p className="ot-save-note err" role="alert">
          {err}
        </p>
        <button type="button" className="btn-ghost" style={{ flex: 'none' }} onClick={() => navigate(-1)}>
          Go back
        </button>
      </div>
    );
  if (!data)
    return (
      <div className="loading-center">
        <div className="spinner" />
        Loading patient…
      </div>
    );

  const details = [
    ['Age / sex', ageSexLabel(p)],
    ['Date of birth', p.dob ? fmtDob(p.dob) : 'Not known'],
    ['Phone', p.phone || '—'],
    ['Address', p.address || '—'],
    ['Occupation', p.occupation || '—'],
    ['Screen time', p.screenHours != null && p.screenHours !== '' ? `${p.screenHours} hrs/day` : '—'],
    ['Language', p.language ? p.language[0].toUpperCase() + p.language.slice(1) : '—'],
    ['Referred by', [p.referralSource, p.referralDetail].filter(Boolean).join(' · ') || '—'],
    ['Conditions', [...(p.existingConditions || []), p.conditionOther].filter(Boolean).join(', ') || '—'],
    ['Treated elsewhere', p.elsewhere ? p.elsewhereNote || 'Yes' : 'No'],
    ['Previous system id', p.externalId || '—'],
  ];

  return (
    <div className="board-wrap patient-wrap" data-testid="patient-screen">
      <div className="patient-head">
        <div>
          <h2 className="patient-name">{p.name}</h2>
          {p.familyOwnerId ? (
            <p className="patient-family-line" data-testid="patient-family-line">
              {p.relationLabel || 'Family member'} of{' '}
              <Link to={`/patients/${p.familyOwnerId}`}>{p.familyOwnerName || 'the owner of this number'}</Link>
              {!p.relationLabel && ' (relation not set)'}
            </p>
          ) : (
            (p.familySize || 1) > 1 && (
              <p className="patient-family-line" data-testid="patient-family-line">
                Owns this number · family of {p.familySize}
              </p>
            )
          )}
          <div className="patient-meta">
            <span className="num" data-testid="patient-age-sex">{ageSexLabel(p)}</span>
            {p.dob && <span className="num">DOB {fmtDob(p.dob)}</span>}
            {p.phone && <span className="num">{p.phone}</span>}
            <span>Last visit: {fmtLastVisit(p.lastVisitDate ? String(p.lastVisitDate).slice(0, 10) : null)}</span>
          </div>
        </div>
        <div className="patient-actions">
          <button type="button" className="btn-ghost" onClick={() => setEditing(true)} data-testid="patient-edit">
            Edit details
          </button>
          {todayVisit ? (
            <Link className="btn-primary" to={`/queue/${todayVisit.stage}?patient=${p.id}`}>
              Open today&apos;s visit
            </Link>
          ) : (
            <Link className="btn-primary" to={`/queue?patient=${p.id}`}>
              Add to today&apos;s queue
            </Link>
          )}
        </div>
      </div>

      <div className="patient-stats">
        <div className="patient-stat">
          <b className="num">{data.totals.visits}</b>
          <span>visits</span>
        </div>
        <div className="patient-stat">
          <b className="num">{data.totals.prescriptions}</b>
          <span>prescriptions</span>
        </div>
        <div className="patient-stat">
          <b className="num">{data.totals.surgeries}</b>
          <span>surgeries</span>
        </div>
        <div className="patient-stat">
          <b className="num">{data.totals.readings}</b>
          <span>machine readings</span>
        </div>
      </div>

      <FamilyCard
        patient={p}
        relations={relations}
        reloadKey={reloadKey}
        onAddMember={setAddingMember}
        onChanged={() => setReloadKey((k) => k + 1)}
      />

      {/* Money still owed from earlier visits, with "Receive payment" (lane M) */}
      <OwedBalances
        patientId={p.id}
        excludeVisitId={todayVisit?.id ?? null}
        refreshKey={reloadKey}
        onPaid={() => setReloadKey((k) => k + 1)}
      />

      <div className="patient-grid">
        <section className="card patient-card-static" aria-labelledby="ph-details">
          <h3 id="ph-details" className="section-title">
            Details
          </h3>
          <dl className="patient-details">
            {details.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd className={k === 'Phone' || k === 'Date of birth' || k === 'Age / sex' ? 'num' : ''}>{v}</dd>
              </div>
            ))}
          </dl>
          {p.note && <p className="patient-note">{p.note}</p>}
        </section>

        <section className="card patient-card-static" aria-labelledby="ph-surg">
          <h3 id="ph-surg" className="section-title">
            Surgeries
          </h3>
          {data.otCases.length === 0 && <p className="patient-empty">No surgery scheduled or recorded.</p>}
          {data.otCases.map((k) => {
            const st = OT_STATUS[k.status] || { label: k.status, cls: '' };
            return (
              <Link key={k.id} to="/ot" className="patient-line" data-testid="patient-ot">
                <span className="num">{fmtDate(k.date)}</span>
                <span className="patient-line-main">
                  {k.procedure}
                  <small>{k.timeSlot}{k.operative?.surgeon ? ` · ${k.operative.surgeon}` : ''}</small>
                </span>
                <span className={`status-pill ${st.cls}`}>{st.label}</span>
              </Link>
            );
          })}

          <h3 className="section-title" style={{ marginTop: 18 }}>
            Appointments
          </h3>
          {data.appointments.length === 0 && <p className="patient-empty">No appointments.</p>}
          {data.appointments.map((a) => (
            <div key={a.id} className="patient-line" data-testid="patient-appt">
              <span className="num">{fmtDate(a.date)}</span>
              <span className="patient-line-main">
                {CHANNEL[a.channel] || a.channel}
                {a.date >= todayStr && <small>upcoming</small>}
              </span>
              <span className={`status-pill ${a.checkedIn ? 'done' : ''}`}>{a.checkedIn ? 'Checked in' : 'Booked'}</span>
            </div>
          ))}
        </section>
      </div>

      <h3 className="section-title patient-visits-title">Visits</h3>
      {data.visits.length === 0 && <div className="empty-slot">No visits yet.</div>}
      <div className="patient-visits">
        {data.visits.map((v) => (
          <article key={v.id} className="card patient-card-static patient-visit" data-testid="patient-visit">
            <header className="patient-visit-head">
              <div>
                <b className="patient-visit-date">{fmtDate(v.date)}</b>
                <span className="patient-visit-meta num">
                  {v.token ? `${v.token} · ` : ''}
                  {v.imported ? 'from the previous system' : v.status === 'completed' ? `completed${v.completedAt ? ` ${fmtWhen(v.completedAt)}` : ''}` : stageLabel(v.stage)}
                </span>
              </div>
              {v.status === 'active' && v.date === todayStr && (
                <Link className="link-btn" to={`/queue/${v.stage}?patient=${p.id}`}>
                  Open on the queue
                </Link>
              )}
            </header>

            {(v.va?.R || v.va?.L) && (
              <div className="patient-kv">
                <span>Vision</span>
                <span className="num">
                  R {v.va.R || '—'} · L {v.va.L || '—'}
                </span>
              </div>
            )}
            {v.note && !v.imported && (
              <div className="patient-kv">
                <span>Complaint / note</span>
                <span>{v.note}</span>
              </div>
            )}
            {v.elsewhere && (
              <div className="patient-kv">
                <span>Treated elsewhere</span>
                <span>{v.elsewhereNote || 'Yes'}</span>
              </div>
            )}
            {v.doctorNotes && (
              <div className="patient-kv">
                <span>Doctor&apos;s notes</span>
                <span>{v.doctorNotes}</span>
              </div>
            )}

            {v.readings.length > 0 && (
              <div className="patient-block">
                <div className="field-label">Machine readings</div>
                {v.readings.map((r) => (
                  <div key={r.id} className="reading-card">
                    <div className="reading-head">
                      <span className="m">{r.machine || r.machineKey}</span>
                      <span className="src">
                        {r.source === 'manual' ? 'typed' : 'scanned'}
                        {r.approved ? ' · approved' : ''}
                      </span>
                    </div>
                    <div className="reading-vals">
                      {(r.values || r.vals || []).map((x) => (
                        <span key={x.l} className="reading-val">
                          <label>{x.l}</label>
                          <b className="reading">{x.v}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {(v.exam?.length > 0 || v.glasses) && <ExamGlassesBlock exam={v.exam} glasses={v.glasses} />}

            {v.prescription && (
              <div className="patient-block">
                <div className="field-label">
                  Prescription
                  {v.prescription.diagnosisName && <span className="patient-dx"> · {v.prescription.diagnosisName}</span>}
                </div>
                {v.prescription.lines.length === 0 && <p className="patient-empty">No medicines on it.</p>}
                {v.prescription.lines.map((l, i) => (
                  <div key={i} className="patient-rx-line">
                    <b>{l.name}</b>
                    <span>{l.dosage || '—'}</span>
                    {l.qtyGiven > 0 && <small className="num">{l.qtyGiven} from clinic</small>}
                  </div>
                ))}
                {v.id > 0 && !v.imported && (
                  <button type="button" className="link-btn" onClick={() => setRxVisit(v)} data-testid="patient-open-rx">
                    View / print
                  </button>
                )}
              </div>
            )}

            {v.bill && v.bill.items?.length > 0 && (
              <div className="patient-block">
                <div className="field-label">Bill</div>
                {v.bill.items.map((it, i) => (
                  <div key={i} className="patient-rx-line">
                    <b>{it.label}</b>
                    <span className="num">₹{Number(it.amount).toLocaleString('en-IN')}</span>
                  </div>
                ))}
                <div className="patient-rx-line patient-bill-total">
                  <b>Total</b>
                  <span className="num">
                    ₹{v.bill.items.reduce((n, it) => n + Number(it.amount || 0), 0).toLocaleString('en-IN')}
                    {v.bill.paymentMode ? ` · ${v.bill.paymentMode}` : ''}
                  </span>
                </div>
              </div>
            )}

            {v.examPhotos?.length > 0 && (
              <div className="patient-block">
                <div className="field-label">Exam photos</div>
                <div className="photo-grid">
                  {v.examPhotos.map((ph) => (
                    <PhotoTile key={ph.id} photo={ph} label="Exam photo" />
                  ))}
                </div>
              </div>
            )}

            {!v.prescription && v.readings.length === 0 && !v.doctorNotes && !v.bill && !v.note && (
              <p className="patient-empty">Nothing recorded for this visit.</p>
            )}
          </article>
        ))}
      </div>

      <EditPatientModal
        open={editing}
        patient={p}
        onClose={() => setEditing(false)}
        onSaved={(saved) => {
          if (saved?.familyPhoneUpdated > 0) {
            const n = saved.familyPhoneUpdated;
            toast.info(`The new number went to ${n} family member${n === 1 ? '' : 's'} too`);
          }
          setEditing(false);
          setReloadKey((k) => k + 1);
        }}
      />

      <NewPatientModal
        open={!!addingMember}
        preset={addingMember}
        title="Add family member"
        submitLabel="Save family member"
        config={config}
        busy={savingMember}
        onClose={() => setAddingMember(null)}
        onRegistered={() => setReloadKey((k) => k + 1)}
        onSubmit={async (body) => {
          setSavingMember(true);
          try {
            const created = await patientsApi.create(body);
            const where = created?.familyOwnerName ? ` to ${created.familyOwnerName}'s family` : '';
            toast.success(`${created?.name || body.name} added${where}`);
            setAddingMember(null);
            setReloadKey((k) => k + 1);
          } catch (e) {
            toast.error('Could not save the family member', errorMessage(e));
          } finally {
            setSavingMember(false);
          }
        }}
      />

      {rxVisit && (
        <PrescriptionModal
          visit={{ id: rxVisit.id, name: p.name, age: p.age, sex: p.sex, token: rxVisit.token }}
          onClose={() => {
            setRxVisit(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
